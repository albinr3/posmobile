import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from '../../components/SafeAreaView';
import { Surface, Text, Chip } from 'react-native-paper';
import { db } from '../../database/Database';

interface CustomerDetailScreenProps {
  route: any;
}

export function CustomerDetailScreen({ route }: CustomerDetailScreenProps) {
  const customerId = route?.params?.customerId;
  const [customer, setCustomer] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCustomer();
  }, [customerId]);

  const loadCustomer = async () => {
    try {
      const result = await db.queryFirst<any>(
        'SELECT * FROM customers WHERE local_id = ?',
        [customerId]
      );
      setCustomer(result || null);
    } catch (error) {
      console.error('Error cargando detalle de cliente:', error);
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text>Cargando cliente...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!customer) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text>No se encontro el cliente.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={styles.card}>
          <Text style={styles.name}>{customer.name}</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Telefono:</Text>
            <Text style={styles.value}>{customer.phone || 'N/A'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Estado sync:</Text>
            <Chip compact>{customer.synced === 1 ? 'Sincronizado' : 'Pendiente'}</Chip>
          </View>
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
  content: {
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 10,
    padding: 16,
    backgroundColor: '#fff',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
  },
});
