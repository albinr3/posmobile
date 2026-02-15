import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface AddCustomerScreenProps {
  navigation: any;
}

export function AddCustomerScreen({ navigation }: AddCustomerScreenProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [creditDays, setCreditDays] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const { getToken } = useAuth();

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      const localId = generateLocalId();
      const creditDaysValue = creditDays ? parseInt(creditDays, 10) : 0;

      const customerData = {
        localId,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        creditEnabled,
        creditDays: Number.isNaN(creditDaysValue) ? 0 : creditDaysValue,
        notes: notes.trim() || null,
        createdAt: Date.now(),
      };

      await db.insert('customers', {
        local_id: localId,
        name: customerData.name,
        phone: customerData.phone || '',
        synced: 0,
        data: JSON.stringify(customerData),
      });

      syncService.setGetTokenFunction(getToken);
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
      await syncService.queueOperation('customer', 'create', customerData, localId);

      const savedCustomer = await db.queryFirst<{ server_id?: string }>('SELECT server_id FROM customers WHERE local_id = ?', [localId]);
      if (savedCustomer?.server_id) {
        Alert.alert('Éxito', 'Cliente guardado y sincronizado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } else {
        const clerkToken = await getToken();
        const currentSubUserToken = useAuthStore.getState().subUserToken;
        if (clerkToken && currentSubUserToken) {
          Alert.alert('Éxito', 'Cliente guardado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        } else {
          Alert.alert('Pendiente de sincronización', 'El cliente se guardó localmente pero no se pudo subir a la web todavía.');
        }
      }
    } catch (error) {
      console.error('Error guardando cliente:', error);
      Alert.alert('Error', 'No se pudo guardar el cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Nuevo Cliente</Text>
          <Text style={styles.headerSubtitle}>Ingresa los datos del cliente</Text>
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

        <Button mode="contained" onPress={handleSave} loading={loading} disabled={loading} buttonColor={ui.colors.primary} style={styles.saveButton} contentStyle={styles.saveButtonContent}>
          Guardar Cliente
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

