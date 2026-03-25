import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Button, Icon, Modal, Portal, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import {
  BlePrinterDevice,
  connectBlePrinter,
  disconnectBlePrinter,
  getBlePrinterMissingModuleMessage,
  isBlePrinterModuleAvailable,
  listBlePrinters,
} from '../../services/printing/blePrinterService';
import { printSaleTicketDirect } from '../../services/printing/thermalPrinterService';
import { ui } from '../../theme/ui';

interface PrinterDevicesScreenProps {
  navigation: any;
}

const CONNECTED_PRINTER_KEY = 'connected_printer';
const PAPER_SIZE_KEY = 'printer_paper_size_mm';

type PaperSizeMm = '58' | '80' | 'carta';

async function requestBluetoothPermissions(): Promise<{ granted: boolean; blocked: boolean; message?: string }> {
  if (Platform.OS !== 'android') {
    return { granted: true, blocked: false };
  }

  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);

    const denied = Object.entries(granted).filter(([, status]) => status !== PermissionsAndroid.RESULTS.GRANTED);
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
    console.error('Error solicitando permisos Bluetooth:', error);
    return { granted: false, blocked: false, message: 'No se pudieron solicitar permisos Bluetooth.' };
  }
}

export function PrinterDevicesScreen({ navigation }: PrinterDevicesScreenProps) {
  const [connectedPrinter, setConnectedPrinter] = useState<BlePrinterDevice | null>(null);
  const [paperSize, setPaperSize] = useState<PaperSizeMm>('58');
  const [devices, setDevices] = useState<BlePrinterDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);

  const loadSavedState = useCallback(async () => {
    try {
      const [savedPrinter, savedPaperSize] = await Promise.all([
        AsyncStorage.getItem(CONNECTED_PRINTER_KEY),
        AsyncStorage.getItem(PAPER_SIZE_KEY),
      ]);

      if (savedPrinter) {
        const parsed = JSON.parse(savedPrinter);
        const address = String(parsed?.address || '').trim();
        if (address) {
          setConnectedPrinter({
            id: String(parsed?.id || address),
            name: String(parsed?.name || 'Impresora'),
            address,
            connected: true,
          });
        } else {
          setConnectedPrinter(null);
        }
      } else {
        setConnectedPrinter(null);
      }

      if (savedPaperSize === '80') {
        setPaperSize('80');
      } else if (savedPaperSize === 'carta') {
        setPaperSize('carta');
      } else {
        setPaperSize('58');
      }
    } catch (error) {
      console.error('Error cargando configuración de impresora:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSavedState();
    }, [loadSavedState])
  );

  const savePaperSize = async (size: PaperSizeMm) => {
    setPaperSize(size);
    await AsyncStorage.setItem(PAPER_SIZE_KEY, size);
  };

  const openDevicesModal = async () => {
    setModalVisible(true);
    setLoadingDevices(true);
    setDevices([]);

    const permissionResult = await requestBluetoothPermissions();
    if (!permissionResult.granted) {
      const message = permissionResult.message || 'Se necesitan permisos de Bluetooth para buscar impresoras.';
      setLoadingDevices(false);
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

    try {
      if (!isBlePrinterModuleAvailable()) {
        Alert.alert('Impresora', getBlePrinterMissingModuleMessage());
        return;
      }

      const pairedDevices = await listBlePrinters();
      setDevices(pairedDevices);
      if (pairedDevices.length === 0) {
        Alert.alert(
          'Impresoras',
          'No se encontraron impresoras emparejadas. Vincula la impresora en Bluetooth del sistema primero.'
        );
      }
    } catch (error) {
      console.error('Error listando impresoras Bluetooth:', error);
      Alert.alert('Impresoras', 'No se pudieron cargar impresoras Bluetooth. Verifica que Bluetooth esté encendido.');
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleSelectPrinter = async (device: BlePrinterDevice) => {
    try {
      if (!isBlePrinterModuleAvailable()) {
        Alert.alert('Impresora', getBlePrinterMissingModuleMessage());
        return;
      }

      setConnectingAddress(device.address);
      await connectBlePrinter(device.address);

      const connectedDevice = { ...device, connected: true };
      setConnectedPrinter(connectedDevice);
      await AsyncStorage.setItem(CONNECTED_PRINTER_KEY, JSON.stringify(connectedDevice));
      setModalVisible(false);
      Alert.alert('Conexión exitosa', `Conectado a ${device.name}.`);
    } catch (error) {
      console.error('Error conectando impresora:', error);
      Alert.alert('Error', 'No se pudo conectar a la impresora seleccionada.');
    } finally {
      setConnectingAddress(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (isBlePrinterModuleAvailable()) {
        await disconnectBlePrinter();
      }
      setConnectedPrinter(null);
      await AsyncStorage.removeItem(CONNECTED_PRINTER_KEY);
      Alert.alert('Impresora', 'Se desconectó la impresora.');
    } catch (error) {
      console.error('Error desconectando impresora:', error);
      Alert.alert('Error', 'No se pudo desconectar la impresora.');
    }
  };

  const handleTestPrint = async () => {
    if (!connectedPrinter?.address) {
      Alert.alert('Impresión de prueba', 'Primero selecciona una impresora.');
      return;
    }
    try {
      if (!isBlePrinterModuleAvailable()) {
        Alert.alert('Impresora', getBlePrinterMissingModuleMessage());
        return;
      }

      const printResult = await printSaleTicketDirect({
        invoiceCode: `TEST-${Date.now().toString().slice(-6)}`,
        createdAt: Date.now(),
        customerName: 'Cliente de prueba',
        paymentMethod: 'EFECTIVO',
        totalCents: 24000,
        items: [
          {
            productName: 'Cafe Latte 12oz',
            quantity: 2,
            priceCents: 6500,
            totalCents: 13000,
            unit: 'UNIDAD',
          },
          {
            productName: 'Croissant mantequilla',
            quantity: 1,
            priceCents: 11000,
            totalCents: 11000,
            unit: 'UNIDAD',
          },
        ],
      });

      if (!printResult.printed) {
        if (printResult.reason === 'missing_config') {
          Alert.alert('Impresión de prueba', 'No hay una impresora conectada.');
          return;
        }
        Alert.alert('Impresión de prueba', printResult.message || 'No se pudo imprimir la prueba.');
        return;
      }

      Alert.alert('Impresión de prueba', 'Se envió la prueba a la impresora térmica.');
    } catch (error) {
      console.error('Error en impresión de prueba:', error);
      Alert.alert('Error', 'No se pudo imprimir la prueba.');
    }
  };

  const isConnected = !!connectedPrinter?.address;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon source="arrow-left" size={26} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Impresora</Text>
        </View>

        <TouchableOpacity style={styles.printerCard} activeOpacity={0.85} onPress={openDevicesModal}>
          <View style={styles.printerCardLeft}>
            <View style={styles.printerIconWrap}>
              <Icon source="printer-outline" size={22} color="#16A34A" />
            </View>
            <View style={styles.printerMeta}>
              <Text style={styles.printerNameText}>{connectedPrinter?.name || 'Seleccionar impresora'}</Text>
              <Text style={styles.printerAddressText}>
                {connectedPrinter?.address || 'Pulsa para elegir una impresora Bluetooth'}
              </Text>
            </View>
          </View>
          <Icon source="plus" size={24} color="#111827" />
        </TouchableOpacity>

        <Text style={styles.helperText}>
          Recuerda activar el bluetooth de tu celular para conectarte y usar una impresora.
        </Text>

        <Text style={styles.sectionTitle}>Tamaño del papel</Text>
        <View style={styles.paperCard}>
          <TouchableOpacity style={styles.paperOption} onPress={() => void savePaperSize('58')}>
            <View style={[styles.radioOuter, paperSize === '58' && styles.radioOuterActive]}>
              {paperSize === '58' ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.paperOptionText}>58 mm</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.paperOption} onPress={() => void savePaperSize('80')}>
            <View style={[styles.radioOuter, paperSize === '80' && styles.radioOuterActive]}>
              {paperSize === '80' ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.paperOptionText}>80 mm</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.paperOption} onPress={() => void savePaperSize('carta')}>
            <View style={[styles.radioOuter, paperSize === 'carta' && styles.radioOuterActive]}>
              {paperSize === 'carta' ? <View style={styles.radioInner} /> : null}
            </View>
            <Text style={styles.paperOptionText}>Carta</Text>
          </TouchableOpacity>

          {paperSize === '80' ? (
            <Text style={styles.paperHint}>Formato 80 mm activo para facturas y recibos térmicos.</Text>
          ) : null}
          {paperSize === 'carta' ? (
            <Text style={styles.paperHint}>Formato carta activo para facturas al compartir o imprimir desde la lista.</Text>
          ) : null}
        </View>

        {isConnected ? (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Conexión exitosa</Text>
            <Text style={styles.successText}>Puedes imprimir tus comprobantes desde el detalle de cada venta.</Text>
          </View>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={isConnected}
            onPress={openDevicesModal}
            style={styles.actionItem}
          >
            <View style={[styles.actionIconCircle, isConnected && styles.actionIconCircleDisabled]}>
              <Icon source="check-circle-outline" size={26} color={isConnected ? '#9CA3AF' : ui.colors.primary} />
            </View>
            <Text style={[styles.actionLabel, isConnected && styles.actionLabelDisabled]}>Conectar</Text>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.85} onPress={handleTestPrint} style={styles.actionItem}>
            <View style={styles.actionIconCircle}>
              <Icon source="printer-outline" size={26} color={ui.colors.primary} />
            </View>
            <Text style={styles.actionLabel}>Imprimir prueba</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!isConnected}
            onPress={handleDisconnect}
            style={styles.actionItem}
          >
            <View style={[styles.actionIconCircle, styles.actionIconCircleDanger, !isConnected && styles.actionIconCircleDisabled]}>
              <Icon source="close-circle-outline" size={26} color={!isConnected ? '#9CA3AF' : '#B91C1C'} />
            </View>
            <Text style={[styles.actionLabel, styles.actionLabelDanger, !isConnected && styles.actionLabelDisabled]}>Desconectar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Portal>
        <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={styles.modalCard}>
          <Text style={styles.modalTitle}>Dispositivos Bluetooth</Text>
          {loadingDevices ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator />
              <Text style={styles.modalLoadingText}>Buscando dispositivos...</Text>
            </View>
          ) : devices.length === 0 ? (
            <Text style={styles.emptyDevicesText}>No hay dispositivos emparejados.</Text>
          ) : (
            <View style={styles.deviceList}>
              {devices.map((device) => {
                const connecting = connectingAddress === device.address;
                return (
                  <TouchableOpacity
                    key={device.id}
                    style={styles.deviceRow}
                    disabled={connecting}
                    onPress={() => void handleSelectPrinter(device)}
                  >
                    <View style={styles.deviceRowLeft}>
                      <Icon source="printer-outline" size={20} color={ui.colors.primary} />
                      <View style={styles.deviceMeta}>
                        <Text style={styles.deviceName}>{device.name}</Text>
                        <Text style={styles.deviceAddress}>{device.address}</Text>
                      </View>
                    </View>
                    {connecting ? <ActivityIndicator size={16} /> : <Icon source="chevron-right" size={20} color="#6B7280" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Button
            mode="text"
            textColor={ui.colors.primary}
            onPress={() => setModalVisible(false)}
            style={styles.closeModalBtn}
          >
            Cerrar
          </Button>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  content: { padding: 14, paddingBottom: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { fontSize: 24, fontWeight: '900', color: '#111827' },
  printerCard: {
    borderWidth: 2,
    borderColor: '#CBD5E1',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  printerCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  printerIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  printerMeta: { flex: 1 },
  printerNameText: { color: '#111827', fontSize: 16, fontWeight: '800' },
  printerAddressText: { color: '#6B7280', fontSize: 10, marginTop: 1 },
  helperText: { marginTop: 12, color: '#374151', fontSize: 12, lineHeight: 18 },
  sectionTitle: { marginTop: 24, color: '#111827', fontSize: 16, fontWeight: '800' },
  paperCard: { marginTop: 12, backgroundColor: '#fff', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  paperOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 12 },
  radioOuter: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: { borderColor: '#16A34A' },
  radioInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#16A34A' },
  paperOptionText: { fontSize: 14, color: '#1F2937' },
  paperHint: { marginTop: 4, color: '#92400E', fontSize: 10, paddingHorizontal: 4, paddingBottom: 6 },
  successCard: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#10B981',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  successTitle: { color: '#065F46', fontSize: 17, fontWeight: '900' },
  successText: { color: '#065F46', fontSize: 12, marginTop: 2, lineHeight: 18 },
  actionsRow: { marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  actionItem: { flex: 1, alignItems: 'center' },
  actionIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.8,
    borderColor: ui.colors.primary,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconCircleDanger: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  actionIconCircleDisabled: {
    borderColor: '#D1D5DB',
    backgroundColor: '#F3F4F6',
  },
  actionLabel: {
    marginTop: 6,
    fontSize: 11,
    color: '#374151',
    textAlign: 'center',
    fontWeight: '600',
  },
  actionLabelDanger: {
    color: '#B91C1C',
  },
  actionLabelDisabled: {
    color: '#9CA3AF',
  },
  modalCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 10 },
  modalLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  modalLoadingText: { color: '#6B7280' },
  emptyDevicesText: { color: '#6B7280', paddingVertical: 10 },
  deviceList: { gap: 8 },
  deviceRow: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  deviceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  deviceMeta: { flex: 1 },
  deviceName: { color: '#111827', fontWeight: '700', fontSize: 13 },
  deviceAddress: { color: '#6B7280', fontSize: 10, marginTop: 1 },
  closeModalBtn: { marginTop: 10, alignSelf: 'flex-end' },
});
