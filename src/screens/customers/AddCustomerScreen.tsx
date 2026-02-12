import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text, Surface, Switch } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId } from '../../utils/helpers';

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

      // Guardar en SQLite
      await db.insert('customers', {
        local_id: localId,
        name: customerData.name,
        // Evita bug de binding null en expo-sqlite Android (prepareAsync NPE)
        phone: customerData.phone || '',
        synced: 0,
        data: JSON.stringify(customerData),
      });

      // Configurar getters de token antes de encolar para sincronización inmediata
      syncService.setGetTokenFunction(getToken);
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);

      // Agregar a cola de sincronización
      await syncService.queueOperation('customer', 'create', customerData, localId);

      const savedCustomer = await db.queryFirst<{ server_id?: string }>(
        'SELECT server_id FROM customers WHERE local_id = ?',
        [localId]
      );
      if (savedCustomer?.server_id) {
        Alert.alert('Éxito', 'Cliente guardado y sincronizado correctamente', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } else {
        const clerkToken = await getToken();
        const currentSubUserToken = useAuthStore.getState().subUserToken;
        if (clerkToken && currentSubUserToken) {
          Alert.alert('Éxito', 'Cliente guardado correctamente', [
            { text: 'OK', onPress: () => navigation.goBack() }
          ]);
        } else {
          Alert.alert(
            'Pendiente de sincronización',
            'El cliente se guardó localmente pero no se pudo subir a la web todavía. Verifica sesión/conexión y sincroniza de nuevo.'
          );
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Surface style={styles.formSection}>
          <Text style={styles.sectionTitle}>Información Básica</Text>
          
          <TextInput
            label="Nombre del Cliente *"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
          />

          <TextInput
            label="Teléfono"
            value={phone}
            onChangeText={setPhone}
            mode="outlined"
            keyboardType="phone-pad"
            style={styles.input}
            left={<TextInput.Icon icon="phone" />}
          />

          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
            left={<TextInput.Icon icon="email" />}
          />

          <TextInput
            label="Dirección"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
            left={<TextInput.Icon icon="map-marker" />}
          />
        </Surface>

        <Surface style={styles.formSection}>
          <Text style={styles.sectionTitle}>Crédito</Text>
          
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.switchLabel}>Habilitar crédito</Text>
              <Text style={styles.switchDescription}>Permite ventas a crédito</Text>
            </View>
            <Switch value={creditEnabled} onValueChange={setCreditEnabled} />
          </View>

          {creditEnabled && (
            <TextInput
              label="Días de Crédito"
              value={creditDays}
              onChangeText={setCreditDays}
              mode="outlined"
              keyboardType="number-pad"
              style={styles.input}
            />
          )}
        </Surface>

        <Surface style={styles.formSection}>
          <Text style={styles.sectionTitle}>Notas</Text>
          
          <TextInput
            label="Notas adicionales"
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.input}
          />
        </Surface>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          Guardar Cliente
        </Button>
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
    padding: 12,
  },
  formSection: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  input: {
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  switchLabel: {
    fontSize: 16,
  },
  switchDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 20,
  },
  saveButtonContent: {
    paddingVertical: 8,
  },
});
