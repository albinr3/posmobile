import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from '../../components/SafeAreaView';
import { Searchbar, Surface, Text, Button, Icon } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../../database/Database';
import { useCartStore } from '../../store/cartStore';
import { useQuoteCartStore } from '../../store/quoteCartStore';
import { ui } from '../../theme/ui';

interface SelectCustomerScreenProps {
  navigation: any;
  route?: {
    params?: {
      mode?: 'SALE' | 'QUOTE';
    };
  };
}

interface CustomerRow {
  local_id: string;
  server_id?: string | null;
  name: string;
  phone?: string;
}

export function SelectCustomerScreen({ navigation, route }: SelectCustomerScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { setCustomer: setSaleCustomer } = useCartStore();
  const { setCustomer: setQuoteCustomer } = useQuoteCartStore();
  const mode = route?.params?.mode === 'QUOTE' ? 'QUOTE' : 'SALE';

  useFocusEffect(
    useCallback(() => {
      loadCustomers();
    }, [])
  );

  const loadCustomers = async () => {
    try {
      const result = await db.query<CustomerRow>(
        'SELECT local_id, server_id, name, phone FROM customers ORDER BY name'
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
    if (mode === 'QUOTE') {
      setQuoteCustomer(customerId, customerName);
    } else {
      setSaleCustomer(customerId, customerName);
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Buscar cliente..."
          placeholderTextColor="#B8B2C8"
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
            <Button mode="text" textColor={ui.colors.primary} onPress={() => handleSelectCustomer(item.local_id, item.name)}>
              Elegir
            </Button>
          </Surface>
        )}
        ListHeaderComponent={
          mode === 'QUOTE'
            ? (
                <Surface style={styles.card}>
                  <View style={styles.info}>
                    <Text style={styles.name}>Cotizacion sin cliente</Text>
                    <Text style={styles.phone}>Opcional para cotizaciones</Text>
                  </View>
                  <Button mode="text" textColor={ui.colors.primary} onPress={() => handleSelectCustomer(null, null)}>
                    Limpiar
                  </Button>
                </Surface>
              )
            : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>{loading ? 'Cargando clientes...' : 'No hay clientes disponibles'}</Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.footerDivider} />
            <TouchableOpacity
              style={styles.createCustomerButton}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('AddCustomer')}
            >
              <View style={styles.createCustomerIconWrap}>
                <Icon source="account-plus" size={20} color="#fff" />
              </View>
              <Text style={styles.createCustomerText}>Crear cliente nuevo</Text>
              <Icon source="chevron-right" size={20} color={ui.colors.primary} />
            </TouchableOpacity>
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
  footer: {
    marginTop: 12,
    paddingTop: 12,
  },
  footerDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginBottom: 12,
  },
  createCustomerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3EAFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: ui.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  createCustomerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: ui.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCustomerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: ui.colors.primary,
  },
});
