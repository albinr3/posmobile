import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { Searchbar, Text, Chip, Button } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';

import { useSyncAuth } from '../../hooks/useSyncAuth';
import { useSyncStore } from '../../store/syncStore';
import { db } from '../../database/Database';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useAuthStore } from '../../store/authStore';
import { FinancialApiError, purchaseCreditService } from '../../services/purchases/purchaseCreditService';
import { PendingFinancialOperations } from '../../components/PendingFinancialOperations';
import { syncService } from '../../services/sync/SyncService';

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
  type: 'CONTADO' | 'CREDITO';
  dueDate: string | null;
  paidCents: number;
  balanceCents: number;
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

  const { runFullSyncIfAuthenticated } = useSyncAuth();
  const { isOnline } = useSyncStore();
  const canCancelPurchases = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canCancelPurchases === true);
  const canManagePurchases = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canManagePurchases === true);
  const canSeeCashHistory = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canOperateCashShifts === true || state.subUser?.canViewAllCashShifts === true || state.subUser?.canManageCashShifts === true);

  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

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
        type: parsed?.type === 'CREDITO' ? 'CREDITO' : 'CONTADO',
        dueDate: typeof parsed?.dueDate === 'string' ? parsed.dueDate.slice(0, 10) : null,
        paidCents: Number(parsed?.paidCents ?? row.total_cents ?? 0),
        balanceCents: Number(parsed?.balanceCents ?? 0),
      } as PurchaseItem;
    });

    setPurchases(mapped);
  }, []);

  const syncBestEffort = useCallback(async () => {
    return runFullSyncIfAuthenticated({
      isOnline: isOnlineRef.current,
      ignoreCooldown: true,
    });
  }, [runFullSyncIfAuthenticated]);

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

  const cancelPurchase = (item: PurchaseItem) => {
    if (!item.serverId || !isOnlineRef.current) { Alert.alert('Sin conexión', 'Conéctate y sincroniza esta compra antes de anularla.'); return; }
    if (item.type === 'CREDITO' && item.paidCents > 0) { Alert.alert('Pagos activos', 'Anula primero los pagos de esta compra.'); return; }
    Alert.alert('Anular compra', 'Se revertirá el inventario y, si es a crédito, la deuda. ¿Continuar?', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Anular', style: 'destructive', onPress: () => void (async () => {
        try { await purchaseCreditService.cancelPurchase(item.serverId!); await loadPurchases(); }
        catch (error) {
          if (error instanceof FinancialApiError && error.code === 'CASH_DOCUMENT_CLOSED') Alert.alert('Turno cerrado', `${error.message}${canSeeCashHistory ? '' : ' Solicita la corrección al responsable de caja.'}`, canSeeCashHistory ? [
            { text: 'Cerrar' }, { text: 'Ir a Cuadre diario', onPress: () => navigation.getParent()?.navigate('DailyCloseMenu', { screen: 'DailyClose' }) },
          ] : [{ text: 'Cerrar' }]);
          else Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo anular.');
        }
      })() },
    ]);
  };

  const renderPurchase = ({ item }: { item: PurchaseItem }) => (
    <View style={styles.purchaseCard}>
      <TouchableOpacity onPress={() => navigation.navigate('PurchaseDetail', { purchaseId: item.localId })}>
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
      <Text style={styles.meta}>{item.type === 'CREDITO' ? `Crédito · Vence ${item.dueDate || '—'}` : 'Contado'}</Text>
      {item.type === 'CREDITO' && <Text style={styles.meta}>Última sincronización · Abonado: {formatCurrency(item.paidCents)} · Pendiente: {formatCurrency(item.cancelledAt ? 0 : item.balanceCents)}</Text>}
      {item.notes ? <Text style={styles.meta}>Notas: {item.notes}</Text> : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatCurrency(item.totalCents)}</Text>
      </View>
      </TouchableOpacity>
      {canCancelPurchases && !item.cancelledAt && item.serverId && <Button mode="outlined" compact onPress={() => cancelPurchase(item)} disabled={item.type === 'CREDITO' && item.paidCents > 0}>Anular compra</Button>}
    </View>
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
        ListHeaderComponent={<PendingFinancialOperations kind="credit_purchase" onConfirmed={(result) => void (async () => { if (result?.id) await syncService.refreshConfirmedCreditPurchase(String(result.id)).catch(() => {}); await loadPurchases(); })()} />}
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

      {canManagePurchases && <SafeFab icon="plus" color="#fff" style={styles.fab} onPress={() => navigation.navigate('AddPurchase')} />}
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

