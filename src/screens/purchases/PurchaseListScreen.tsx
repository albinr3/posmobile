import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Searchbar, Text, Chip } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';

import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface PurchaseListScreenProps {
  navigation: any;
}

interface PurchaseItem {
  localId: string;
  serverId: string | null;
  purchasedAt: number;
  supplierName: string;
  notes: string | null;
  totalCents: number;
  cancelledAt: number | null;
  itemsCount: number;
  synced: boolean;
}

function parsePurchaseData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // no-op
  }
  return null;
}

export function PurchaseListScreen({ navigation }: PurchaseListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();
  const { isOnline } = useSyncStore();

  const isOnlineRef = useRef(isOnline);
  const getTokenRef = useRef(getToken);
  const subUserTokenRef = useRef(subUserToken);
  isOnlineRef.current = isOnline;
  getTokenRef.current = getToken;
  subUserTokenRef.current = subUserToken;

  const loadLocalPurchases = useCallback(async () => {
    const rows = await db.query<any>(
      `SELECT local_id, server_id, supplier_name, total_cents, purchased_at, cancelled_at, synced, data
       FROM purchases
       ORDER BY purchased_at DESC, rowid DESC`
    );

    const mapped = rows.map((row) => {
      const parsed = parsePurchaseData(row.data);
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

      return {
        localId: String(row.local_id),
        serverId: row.server_id ? String(row.server_id) : null,
        purchasedAt: Number(row.purchased_at || parsed?.purchasedAt || Date.now()),
        supplierName: String(row.supplier_name || parsed?.supplierName || 'Proveedor no especificado'),
        notes:
          typeof parsed?.notes === 'string' && parsed.notes.trim()
            ? parsed.notes
            : null,
        totalCents: Number(row.total_cents || parsed?.totalCents || 0),
        cancelledAt: row.cancelled_at ? Number(row.cancelled_at) : null,
        itemsCount:
          Number(parsed?.itemsCount || 0) > 0
            ? Number(parsed?.itemsCount)
            : rawItems.length,
        synced: row.synced === 1,
      } as PurchaseItem;
    });

    setPurchases(mapped);
  }, []);

  const syncBestEffort = useCallback(async () => {
    if (!isOnlineRef.current) return false;

    const clerkToken = await getTokenRef.current();
    if (!clerkToken || !subUserTokenRef.current) return false;

    syncService.setTokenGetter(() => getTokenRef.current());
    syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
    await syncService.fullSync(clerkToken, { ignoreCooldown: true });
    return true;
  }, []);

  const loadPurchases = useCallback(async () => {
    try {
      setLoading(true);
      await loadLocalPurchases();

      if (!isOnlineRef.current) return;

      const synced = await syncBestEffort();
      if (synced) {
        await loadLocalPurchases();
      }
    } catch (error) {
      console.error('Error cargando compras:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadLocalPurchases, syncBestEffort]);

  useFocusEffect(
    useCallback(() => {
      loadPurchases();
    }, [loadPurchases])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPurchases();
  };

  const filteredPurchases = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return purchases;

    return purchases.filter((item) => {
      return (
        item.supplierName.toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q)
      );
    });
  }, [purchases, searchQuery]);

  const renderPurchase = ({ item }: { item: PurchaseItem }) => (
    <TouchableOpacity
      style={styles.purchaseCard}
      onPress={() => navigation.navigate('AddPurchase', { purchaseId: item.localId })}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.supplierName}>{item.supplierName}</Text>
        <View style={styles.chipsWrap}>
          {!item.synced ? (
            <Chip compact style={styles.pendingChip} textStyle={styles.pendingChipText}>
              Pendiente
            </Chip>
          ) : null}
          {item.cancelledAt ? (
            <Chip compact style={styles.cancelledChip} textStyle={styles.cancelledChipText}>
              Cancelada
            </Chip>
          ) : null}
        </View>
      </View>

      <Text style={styles.meta}>Fecha: {formatDate(item.purchasedAt)}</Text>
      <Text style={styles.meta}>Productos: {item.itemsCount}</Text>
      {item.notes ? <Text style={styles.meta}>Notas: {item.notes}</Text> : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatCurrency(item.totalCents)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Compras</Text>
        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar compras..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={filteredPurchases}
        renderItem={renderPurchase}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[ui.colors.primary]}
            tintColor={ui.colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando compras...' : 'No hay compras'}</Text>
          </View>
        }
      />

      <SafeFab icon="plus" color="#fff" style={styles.fab} onPress={() => navigation.navigate('AddPurchase')} />
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
  purchaseCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chipsWrap: { flexDirection: 'row', gap: 6 },
  supplierName: { fontSize: 15, fontWeight: '700', color: ui.colors.text, flex: 1, marginRight: 8 },
  pendingChip: { backgroundColor: '#EEE1FF' },
  pendingChipText: { color: ui.colors.primary, fontSize: 10, lineHeight: 12, includeFontPadding: false },
  cancelledChip: { backgroundColor: '#FDE8E8' },
  cancelledChipText: { color: ui.colors.danger, fontSize: 10, lineHeight: 12, includeFontPadding: false },
  meta: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  totalRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: ui.colors.textMuted, fontSize: 12, fontWeight: '700' },
  totalValue: { color: ui.colors.text, fontSize: 16, fontWeight: '800' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});

