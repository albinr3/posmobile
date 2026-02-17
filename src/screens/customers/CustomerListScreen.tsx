import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Searchbar, Text, Avatar, Chip } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { Customer } from '../../types';
import { ui } from '../../theme/ui';

interface CustomerListScreenProps {
  navigation: any;
}

export function CustomerListScreen({ navigation }: CustomerListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();
  const isSyncingOnFocusRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (isSyncingOnFocusRef.current) return;
      isSyncingOnFocusRef.current = true;
      setLoading(true);
      const syncAndLoad = async () => {
        try {
          const clerkToken = await getToken();
          if (clerkToken && subUserToken) {
            syncService.setGetTokenFunction(getToken);
            syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
            await syncService.fullSync(clerkToken);
          }
        } catch (error) {
          console.error('Error sincronizando clientes al abrir pantalla:', error);
        }
        await loadCustomers();
        isSyncingOnFocusRef.current = false;
      };
      syncAndLoad();
      return () => {
        isSyncingOnFocusRef.current = false;
      };
    }, [])
  );

  const loadCustomers = async () => {
    try {
      const result = await db.query<any>('SELECT * FROM customers WHERE server_id IS NOT NULL ORDER BY name');
      const mapped = result.map((row) => ({
        localId: row.local_id,
        serverId: row.server_id,
        name: row.name,
        phone: row.phone,
        address: (() => {
          try {
            const parsed = row.data ? JSON.parse(row.data) : null;
            return parsed?.address || null;
          } catch {
            return null;
          }
        })(),
        synced: row.synced === 1,
        data: row.data,
      }));
      setCustomers(mapped);
    } catch (error) {
      console.error('Error cargando clientes:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const clerkToken = await getToken();
      if (clerkToken && subUserToken) {
        syncService.setGetTokenFunction(getToken);
        syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
        await syncService.fullSync(clerkToken);
      }
    } catch (error) {
      console.error('Error sincronizando clientes:', error);
    }
    await loadCustomers();
  };

  const filteredCustomers = customers.filter(
    (customer) => customer.name.toLowerCase().includes(searchQuery.toLowerCase()) || (customer.phone && customer.phone.includes(searchQuery))
  );

  const renderCustomer = ({ item }: { item: Customer }) => (
    <TouchableOpacity style={styles.customerCard} onPress={() => navigation.navigate('AddCustomer', { customerId: item.localId })}>
      <View style={styles.customerInfo}>
        <Avatar.Text size={42} label={item.name.substring(0, 2).toUpperCase()} style={styles.avatar} labelStyle={styles.avatarLabel} />
        <View style={styles.customerDetails}>
          <Text style={styles.customerName}>{item.name}</Text>
          <Text style={styles.customerPhone}>{item.address || 'Sin direccion'}</Text>
          {!item.synced ? (
            <Chip compact style={styles.pendingChip} textStyle={styles.pendingChipText}>
              Pendiente
            </Chip>
          ) : null}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Clientes</Text>
        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar clientes..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={filteredCustomers}
        renderItem={renderCustomer}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando clientes...' : 'No hay clientes'}</Text>
          </View>
        }
      />

      <SafeFab icon="plus" color="#fff" style={styles.fab} onPress={() => navigation.navigate('AddCustomer')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  header: {
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomLeftRadius: ui.radius.xl,
    borderBottomRightRadius: ui.radius.xl,
  },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 8 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: ui.radius.md,
    paddingLeft: 2,
    marginBottom: 10,
  },
  searchbar: { flex: 1, elevation: 0, backgroundColor: 'transparent' },
  searchInput: { minHeight: 40 },
  list: { padding: 12, paddingBottom: 76 },
  customerCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customerInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { backgroundColor: '#EEE1FF' },
  avatarLabel: { color: ui.colors.primary, fontWeight: '700' },
  customerDetails: { marginLeft: 10, flex: 1 },
  customerName: { fontSize: 15, fontWeight: '700', color: ui.colors.text },
  customerPhone: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  pendingChip: { marginTop: 5, alignSelf: 'flex-start', backgroundColor: '#FFE8CC', height: 23 },
  pendingChipText: { color: ui.colors.warning, fontSize: 10 },
  chevron: { fontSize: 26, color: ui.colors.primary },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});

