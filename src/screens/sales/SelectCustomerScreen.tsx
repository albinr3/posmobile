import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from '../../components/SafeAreaView';
import { Searchbar, Surface, Text, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../../database/Database';
import { useCartStore } from '../../store/cartStore';

interface SelectCustomerScreenProps {
  navigation: any;
}

interface CustomerRow {
  local_id: string;
  name: string;
  phone?: string;
}

export function SelectCustomerScreen({ navigation }: SelectCustomerScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { setCustomer } = useCartStore();

  useFocusEffect(
    useCallback(() => {
      loadCustomers();
    }, [])
  );

  const loadCustomers = async () => {
    try {
      const result = await db.query<CustomerRow>(
        'SELECT local_id, name, phone FROM customers WHERE server_id IS NOT NULL ORDER BY name'
      );
      setCustomers(result);
    } catch (error) {
      console.error('Error cargando clientes para seleccionar:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter((customer) => {
    const byName = customer.name.toLowerCase().includes(searchQuery.toLowerCase());
    const byPhone = customer.phone?.includes(searchQuery) ?? false;
    return byName || byPhone;
  });

  const handleSelectCustomer = (customerId: string | null, customerName: string | null) => {
    setCustomer(customerId, customerName);
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Buscar cliente..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <FlatList
        data={filteredCustomers}
        keyExtractor={(item) => item.local_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Surface style={styles.card}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              {item.phone ? <Text style={styles.phone}>{item.phone}</Text> : null}
            </View>
            <Button mode="text" onPress={() => handleSelectCustomer(item.local_id, item.name)}>
              Elegir
            </Button>
          </Surface>
        )}
        ListHeaderComponent={
          <Surface style={styles.card}>
            <View style={styles.info}>
              <Text style={styles.name}>Venta sin cliente</Text>
              <Text style={styles.phone}>Se registrara como consumidor final</Text>
            </View>
            <Button mode="text" onPress={() => handleSelectCustomer(null, null)}>
              Limpiar
            </Button>
          </Surface>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>{loading ? 'Cargando clientes...' : 'No hay clientes disponibles'}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  list: {
    padding: 16,
    gap: 10,
  },
  card: {
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  info: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  phone: {
    marginTop: 4,
    color: '#666',
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
});
