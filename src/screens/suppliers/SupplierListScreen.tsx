import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Searchbar, Text, Avatar, Chip } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';

interface SupplierListScreenProps {
  navigation: any;
}

interface SupplierItem {
  localId: string;
  serverId: string | null;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  synced: boolean;
}

export function SupplierListScreen({ navigation }: SupplierListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();

  const mapSupplierRows = useCallback((rows: any[]): SupplierItem[] => {
    return rows.map((row) => {
      let parsed: any = null;
      try {
        parsed = row?.data ? JSON.parse(row.data) : null;
      } catch {
        parsed = null;
      }
      return {
        localId: String(row.local_id),
        serverId: row.server_id ? String(row.server_id) : null,
        name: String(row.name || parsed?.name || ''),
        contactName:
          typeof parsed?.contactName === 'string' && parsed.contactName.trim()
            ? parsed.contactName
            : null,
        phone:
          typeof parsed?.phone === 'string' && parsed.phone.trim()
            ? parsed.phone
            : null,
        synced: row.synced === 1,
      };
    });
  }, []);

  const loadSuppliersFromDb = useCallback(async () => {
    const rows = await db.query<any>(
      'SELECT local_id, server_id, name, synced, data FROM suppliers ORDER BY name ASC'
    );
    setSuppliers(mapSupplierRows(rows));
  }, [mapSupplierRows]);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      await loadSuppliersFromDb();
    } catch (error) {
      console.error('Error cargando proveedores:', error);
      setSuppliers([]);
    } finally {
      setLoading(false);
    }

    try {
      if (!isOnline) return;
      const clerkToken = await getToken();
      const subUserToken = useAuthStore.getState().subUserToken;
      if (!clerkToken || !subUserToken) return;

      syncService.setGetTokenFunction(() => getToken());
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
      await syncService.fullSync(clerkToken, { ignoreCooldown: true });
      await loadSuppliersFromDb();
    } catch (error) {
      console.error('Error sincronizando proveedores:', error);
    } finally {
      setRefreshing(false);
    }
  }, [getToken, isOnline, loadSuppliersFromDb]);

  useFocusEffect(
    useCallback(() => {
      loadSuppliers();
    }, [loadSuppliers])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSuppliers();
  };

  const filteredSuppliers = suppliers.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.contactName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.phone || '').includes(searchQuery)
  );

  const renderSupplier = ({ item }: { item: SupplierItem }) => (
    <TouchableOpacity style={styles.supplierCard} onPress={() => navigation.navigate('AddSupplier', { supplierId: item.localId })}>
      <View style={styles.supplierInfo}>
        <Avatar.Text size={42} label={item.name.substring(0, 2).toUpperCase()} style={styles.avatar} labelStyle={styles.avatarLabel} />
        <View style={styles.supplierDetails}>
          <Text style={styles.supplierName}>{item.name}</Text>
          <Text style={styles.supplierMeta}>ID: {item.serverId || item.localId}</Text>
          <Text style={styles.supplierMeta}>{item.contactName || 'Sin contacto'}</Text>
          <Text style={styles.supplierMeta}>{item.phone || 'Sin teléfono'}</Text>
          {!item.synced ? (
            <Chip compact style={styles.pendingChip} textStyle={styles.pendingChipText}>
              Pendiente
            </Chip>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Proveedores</Text>
        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar proveedores..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={filteredSuppliers}
        renderItem={renderSupplier}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando proveedores...' : 'No hay proveedores'}</Text>
          </View>
        }
      />

      <SafeFab icon="plus" color="#fff" style={styles.fab} onPress={() => navigation.navigate('AddSupplier')} />
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
  supplierCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  supplierInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { backgroundColor: '#EEE1FF' },
  avatarLabel: { color: ui.colors.primary, fontWeight: '700' },
  supplierDetails: { marginLeft: 10, flex: 1 },
  supplierName: { fontSize: 15, fontWeight: '700', color: ui.colors.text },
  supplierMeta: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  pendingChip: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#FFE8CC', height: 23 },
  pendingChipText: { color: ui.colors.warning, fontSize: 10 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});
