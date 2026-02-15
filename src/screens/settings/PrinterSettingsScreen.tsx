import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, Platform, PermissionsAndroid } from 'react-native';
import { Text, Surface, Button, ActivityIndicator, List, Divider, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [connectedPrinter, setConnectedPrinter] = useState<PrinterDevice | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedPrinter = await AsyncStorage.getItem('connected_printer');
      const savedAutoPrint = await AsyncStorage.getItem('auto_print');
      
      if (savedPrinter) {
        setConnectedPrinter(JSON.parse(savedPrinter));
      }
      if (savedAutoPrint) {
        setAutoPrint(savedAutoPrint === 'true');
      }
    } catch (error) {
      console.error('Error cargando configuración:', error);
    }
  };

  const requestBluetoothPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        
        return Object.values(granted).every(
          permission => permission === PermissionsAndroid.RESULTS.GRANTED
        );
      } catch (error) {
        console.error('Error solicitando permisos:', error);
        return false;
      }
    }
    return true;
  };

  const scanForPrinters = async () => {
    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) {
      Alert.alert('Permisos', 'Se necesitan permisos de Bluetooth para buscar impresoras');
      return;
    }

    setScanning(true);
    setDevices([]);

    // TODO: Implementar escaneo real con react-native-ble-plx
    // Por ahora, simulamos dispositivos para desarrollo
    setTimeout(() => {
      setDevices([
        { id: '1', name: 'Printer-58mm', address: 'AA:BB:CC:DD:EE:FF', connected: false },
        { id: '2', name: 'POS-Thermal', address: '11:22:33:44:55:66', connected: false },
      ]);
      setScanning(false);
    }, 3000);
  };

  const connectToPrinter = async (device: PrinterDevice) => {
    try {
      // TODO: Implementar conexión real con BLE
      setConnectedPrinter({ ...device, connected: true });
      await AsyncStorage.setItem('connected_printer', JSON.stringify({ ...device, connected: true }));
      Alert.alert('Éxito', `Conectado a ${device.name}`);
    } catch (error) {
      Alert.alert('Error', 'No se pudo conectar a la impresora');
    }
  };

  const disconnectPrinter = async () => {
    try {
      // TODO: Implementar desconexión real
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

    // TODO: Implementar impresión de prueba
    Alert.alert('Impresión de Prueba', 'Enviando página de prueba a la impresora...');
  };

  const toggleAutoPrint = async (value: boolean) => {
    setAutoPrint(value);
    await AsyncStorage.setItem('auto_print', value.toString());
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
});
