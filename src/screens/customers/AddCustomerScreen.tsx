import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Switch, Menu, Icon, Divider } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { normalizeCustomerVisualId } from '../../utils/customerLabels';

interface AddCustomerScreenProps {
  navigation: any;
  route: any;
}

const DOMINICAN_PROVINCES = [
  'Azua',
  'Baoruco',
  'Barahona',
  'Dajabón',
  'Distrito Nacional',
  'Duarte',
  'El Seibo',
  'Espaillat',
  'Hato Mayor',
  'Hermanas Mirabal',
  'Independencia',
  'La Altagracia',
  'La Romana',
  'La Vega',
  'María Trinidad Sánchez',
  'Monseñor Nouel',
  'Monte Cristi',
  'Monte Plata',
  'Pedernales',
  'Peravia',
  'Puerto Plata',
  'Samaná',
  'San Cristóbal',
  'San José de Ocoa',
  'San Juan',
  'San Pedro de Macorís',
  'Sánchez Ramírez',
  'Santiago',
  'Santiago Rodríguez',
  'Santo Domingo',
  'Valverde',
];

export function AddCustomerScreen({ navigation, route }: AddCustomerScreenProps) {
  const customerId = route?.params?.customerId;
  const isEditMode = !!customerId;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [province, setProvince] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditDays, setCreditDays] = useState('');
  const [notes, setNotes] = useState('');
  const [visualId, setVisualId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [localId, setLocalId] = useState<string>('');
  const [serverId, setServerId] = useState<string | null>(null);
  const [provinceMenuVisible, setProvinceMenuVisible] = useState(false);
  const { getToken } = useAuth();

  const resolveNextVisualId = useCallback(async (preferGenericOne: boolean): Promise<number> => {
    const rows = await db.query<{ visual_id?: number | null }>('SELECT visual_id FROM customers');
    let maxVisualId = 0;
    let hasVisualOne = false;

    for (const row of rows) {
      const normalized = normalizeCustomerVisualId(row?.visual_id);
      if (!normalized) continue;
      if (normalized > maxVisualId) maxVisualId = normalized;
      if (normalized === 1) hasVisualOne = true;
    }

    if (!hasVisualOne) {
      if (preferGenericOne) return 1;
      return Math.max(2, maxVisualId + 1);
    }
    return Math.max(1, maxVisualId + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isEditMode) return;

      let isActive = true;
      const loadCustomer = async () => {
        setLoadingCustomer(true);
        try {
          const row = await db.queryFirst<any>('SELECT * FROM customers WHERE local_id = ?', [customerId]);
          if (!row) {
            Alert.alert('Error', 'Cliente no encontrado', [{ text: 'OK', onPress: () => navigation.goBack() }]);
            return;
          }

          let parsed: any = null;
          try {
            parsed = row.data ? JSON.parse(row.data) : null;
          } catch {
            parsed = null;
          }

          if (!isActive) return;
          setLocalId(String(row.local_id));
          setServerId(row.server_id ? String(row.server_id) : null);
          setVisualId(
            normalizeCustomerVisualId(row.visual_id) ??
              normalizeCustomerVisualId(parsed?.visualId) ??
              null
          );
          setName(String(row.name || parsed?.name || ''));
          setPhone(String(row.phone || parsed?.phone || ''));
          setEmail(String(parsed?.email || ''));
          setAddress(String(parsed?.address || ''));
          setProvince(String(parsed?.province || ''));
          setCreditEnabled(Boolean(parsed?.creditEnabled));
          setCreditDays(String(parsed?.creditDays ?? ''));
          setNotes(String(parsed?.notes || ''));
        } catch (error) {
          if (!isActive) return;
          console.error('Error cargando cliente para edición:', error);
          Alert.alert('Error', 'No se pudo cargar el cliente');
        } finally {
          if (isActive) setLoadingCustomer(false);
        }
      };

      loadCustomer();
      return () => {
        isActive = false;
      };
    }, [customerId, isEditMode, navigation])
  );

  useEffect(() => {
    if (isEditMode) return;
    let active = true;
    const hydrateVisualId = async () => {
      try {
        const normalizedName = String(name || '').trim().toLowerCase();
        const preferGenericOne = normalizedName === 'cliente general';
        const nextVisualId = await resolveNextVisualId(preferGenericOne);
        if (active) setVisualId(nextVisualId);
      } catch {
        if (active) setVisualId(null);
      }
    };
    void hydrateVisualId();
    return () => {
      active = false;
    };
  }, [isEditMode, name, resolveNextVisualId]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      const resolvedLocalId = isEditMode ? localId || customerId : generateLocalId();
      const normalizedName = String(name || '').trim().toLowerCase();
      const preferGenericOne = normalizedName === 'cliente general';
      const resolvedVisualId = visualId ?? (await resolveNextVisualId(preferGenericOne));
      const creditDaysValue = creditDays ? parseInt(creditDays, 10) : 0;

      const customerData = {
        id: serverId || undefined,
        localId: resolvedLocalId,
        visualId: resolvedVisualId,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        province: province.trim() || null,
        creditEnabled,
        creditDays: Number.isNaN(creditDaysValue) ? 0 : creditDaysValue,
        notes: notes.trim() || null,
        createdAt: Date.now(),
      };

      if (isEditMode) {
        await db.update(
          'customers',
          resolvedLocalId,
          {
            visual_id: resolvedVisualId,
            name: customerData.name,
            phone: customerData.phone || '',
            synced: 0,
            data: JSON.stringify(customerData),
          },
          'local_id'
        );
      } else {
        await db.insert('customers', {
          local_id: resolvedLocalId,
          visual_id: resolvedVisualId,
          name: customerData.name,
          phone: customerData.phone || '',
          synced: 0,
          data: JSON.stringify(customerData),
        });
      }

      syncService.setTokenGetter(getToken);
      syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
      if (isEditMode) {
        await db.runAsync(
          "DELETE FROM sync_queue WHERE entity_type = 'customer' AND action = 'update' AND entity_local_id = ? AND status IN ('pending','error')",
          [resolvedLocalId]
        );
        await syncService.queueOperation('customer', 'update', customerData, resolvedLocalId);
      } else {
        await syncService.queueOperation('customer', 'create', customerData, resolvedLocalId);
      }

      const savedCustomer = await db.queryFirst<{ server_id?: string }>('SELECT server_id FROM customers WHERE local_id = ?', [resolvedLocalId]);
      if (savedCustomer?.server_id) {
        Alert.alert('Éxito', isEditMode ? 'Cliente actualizado correctamente' : 'Cliente guardado y sincronizado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } else {
        const clerkToken = await getToken();
        const currentSubUserToken = useAuthStore.getState().subUserToken;
        if (clerkToken && currentSubUserToken) {
          Alert.alert('Éxito', isEditMode ? 'Cliente actualizado correctamente' : 'Cliente guardado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        } else {
          Alert.alert('Pendiente de sincronización', isEditMode ? 'El cliente se actualizó localmente pero no se pudo subir a la web todavía.' : 'El cliente se guardó localmente pero no se pudo subir a la web todavía.');
        }
      }
    } catch (error) {
      console.error(isEditMode ? 'Error actualizando cliente:' : 'Error guardando cliente:', error);
      Alert.alert('Error', isEditMode ? 'No se pudo actualizar el cliente' : 'No se pudo guardar el cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{isEditMode ? 'Editar Cliente' : 'Nuevo Cliente'}</Text>
          <Text style={styles.headerSubtitle}>{isEditMode ? 'Modifica los datos del cliente' : 'Ingresa los datos del cliente'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informacion Personal</Text>
          <TextInput
            label="ID"
            value={visualId ? String(visualId) : loadingCustomer ? 'Cargando...' : 'Se asigna automaticamente'}
            mode="outlined"
            style={styles.input}
            editable={false}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.border}
          />
          <TextInput label="Nombre del Cliente*" value={name} onChangeText={setName} mode="outlined" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <TextInput label="Telefono" value={phone} onChangeText={setPhone} mode="outlined" keyboardType="phone-pad" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <TextInput label="Email" value={email} onChangeText={setEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <TextInput label="Direccion" value={address} onChangeText={setAddress} mode="outlined" multiline numberOfLines={2} style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <Menu
            visible={provinceMenuVisible}
            onDismiss={() => setProvinceMenuVisible(false)}
            anchor={
              <TouchableOpacity style={styles.selectLike} onPress={() => setProvinceMenuVisible(true)}>
                <Text style={[styles.selectLikeText, !province && styles.selectLikePlaceholder]}>{province || 'Provincia'}</Text>
                <Icon source="chevron-down" size={18} color="#6B7280" />
              </TouchableOpacity>
            }
          >
            {DOMINICAN_PROVINCES.map((item) => (
              <Menu.Item
                key={item}
                title={item}
                onPress={() => {
                  setProvince(item);
                  setProvinceMenuVisible(false);
                }}
              />
            ))}
            <Divider />
            <Menu.Item
              title="Limpiar"
              onPress={() => {
                setProvince('');
                setProvinceMenuVisible(false);
              }}
            />
          </Menu>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Credito</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchLabel}>Habilitar credito</Text>
              <Text style={styles.switchDescription}>Permite ventas a credito para este cliente</Text>
            </View>
            <Switch value={creditEnabled} onValueChange={setCreditEnabled} color={ui.colors.primary} />
          </View>
          {creditEnabled ? (
            <TextInput label="Dias de credito" value={creditDays} onChangeText={setCreditDays} mode="outlined" keyboardType="number-pad" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Notas</Text>
          <TextInput label="Notas adicionales" value={notes} onChangeText={setNotes} mode="outlined" multiline numberOfLines={3} style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
        </View>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading || loadingCustomer}
          buttonColor={ui.colors.primary}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          {isEditMode ? 'Guardar Cambios' : 'Guardar Cliente'}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingBottom: 30 },
  header: { marginBottom: 10 },
  headerTitle: { color: ui.colors.text, fontSize: 25, fontWeight: '800' },
  headerSubtitle: { color: ui.colors.textMuted, marginTop: 4 },
  card: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  sectionTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  selectLike: {
    minHeight: 56,
    borderRadius: ui.radius.md,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  selectLikeText: { color: ui.colors.text, fontSize: 14 },
  selectLikePlaceholder: { color: ui.colors.textMuted },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  switchTextWrap: { flex: 1, paddingRight: 12 },
  switchLabel: { color: ui.colors.text, fontWeight: '700' },
  switchDescription: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  saveButton: { borderRadius: ui.radius.md },
  saveButtonContent: { height: 50 },
});
