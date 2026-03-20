import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, Alert, Platform, PermissionsAndroid, Linking, Image, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Surface, Button, ActivityIndicator, List, Divider, Switch, TextInput, Icon } from 'react-native-paper';
import { useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from '../../components/SafeAreaView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as ImagePicker from 'expo-image-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { setSalesSettings } from '../../services/settings/salesSettings';
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
import { COMPANY_SETTINGS_SNAPSHOT_KEY } from '../../services/printing/thermalPrinterService';
import { ui } from '../../theme/ui';

interface PrinterDevice {
  id: string;
  name: string;
  address: string;
  connected: boolean;
}

interface PrinterSettingsScreenProps {
  navigation: any;
}

type CompanySettingsResponse = {
  company?: {
    logo?: string | null;
    nombre?: string | null;
    telefono?: string | null;
    direccion?: string | null;
  } | null;
  name?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  defaultViewMode?: string | null;
  showItbisOnReceipts?: boolean | null;
  defaultProfitMarginBp?: number | null;
  salePricesIncludeItbis?: boolean | null;
};

type CompanySettingsData = {
  name: string;
  phone: string;
  address: string;
  logoUrl: string | null;
};

function normalizeCompanySettings(apiUrl: string, payload: CompanySettingsResponse | null | undefined): CompanySettingsData {
  const rawLogo = payload?.company?.logo ?? payload?.logoUrl ?? null;
  const trimmedLogo = rawLogo && String(rawLogo).trim() ? String(rawLogo).trim() : null;
  const isAbsoluteLogo = !!trimmedLogo && /^https?:\/\//i.test(trimmedLogo);
  const logoUrl = trimmedLogo
    ? isAbsoluteLogo
      ? trimmedLogo
      : `${apiUrl}${trimmedLogo.startsWith('/') ? '' : '/'}${trimmedLogo}`
    : null;

  return {
    name: payload?.company?.nombre?.trim() || payload?.name?.trim() || 'MOVOpos',
    phone: payload?.company?.telefono?.trim() || payload?.phone?.trim() || '',
    address: payload?.company?.direccion?.trim() || payload?.address?.trim() || '',
    logoUrl,
  };
}

async function cacheCompanySettingsSnapshot(data: CompanySettingsData): Promise<void> {
  try {
    await AsyncStorage.setItem(
      COMPANY_SETTINGS_SNAPSHOT_KEY,
      JSON.stringify({
        name: String(data.name || 'MOVOpos').trim() || 'MOVOpos',
        phone: String(data.phone || '').trim(),
        address: String(data.address || '').trim(),
        logoUrl: data.logoUrl ? String(data.logoUrl).trim() : null,
      })
    );
  } catch {
    // no-op
  }
}

export function PrinterSettingsScreen({ navigation }: PrinterSettingsScreenProps) {
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();
  const { setBiometricEnabled, subUserToken, accountId } = useAuthStore();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [connectedPrinter, setConnectedPrinter] = useState<PrinterDevice | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [saleSoundEnabled, setSaleSoundEnabledState] = useState(true);
  const [biometricLoginEnabled, setBiometricLoginEnabled] = useState(false);
  const [resettingData, setResettingData] = useState(false);
  const [companySettings, setCompanySettings] = useState<CompanySettingsData>({
    name: 'MOVOpos',
    phone: '',
    address: '',
    logoUrl: null,
  });
  const [loadingCompanySettings, setLoadingCompanySettings] = useState(false);
  const [companySettingsError, setCompanySettingsError] = useState<string | null>(null);
  const [companySettingsSuccess, setCompanySettingsSuccess] = useState<string | null>(null);
  const [savingCompanySettings, setSavingCompanySettings] = useState(false);
  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [companyLogoError, setCompanyLogoError] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [defaultViewMode, setDefaultViewMode] = useState<'list' | 'grid'>('list');
  const [showItbisOnReceipts, setShowItbisOnReceipts] = useState(true);
  const [salePricesIncludeItbis, setSalePricesIncludeItbis] = useState(true);
  const [defaultProfitMargin, setDefaultProfitMargin] = useState('30.00');
  const [savingSalesSettings, setSavingSalesSettings] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    loadCompanySettings();
  }, [accountId, subUserToken]);

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

  const loadCompanySettings = async () => {
    try {
      setLoadingCompanySettings(true);
      setCompanySettingsError(null);
      setCompanySettingsSuccess(null);

      if (!subUserToken) {
        const fallbackCompany = {
          name: 'MOVOpos',
          phone: '',
          address: '',
          logoUrl: null,
        };
        setCompanySettings(fallbackCompany);
        await cacheCompanySettingsSnapshot(fallbackCompany);
        setCompanyLogoError(false);
        return;
      }

      const clerkToken = await getToken();
      if (!clerkToken) {
        setCompanySettingsError('No hay sesión principal activa para cargar la empresa.');
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const response = await axios.get(`${API_URL}/api/company-settings`, {
        headers: {
          Authorization: `Bearer ${clerkToken}`,
          'X-Clerk-Authorization': `Bearer ${clerkToken}`,
          'X-SubUser-Token': subUserToken,
          ...(accountId ? { 'X-Account-Id': accountId } : {}),
        },
      });

      setCompanySettings(normalizeCompanySettings(API_URL, response.data));
      await cacheCompanySettingsSnapshot(normalizeCompanySettings(API_URL, response.data));
      setCompanyLogoError(false);
      setIsEditingCompany(false);
      setDefaultViewMode(response.data?.defaultViewMode === 'grid' ? 'grid' : 'list');
      setShowItbisOnReceipts(Boolean(response.data?.showItbisOnReceipts ?? true));
      setSalePricesIncludeItbis(Boolean(response.data?.salePricesIncludeItbis ?? true));
      const marginBp = Number(response.data?.defaultProfitMarginBp ?? 3000);
      setDefaultProfitMargin((Math.max(0, Number.isFinite(marginBp) ? marginBp : 3000) / 100).toFixed(2));
      await setSalesSettings({
        defaultViewMode: response.data?.defaultViewMode === 'grid' ? 'grid' : 'list',
        showItbisOnReceipts: Boolean(response.data?.showItbisOnReceipts ?? true),
        defaultProfitMarginBp: Math.max(0, Number.isFinite(marginBp) ? marginBp : 3000),
        salePricesIncludeItbis: Boolean(response.data?.salePricesIncludeItbis ?? true),
      });
    } catch (error) {
      console.error('Error cargando configuración de empresa:', error);
      if (axios.isAxiosError(error)) {
        const backendMessage = typeof error.response?.data?.error === 'string' ? error.response.data.error : null;
        setCompanySettingsError(backendMessage || 'No se pudo cargar la configuración de empresa.');
      } else {
        setCompanySettingsError('No se pudo cargar la configuración de empresa.');
      }
    } finally {
      setLoadingCompanySettings(false);
    }
  };

  const saveCompanySettings = async () => {
    try {
      setSavingCompanySettings(true);
      setCompanySettingsError(null);
      setCompanySettingsSuccess(null);

      if (!subUserToken) {
        setCompanySettingsError('No hay subusuario autenticado.');
        return;
      }

      const name = companySettings.name.trim();
      const phone = companySettings.phone.trim();
      const address = companySettings.address.trim();
      const logoUrl = companySettings.logoUrl ? companySettings.logoUrl.trim() : '';

      if (!name) {
        setCompanySettingsError('El nombre es requerido.');
        return;
      }

      const clerkToken = await getToken();
      if (!clerkToken) {
        setCompanySettingsError('No hay sesión principal activa para guardar la empresa.');
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const parsedMargin = Number.parseFloat(defaultProfitMargin || '0');
      const marginBp = Math.round((Number.isFinite(parsedMargin) ? parsedMargin : 0) * 100);
      const payload = {
        name,
        phone,
        address,
        logoUrl: logoUrl || null,
        defaultViewMode,
        showItbisOnReceipts,
        salePricesIncludeItbis,
        preciosVentaIncluyenItbis: salePricesIncludeItbis,
        defaultProfitMarginBp: Math.max(0, marginBp),
        company: {
          nombre: name,
          telefono: phone,
          direccion: address,
          logo: logoUrl || null,
        },
      };
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };

      let response;
      try {
        response = await axios.put(`${API_URL}/api/company-settings`, payload, { headers });
      } catch (error) {
        if (axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405)) {
          response = await axios.post(`${API_URL}/api/company-settings`, payload, { headers });
        } else {
          throw error;
        }
      }

      setCompanySettings(normalizeCompanySettings(API_URL, response.data));
      await cacheCompanySettingsSnapshot(normalizeCompanySettings(API_URL, response.data));
      setCompanyLogoError(false);
      setIsEditingCompany(false);
      const marginBpFromForm = Math.max(0, marginBp);
      await setSalesSettings({
        defaultViewMode,
        showItbisOnReceipts,
        defaultProfitMarginBp: marginBpFromForm,
        salePricesIncludeItbis,
      });
      setCompanySettingsSuccess('Configuración guardada.');
    } catch (error) {
      console.error('Error guardando configuración de empresa:', error);
      if (axios.isAxiosError(error)) {
        const backendMessage = typeof error.response?.data?.error === 'string' ? error.response.data.error : null;
        setCompanySettingsError(backendMessage || 'No se pudo guardar la configuración de empresa.');
      } else {
        setCompanySettingsError('No se pudo guardar la configuración de empresa.');
      }
    } finally {
      setSavingCompanySettings(false);
    }
  };

  const saveSalesSettings = async () => {
    try {
      setSavingSalesSettings(true);
      setCompanySettingsError(null);
      setCompanySettingsSuccess(null);

      if (!subUserToken) {
        setCompanySettingsError('No hay subusuario autenticado.');
        return;
      }

      const clerkToken = await getToken();
      if (!clerkToken) {
        setCompanySettingsError('No hay sesión principal activa para guardar configuración de ventas.');
        return;
      }

      const name = companySettings.name.trim();
      if (!name) {
        setCompanySettingsError('El nombre comercial es requerido para guardar ajustes.');
        return;
      }

      const phone = companySettings.phone.trim();
      const address = companySettings.address.trim();
      const logoUrl = companySettings.logoUrl ? companySettings.logoUrl.trim() : '';
      const parsedMargin = Number.parseFloat(defaultProfitMargin || '0');
      const marginBp = Math.round((Number.isFinite(parsedMargin) ? parsedMargin : 0) * 100);

      const payload = {
        name,
        phone,
        address,
        logoUrl: logoUrl || null,
        defaultViewMode,
        showItbisOnReceipts,
        salePricesIncludeItbis,
        preciosVentaIncluyenItbis: salePricesIncludeItbis,
        defaultProfitMarginBp: Math.max(0, marginBp),
        company: {
          nombre: name,
          telefono: phone,
          direccion: address,
          logo: logoUrl || null,
        },
      };

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };

      let response;
      try {
        response = await axios.put(`${API_URL}/api/company-settings`, payload, { headers });
      } catch (error) {
        if (axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405)) {
          response = await axios.post(`${API_URL}/api/company-settings`, payload, { headers });
        } else {
          throw error;
        }
      }

      setDefaultViewMode(response.data?.defaultViewMode === 'grid' ? 'grid' : defaultViewMode);
      setShowItbisOnReceipts(Boolean(response.data?.showItbisOnReceipts ?? showItbisOnReceipts));
      setSalePricesIncludeItbis(Boolean(response.data?.salePricesIncludeItbis ?? salePricesIncludeItbis));
      const marginBpFromApi = Number(response.data?.defaultProfitMarginBp ?? marginBp);
      setDefaultProfitMargin((Math.max(0, Number.isFinite(marginBpFromApi) ? marginBpFromApi : marginBp) / 100).toFixed(2));
      await setSalesSettings({
        defaultViewMode: response.data?.defaultViewMode === 'grid' ? 'grid' : defaultViewMode,
        showItbisOnReceipts: Boolean(response.data?.showItbisOnReceipts ?? showItbisOnReceipts),
        defaultProfitMarginBp: Math.max(0, Number.isFinite(marginBpFromApi) ? marginBpFromApi : marginBp),
        salePricesIncludeItbis: Boolean(response.data?.salePricesIncludeItbis ?? salePricesIncludeItbis),
      });
      await cacheCompanySettingsSnapshot(normalizeCompanySettings(API_URL, response.data));
      setCompanySettingsSuccess('Configuración de ventas guardada.');
    } catch (error) {
      console.error('Error guardando configuración de ventas:', error);
      if (axios.isAxiosError(error)) {
        const backendMessage = typeof error.response?.data?.error === 'string' ? error.response.data.error : null;
        setCompanySettingsError(backendMessage || 'No se pudo guardar la configuración de ventas.');
      } else {
        setCompanySettingsError('No se pudo guardar la configuración de ventas.');
      }
    } finally {
      setSavingSalesSettings(false);
    }
  };

  const uploadCompanyLogoFromUri = async (uri: string): Promise<string> => {
    const normalizedUri = String(uri || '').trim();
    if (!normalizedUri) throw new Error('URI de imagen inválida.');

    const fileName = normalizedUri.split('/').pop() || `company-logo-${Date.now()}.jpg`;
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : 'jpg';
    const mimeType =
      extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : extension === 'heic'
            ? 'image/heic'
            : 'image/jpeg';

    if (!subUserToken) throw new Error('No hay subusuario autenticado.');
    const clerkToken = await getToken();
    if (!clerkToken) throw new Error('No hay sesión principal activa.');

    const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
    const uploadUrl = `${API_URL}/api/upload-product-image`;

    const form = new FormData();
    form.append('file', {
      uri: normalizedUri,
      name: fileName,
      type: mimeType,
    } as any);

    try {
      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clerkToken}`,
          'X-Clerk-Authorization': `Bearer ${clerkToken}`,
          'X-SubUser-Token': subUserToken,
          ...(accountId ? { 'X-Account-Id': accountId } : {}),
        },
        body: form as any,
      });

      if (!uploadResp.ok) {
        const bodyText = await uploadResp.text();
        throw new Error(`Upload HTTP ${uploadResp.status}: ${bodyText}`);
      }

      const payload = await uploadResp.json();
      const url = payload?.url || payload?.data?.url || payload?.file?.url || null;
      if (!url) throw new Error('La subida no devolvió URL.');
      return String(url);
    } catch {
      const base64 = await LegacyFileSystem.readAsStringAsync(normalizedUri, { encoding: 'base64' as any });
      if (!base64) throw new Error('No se pudo leer imagen para subida.');

      const fallbackResp = await axios.post(
        uploadUrl,
        { base64, fileName, mimeType },
        {
          headers: {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': subUserToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        }
      );

      const url = fallbackResp.data?.url || fallbackResp.data?.data?.url || fallbackResp.data?.file?.url || null;
      if (!url) throw new Error('No se obtuvo URL al subir imagen.');
      return String(url);
    }
  };

  const handleSelectCompanyLogo = async (fromCamera: boolean) => {
    try {
      setCompanySettingsError(null);
      setCompanySettingsSuccess(null);

      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permission.status !== 'granted') {
        Alert.alert('Permisos', fromCamera ? 'Se necesita acceso a la cámara.' : 'Se necesita acceso a la galería.');
        return;
      }

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 0.8 });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingLogo(true);
      const uploadedUrl = await uploadCompanyLogoFromUri(result.assets[0].uri);
      setCompanySettings((prev) => ({ ...prev, logoUrl: uploadedUrl }));
      setCompanyLogoError(false);
      setCompanySettingsSuccess('Logo cargado. Presiona Guardar para aplicar cambios.');
    } catch (error: any) {
      console.error('Error cambiando logo:', error);
      setCompanySettingsError(error?.message || 'No se pudo cambiar el logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const onPressChangeLogo = () => {
    const actions: Array<{ text: string; style?: 'default' | 'destructive' | 'cancel'; onPress?: () => void }> = [
      { text: 'Tomar foto', onPress: () => void handleSelectCompanyLogo(true) },
      { text: 'Elegir de galeria', onPress: () => void handleSelectCompanyLogo(false) },
    ];

    if (companySettings.logoUrl) {
      actions.push({
        text: 'Quitar logo',
        style: 'destructive',
        onPress: () => {
          setCompanySettings((prev) => ({ ...prev, logoUrl: null }));
          setCompanyLogoError(false);
          setCompanySettingsSuccess('Logo removido. Presiona Guardar para aplicar cambios.');
        },
      });
    }

    actions.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert('Logo de empresa', 'Selecciona una opción', actions);
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
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Surface style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Empresa</Text>
              <Text style={styles.sectionSubtitle}>Configuración comercial visible en recibos y cotizaciones</Text>
            </View>

          </View>

          <View style={styles.companyLogoSection}>
            <View style={styles.logoPreviewColumn}>
              <Text style={styles.companyDetailLabel}>Logo</Text>
              <TouchableOpacity
                style={styles.companyLogoWrap}
                activeOpacity={0.85}
                onPress={onPressChangeLogo}
                disabled={uploadingLogo}
              >
                {companySettings.logoUrl && !companyLogoError ? (
                  <Image
                    source={{ uri: companySettings.logoUrl }}
                    style={styles.companyLogo}
                    resizeMode="contain"
                    onError={() => setCompanyLogoError(true)}
                  />
                ) : (
                  <Icon source="image-outline" size={34} color="#9CA3AF" />
                )}

                {companySettings.logoUrl ? (
                  <TouchableOpacity
                    style={styles.logoRemoveBtn}
                    onPress={() => {
                      setCompanySettings((prev) => ({ ...prev, logoUrl: null }));
                      setCompanyLogoError(false);
                      setCompanySettingsSuccess('Logo removido. Presiona Guardar para aplicar cambios.');
                    }}
                  >
                    <Icon source="close" size={14} color="#fff" />
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.logoUploadCard}
              activeOpacity={0.9}
              onPress={onPressChangeLogo}
              disabled={uploadingLogo}
            >
              <Icon source="cloud-upload-outline" size={20} color="#7C3AED" />
              <Text style={styles.logoUploadTitle}>{companySettings.logoUrl ? 'Cambiar logo' : 'Subir logo'}</Text>
              <Text style={styles.logoUploadHint}>{uploadingLogo ? 'Subiendo...' : 'JPG, PNG o WEBP'}</Text>
            </TouchableOpacity>
          </View>

          <Divider style={styles.companyDivider} />

          {loadingCompanySettings ? <ActivityIndicator size="small" style={{ marginTop: 10 }} /> : null}
          {companySettingsError ? <Text style={styles.errorBanner}>{companySettingsError}</Text> : null}
          {companySettingsSuccess ? <Text style={styles.successBanner}>{companySettingsSuccess}</Text> : null}

          <View style={styles.companyDetails}>
            <Text style={styles.companyDetailLabel}>Nombre comercial</Text>
            <TextInput
              mode="outlined"
              dense
              value={companySettings.name}
              onChangeText={(value) => setCompanySettings((prev) => ({ ...prev, name: value }))}
              disabled={!isEditingCompany}
              editable={isEditingCompany}
              style={styles.companyInput}
              contentStyle={styles.companyInputContent}
              outlineStyle={styles.companyInputOutline}
            />
            <Text style={styles.companyDetailLabel}>Telefono</Text>
            <TextInput
              mode="outlined"
              dense
              value={companySettings.phone}
              onChangeText={(value) => setCompanySettings((prev) => ({ ...prev, phone: value }))}
              disabled={!isEditingCompany}
              editable={isEditingCompany}
              keyboardType="phone-pad"
              style={styles.companyInput}
              contentStyle={styles.companyInputContent}
              outlineStyle={styles.companyInputOutline}
            />
            <Text style={styles.companyDetailLabel}>Direccion</Text>
            <TextInput
              mode="outlined"
              dense
              value={companySettings.address}
              onChangeText={(value) => setCompanySettings((prev) => ({ ...prev, address: value }))}
              disabled={!isEditingCompany}
              editable={isEditingCompany}
              style={styles.companyInput}
              contentStyle={styles.companyInputContent}
              outlineStyle={styles.companyInputOutline}
            />
            <Button
              mode="contained"
              icon={isEditingCompany ? 'content-save-outline' : 'pencil-outline'}
              buttonColor={ui.colors.primary}
              textColor="#fff"
              onPress={() => {
                if (!isEditingCompany) {
                  setIsEditingCompany(true);
                  return;
                }
                void saveCompanySettings();
              }}
              loading={savingCompanySettings}
              disabled={savingCompanySettings || uploadingLogo}
              style={styles.companySaveButton}
              contentStyle={styles.companySaveButtonContent}
            >
              {savingCompanySettings ? 'Guardando...' : isEditingCompany ? 'Guardar cambios' : 'Editar'}
            </Button>
          </View>
        </Surface>

        <Surface style={styles.section}>
          <Text style={styles.sectionTitle}>Configuración de Ventas</Text>
          <Text style={styles.sectionSubtitle}>Personaliza el comportamiento de ventas y recibos</Text>
          <Divider style={styles.companyDivider} />

          <Text style={styles.companyDetailLabel}>Vista por defecto de productos</Text>
          <View style={styles.viewModeRow}>
            <TouchableOpacity
              style={[styles.viewModeChip, defaultViewMode === 'list' && styles.viewModeChipActive]}
              onPress={() => setDefaultViewMode('list')}
            >
              <Text style={[styles.viewModeChipText, defaultViewMode === 'list' && styles.viewModeChipTextActive]}>
                Lista
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewModeChip, defaultViewMode === 'grid' && styles.viewModeChipActive]}
              onPress={() => setDefaultViewMode('grid')}
            >
              <Text style={[styles.viewModeChipText, defaultViewMode === 'grid' && styles.viewModeChipTextActive]}>
                Imágenes
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.saleSwitchCard}>
            <View style={styles.saleSwitchMeta}>
              <Text style={styles.saleSwitchTitle}>Desglosar ITBIS en recibos</Text>
              <Text style={styles.saleSwitchHint}>Mostrar detalle ITBIS en recibos y facturas.</Text>
            </View>
            <Switch value={showItbisOnReceipts} onValueChange={setShowItbisOnReceipts} color={ui.colors.primary} />
          </View>

          <View style={styles.saleSwitchCard}>
            <View style={styles.saleSwitchMeta}>
              <Text style={styles.saleSwitchTitle}>Precio de venta incluye ITBIS</Text>
              <Text style={styles.saleSwitchHint}>Si se desactiva, el ITBIS se suma al total al facturar.</Text>
            </View>
            <Switch value={salePricesIncludeItbis} onValueChange={setSalePricesIncludeItbis} color={ui.colors.primary} />
          </View>

          <Text style={styles.companyDetailLabel}>% ganancia por defecto en compras</Text>
          <View style={styles.marginRow}>
            <TextInput
              mode="outlined"
              dense
              value={defaultProfitMargin}
              onChangeText={(value) => {
                const cleaned = value.replace(/[^0-9.]/g, '');
                const parts = cleaned.split('.');
                if (parts.length > 2) return;
                const normalized = parts.length === 2 ? `${parts[0]}.${parts[1].slice(0, 2)}` : parts[0];
                setDefaultProfitMargin(normalized);
              }}
              keyboardType="decimal-pad"
              style={[styles.companyInput, styles.marginInput]}
              contentStyle={styles.companyInputContent}
            />
            <Button
              mode="outlined"
              textColor={ui.colors.primary}
              onPress={saveSalesSettings}
              loading={savingSalesSettings}
              disabled={savingSalesSettings}
            >
              Guardar
            </Button>
          </View>
          <Text style={styles.marginHint}>Se usa para calcular precio de venta automático en compras.</Text>
        </Surface>

        <Surface style={styles.section}>
          <Text style={styles.sectionTitle}>Impresoras</Text>
          <Text style={styles.sectionSubtitle}>Configura impresora Bluetooth y tamaño de papel</Text>
          <Button
            mode="outlined"
            icon="printer-outline"
            textColor={ui.colors.primary}
            style={styles.printersEntryBtn}
            contentStyle={styles.printersEntryBtnContent}
            onPress={() => navigation.navigate('Printers')}
          >
            Abrir configuración de impresoras
          </Button>
        </Surface>

        <Surface style={styles.section}>
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingTitle}>Imprimir automáticamente</Text>
              <Text style={styles.settingDescription}>Imprimir recibo al completar venta</Text>
            </View>
            <Switch value={autoPrint} onValueChange={toggleAutoPrint} color={ui.colors.primary} />
          </View>
          <Divider style={{ marginVertical: 12 }} />
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingTitle}>Sonido al vender</Text>
              <Text style={styles.settingDescription}>Reproduce un sonido al completar una venta</Text>
            </View>
            <Switch value={saleSoundEnabled} onValueChange={toggleSaleSound} color={ui.colors.primary} />
          </View>
          <Divider style={{ marginVertical: 12 }} />
          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingTitle}>Login con biometria</Text>
              <Text style={styles.settingDescription}>Protege el reingreso con huella o Face ID</Text>
            </View>
            <Switch value={biometricLoginEnabled} onValueChange={toggleBiometricLogin} color={ui.colors.primary} />
          </View>
        </Surface>

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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  section: {
    margin: 12,
    padding: 16,
    borderRadius: 12,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  printersEntryBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1.4,
  },
  printersEntryBtnContent: {
    height: 44,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  companyLogoSection: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  logoPreviewColumn: {
    width: 96,
  },
  companyLogoWrap: {
    width: 86,
    height: 86,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  companyLogo: {
    width: 74,
    height: 74,
  },
  logoRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoUploadCard: {
    flex: 1,
    minHeight: 86,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8B4FE',
    borderStyle: 'dashed',
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  logoUploadTitle: {
    marginTop: 6,
    color: '#6D28D9',
    fontSize: 14,
    fontWeight: '800',
  },
  logoUploadHint: {
    marginTop: 2,
    color: '#6B7280',
    fontSize: 11,
  },
  companyDivider: {
    marginTop: 14,
    marginBottom: 10,
  },
  companyDetails: {
    marginTop: 2,
  },
  companyDetailLabel: {
    fontSize: 11,
    color: '#374151',
    marginBottom: 6,
    marginLeft: 2,
    fontWeight: '600',
  },
  companyInput: {
    marginBottom: 10,
    backgroundColor: '#fff',
    height: 42,
  },
  companyInputOutline: {
    borderWidth: 1.6,
    borderRadius: 14,
  },
  companyInputContent: {
    fontSize: 13,
    paddingVertical: 6,
  },
  companySaveButton: {
    marginTop: 4,
    borderRadius: 10,
  },
  companySaveButtonContent: {
    height: 46,
  },
  viewModeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  viewModeChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#fff',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModeChipActive: {
    borderColor: '#A78BFA',
    backgroundColor: '#F5F3FF',
  },
  viewModeChipText: {
    color: '#111827',
    fontWeight: '600',
    fontSize: 12,
  },
  viewModeChipTextActive: {
    color: '#6D28D9',
    fontWeight: '800',
  },
  saleSwitchCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  saleSwitchMeta: {
    flex: 1,
  },
  saleSwitchTitle: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 13,
  },
  saleSwitchHint: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 2,
  },
  marginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  marginInput: {
    flex: 1,
    marginBottom: 0,
  },
  marginHint: {
    color: '#6B7280',
    fontSize: 10,
    marginTop: 8,
  },
  successBanner: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
    color: '#166534',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 11,
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
    fontSize: 14,
    fontWeight: '500',
  },
  settingDescription: {
    fontSize: 11,
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
    marginTop: 10,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
    color: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 11,
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
    fontSize: 14,
    fontWeight: '700',
    color: '#991B1B',
  },
  dangerDescription: {
    marginTop: 6,
    color: '#7F1D1D',
    fontSize: 11,
  },
  dangerButton: {
    marginTop: 12,
  },
});

