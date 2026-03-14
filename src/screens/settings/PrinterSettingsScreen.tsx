import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, Platform, PermissionsAndroid, Linking } from 'react-native';
import { Text, Surface, Button, ActivityIndicator, List, Divider, Switch } from 'react-native-paper';
import { useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from '../../components/SafeAreaView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { useSyncStore } from '../../store/syncStore';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { useQuoteCartStore } from '../../store/quoteCartStore';
import { isSaleSoundEnabled, setSaleSoundEnabled } from '../../services/feedback/saleFeedbackService';
import {
  getBiometricEnabled,
  isBiometricAvailable,
  promptBiometric,
  setBiometricEnabledPreference,
} from '../../services/auth/biometricAuthService';
import {
  connectBlePrinter,
  disconnectBlePrinter,
  getBlePrinterMissingModuleMessage,
  isBlePrinterModuleAvailable,
  listBlePrinters,
  printBleText,
} from '../../services/printing/blePrinterService';

interface PrinterDevice {
  id: string;
  name: string;
  address: string;
  connected: boolean;
}

interface PrinterSettingsScreenProps {
  navigation: any;
}

export function PrinterSettingsScreen({ navigation }: PrinterSettingsScreenProps) {
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();
  const { setBiometricEnabled } = useAuthStore();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [connectedPrinter, setConnectedPrinter] = useState<PrinterDevice | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [saleSoundEnabled, setSaleSoundEnabledState] = useState(true);
  const [biometricLoginEnabled, setBiometricLoginEnabled] = useState(false);
  const [resettingData, setResettingData] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedPrinter = await AsyncStorage.getItem('connected_printer');
      const savedAutoPrint = await AsyncStorage.getItem('auto_print');
      const savedSaleSoundEnabled = await isSaleSoundEnabled();
      const savedBiometricEnabled = await getBiometricEnabled();
      
      if (savedPrinter) {
        setConnectedPrinter(JSON.parse(savedPrinter));
      }
      if (savedAutoPrint) {
        setAutoPrint(savedAutoPrint === 'true');
      }
      setSaleSoundEnabledState(savedSaleSoundEnabled);
      setBiometricLoginEnabled(savedBiometricEnabled);
      setBiometricEnabled(savedBiometricEnabled);
    } catch (error) {
      console.error('Error cargando configuración:', error);
    }
  };

  const requestBluetoothPermissions = async (): Promise<{ granted: boolean; blocked: boolean; message?: string }> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        const denied = Object.entries(granted).filter(
          ([, status]) => status !== PermissionsAndroid.RESULTS.GRANTED
        );

        if (denied.length === 0) {
          return { granted: true, blocked: false };
        }

        const blocked = denied.some(([, status]) => status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
        const shortNames = denied.map(([permission]) => permission.split('.').pop()).join(', ');

        return {
          granted: false,
          blocked,
          message: blocked
            ? `Permisos bloqueados (${shortNames}). Debes habilitarlos desde Ajustes de Android.`
            : `Permisos denegados (${shortNames}).`,
        };
      } catch (error) {
        console.error('Error solicitando permisos:', error);
        return { granted: false, blocked: false, message: 'No se pudieron solicitar permisos Bluetooth.' };
      }
    }
    return { granted: true, blocked: false };
  };

  const scanForPrinters = async () => {
    setScanError(null);
    const permissionResult = await requestBluetoothPermissions();
    if (!permissionResult.granted) {
      const message = permissionResult.message || 'Se necesitan permisos de Bluetooth para buscar impresoras.';
      setScanError(message);
      if (permissionResult.blocked) {
        Alert.alert('Permisos Bluetooth', message, [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
        ]);
      } else {
        Alert.alert('Permisos Bluetooth', message);
      }
      return;
    }

    setScanning(true);
    setDevices([]);
    try {
      if (!isBlePrinterModuleAvailable()) {
        const message = getBlePrinterMissingModuleMessage();
        setScanError(message);
        Alert.alert('Impresora', message);
        return;
      }

      const pairedDevices = await listBlePrinters();
      setDevices(pairedDevices);
      if (pairedDevices.length === 0) {
        setScanError('No se encontraron impresoras emparejadas. Verifica que la impresora esté vinculada en Bluetooth del sistema.');
      }
    } catch (error) {
      console.error('Error escaneando impresoras:', error);
      const message = 'No se pudieron cargar impresoras Bluetooth. Verifica que el Bluetooth esté encendido.';
      setScanError(message);
      Alert.alert('Impresoras', message);
    } finally {
      setScanning(false);
    }
  };

  const connectToPrinter = async (device: PrinterDevice) => {
    try {
      if (!isBlePrinterModuleAvailable()) {
        Alert.alert('Impresora', getBlePrinterMissingModuleMessage());
        return;
      }
      await connectBlePrinter(device.address);
      setConnectedPrinter({ ...device, connected: true });
      await AsyncStorage.setItem('connected_printer', JSON.stringify({ ...device, connected: true }));
      Alert.alert('Éxito', `Conectado a ${device.name}`);
    } catch (error) {
      console.error('Error conectando impresora:', error);
      Alert.alert('Error', 'No se pudo conectar a la impresora');
    }
  };

  const disconnectPrinter = async () => {
    try {
      if (connectedPrinter?.address && isBlePrinterModuleAvailable()) {
        await disconnectBlePrinter();
      }
      setConnectedPrinter(null);
      await AsyncStorage.removeItem('connected_printer');
      Alert.alert('Desconectado', 'Impresora desconectada');
    } catch (error) {
      Alert.alert('Error', 'No se pudo desconectar');
    }
  };

  const testPrint = async () => {
    if (!connectedPrinter) {
      Alert.alert('Error', 'No hay impresora conectada');
      return;
    }

    try {
      if (!isBlePrinterModuleAvailable()) {
        Alert.alert('Impresora', getBlePrinterMissingModuleMessage());
        return;
      }
      await printBleText('PRUEBA MOVOPOS\nImpresora configurada correctamente\n\n\n', connectedPrinter.address);

      Alert.alert('Impresión de prueba', 'Se envió la prueba a la impresora térmica.');
    } catch (error) {
      console.error('Error en impresión de prueba:', error);
      Alert.alert('Error', 'No se pudo imprimir la prueba.');
    }
  };

  const toggleAutoPrint = async (value: boolean) => {
    setAutoPrint(value);
    await AsyncStorage.setItem('auto_print', value.toString());
  };

  const toggleSaleSound = async (value: boolean) => {
    setSaleSoundEnabledState(value);
    await setSaleSoundEnabled(value);
  };

  const toggleBiometricLogin = async (value: boolean) => {
    if (!value) {
      await setBiometricEnabledPreference(false);
      setBiometricLoginEnabled(false);
      setBiometricEnabled(false);
      return;
    }

    try {
      const availability = await isBiometricAvailable();
      if (!availability.hasHardware) {
        Alert.alert('Biometria', 'Este dispositivo no tiene hardware biometrico.');
        return;
      }
      if (!availability.isEnrolled) {
        Alert.alert('Biometria', 'Debes registrar huella o Face ID en el dispositivo.');
        return;
      }

      const result = await promptBiometric('Confirma para activar login biometrico');
      if (!result.success) {
        Alert.alert('Biometria', 'No se activo el login biometrico.');
        return;
      }

      await setBiometricEnabledPreference(true);
      setBiometricLoginEnabled(true);
      setBiometricEnabled(true);
    } catch (error) {
      console.error('Error activando biometria:', error);
      Alert.alert('Biometria', 'No se pudo activar el login biometrico.');
    }
  };

  const executeLocalDataReset = async () => {
    try {
      setResettingData(true);

      await db.clearAllData();
      useCartStore.getState().clear();
      useQuoteCartStore.getState().clear();
      useSyncStore.getState().setPendingCount(0);

      if (!isOnline) {
        Alert.alert(
          'Datos locales reiniciados',
          'La base local quedo en cero. Cuando vuelvas a tener internet, la app descargara datos desde la API.'
        );
        return;
      }

      const clerkToken = await getToken();
      if (!clerkToken) {
        Alert.alert(
          'Datos locales reiniciados',
          'La base local quedo en cero, pero no hay sesion principal activa para sincronizar ahora.'
        );
        return;
      }

      syncService.setTokenGetter(() => getToken());
      syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
      await syncService.fullSync(clerkToken, { ignoreCooldown: true });

      Alert.alert('Datos locales reiniciados', 'Se limpio la base local y se inicio la descarga desde la API.');
    } catch (error) {
      console.error('Error reiniciando datos locales:', error);
      Alert.alert('Error', 'No se pudo reiniciar la base local.');
    } finally {
      setResettingData(false);
    }
  };

  const handleResetLocalData = () => {
    Alert.alert(
      'Reiniciar base local',
      'Esto borrara TODA la data local del celular (ventas, clientes, productos, devoluciones, etc.).',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Continuar',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirmacion final',
              'Despues de esto la app quedara en cero y volvera a traer datos desde la API. ¿Deseas seguir?',
              [
                { text: 'No', style: 'cancel' },
                { text: 'Si, borrar todo', style: 'destructive', onPress: () => void executeLocalDataReset() },
              ]
            );
          },
        },
      ]
    );
  };

  const renderDevice = ({ item }: { item: PrinterDevice }) => (
    <List.Item
      title={item.name}
      description={item.address}
      left={props => <List.Icon {...props} icon="printer" />}
      right={props => (
        <Button
          mode="contained"
          compact
          onPress={() => connectToPrinter(item)}
        >
          Conectar
        </Button>
      )}
      style={styles.deviceItem}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Surface style={styles.section}>
        <Text style={styles.sectionTitle}>Impresora Conectada</Text>
        
        {connectedPrinter ? (
          <View style={styles.connectedPrinter}>
            <View style={styles.printerInfo}>
              <Text style={styles.printerName}>{connectedPrinter.name}</Text>
              <Text style={styles.printerAddress}>{connectedPrinter.address}</Text>
              <View style={styles.statusContainer}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Conectada</Text>
              </View>
            </View>
            <View style={styles.printerActions}>
              <Button mode="outlined" onPress={testPrint} style={styles.actionButton}>
                Probar
              </Button>
              <Button mode="outlined" onPress={disconnectPrinter} style={styles.actionButton}>
                Desconectar
              </Button>
            </View>
          </View>
        ) : (
          <Text style={styles.noDeviceText}>No hay impresora conectada</Text>
        )}
      </Surface>

      <Surface style={styles.section}>
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>Imprimir automáticamente</Text>
            <Text style={styles.settingDescription}>Imprimir recibo al completar venta</Text>
          </View>
          <Switch value={autoPrint} onValueChange={toggleAutoPrint} />
        </View>
        <Divider style={{ marginVertical: 12 }} />
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>Sonido al vender</Text>
            <Text style={styles.settingDescription}>Reproduce un sonido al completar una venta</Text>
          </View>
          <Switch value={saleSoundEnabled} onValueChange={toggleSaleSound} />
        </View>
        <Divider style={{ marginVertical: 12 }} />
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>Login con biometria</Text>
            <Text style={styles.settingDescription}>Protege el reingreso con huella o Face ID</Text>
          </View>
          <Switch value={biometricLoginEnabled} onValueChange={toggleBiometricLogin} />
        </View>
      </Surface>

      <Divider style={styles.divider} />

      <View style={styles.scanSection}>
        <Text style={styles.sectionTitle}>Buscar Impresoras</Text>
        
        <Button
          mode="contained"
          icon="bluetooth"
          onPress={scanForPrinters}
          loading={scanning}
          disabled={scanning}
          style={styles.scanButton}
        >
          {scanning ? 'Buscando...' : 'Buscar Impresoras'}
        </Button>

        {scanError ? <Text style={styles.errorBanner}>{scanError}</Text> : null}

        {devices.length > 0 && (
          <FlatList
            data={devices}
            renderItem={renderDevice}
            keyExtractor={(item) => item.id}
            style={styles.deviceList}
          />
        )}

        {scanning && (
          <View style={styles.scanningContainer}>
            <ActivityIndicator size="small" />
            <Text style={styles.scanningText}>Buscando dispositivos Bluetooth...</Text>
          </View>
        )}
      </View>

      <Divider style={styles.divider} />

      <Surface style={styles.dangerSection}>
        <Text style={styles.dangerTitle}>Datos Locales</Text>
        <Text style={styles.dangerDescription}>
          Borra toda la base de datos local de este celular y vuelve a empezar desde cero con lo que llegue de la API.
        </Text>
        <Button
          mode="contained"
          buttonColor="#B91C1C"
          textColor="#fff"
          icon="database-remove"
          loading={resettingData}
          disabled={resettingData}
          onPress={handleResetLocalData}
          style={styles.dangerButton}
        >
          {resettingData ? 'Reiniciando...' : 'Borrar base local'}
        </Button>
      </Surface>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    margin: 12,
    padding: 16,
    borderRadius: 12,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  connectedPrinter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  printerInfo: {},
  printerName: {
    fontSize: 16,
    fontWeight: '500',
  },
  printerAddress: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4caf50',
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#4caf50',
  },
  printerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    height: 36,
  },
  noDeviceText: {
    color: '#666',
    fontStyle: 'italic',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  divider: {
    marginVertical: 8,
  },
  scanSection: {
    margin: 12,
  },
  scanButton: {
    marginVertical: 12,
  },
  deviceList: {
    marginTop: 12,
  },
  deviceItem: {
    backgroundColor: '#fff',
    marginBottom: 8,
    borderRadius: 8,
  },
  scanningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  scanningText: {
    marginLeft: 8,
    color: '#666',
  },
  errorBanner: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    color: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 12,
  },
  dangerSection: {
    margin: 12,
    marginTop: 0,
    padding: 16,
    borderRadius: 12,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#991B1B',
  },
  dangerDescription: {
    marginTop: 6,
    color: '#7F1D1D',
    fontSize: 12,
  },
  dangerButton: {
    marginTop: 12,
  },
});

