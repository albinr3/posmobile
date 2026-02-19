import React, { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface AddCustomerScreenProps {
  navigation: any;
  route: any;
}

export function AddCustomerScreen({ navigation, route }: AddCustomerScreenProps) {
  const customerId = route?.params?.customerId;
  const isEditMode = !!customerId;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditDays, setCreditDays] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [localId, setLocalId] = useState<string>('');
  const [serverId, setServerId] = useState<string | null>(null);
  const { getToken } = useAuth();

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
          setName(String(row.name || parsed?.name || ''));
          setPhone(String(row.phone || parsed?.phone || ''));
          setEmail(String(parsed?.email || ''));
          setAddress(String(parsed?.address || ''));
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

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      const resolvedLocalId = isEditMode ? localId || customerId : generateLocalId();
      const creditDaysValue = creditDays ? parseInt(creditDays, 10) : 0;

      const customerData = {
        id: serverId || undefined,
        localId: resolvedLocalId,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
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
          <TextInput label="Nombre del Cliente *" value={name} onChangeText={setName} mode="outlined" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <TextInput label="Telefono" value={phone} onChangeText={setPhone} mode="outlined" keyboardType="phone-pad" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <TextInput label="Email" value={email} onChangeText={setEmail} mode="outlined" keyboardType="email-address" autoCapitalize="none" style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
          <TextInput label="Direccion" value={address} onChangeText={setAddress} mode="outlined" multiline numberOfLines={2} style={styles.input} outlineColor={ui.colors.border} activeOutlineColor={ui.colors.primary} />
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
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  switchTextWrap: { flex: 1, paddingRight: 12 },
  switchLabel: { color: ui.colors.text, fontWeight: '700' },
  switchDescription: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  saveButton: { borderRadius: ui.radius.md },
  saveButtonContent: { height: 50 },
});


