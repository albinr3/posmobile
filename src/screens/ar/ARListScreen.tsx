import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, Chip, Button, Searchbar } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { AccountReceivable } from '../../types';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface ARListScreenProps {
  navigation: any;
}

interface ARListItem extends AccountReceivable {
  invoiceCode?: string | null;
}

export function ARListScreen({ navigation }: ARListScreenProps) {
  const [arItems, setARItems] = useState<ARListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'partial' | 'overdue'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();
  const { isOnline } = useSyncStore();
  const isSyncingOnFocusRef = useRef(false);

  const syncARBestEffort = useCallback(async () => {
    if (!isOnline) return false;
    const clerkToken = await getToken();
    if (!clerkToken || !subUserToken) return false;
    syncService.setGetTokenFunction(getToken);
    syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
    await syncService.fullSync(clerkToken);
    return true;
  }, [getToken, isOnline, subUserToken]);

  useFocusEffect(
    useCallback(() => {
      if (isSyncingOnFocusRef.current) return;
      isSyncingOnFocusRef.current = true;
      let active = true;

      const syncAndLoad = async () => {
        setLoading(true);
        await loadARItems();

        if (!active || !isOnline) {
          isSyncingOnFocusRef.current = false;
          return;
        }

        syncARBestEffort()
          .then(async (synced) => {
            if (!active || !synced) return;
            await loadARItems();
          })
          .catch((error) => {
            console.error('Error sincronizando AR al abrir pantalla:', error);
          })
          .finally(() => {
            if (active) {
              isSyncingOnFocusRef.current = false;
            }
          });
      };

      syncAndLoad();
      return () => {
        active = false;
        isSyncingOnFocusRef.current = false;
      };
    }, [isOnline, syncARBestEffort])
  );

  const loadARItems = async () => {
    try {
      const result = await db.query<any>(
        `SELECT * FROM accounts_receivable
         WHERE status IN ('PENDIENTE', 'PARCIAL')
         ORDER BY due_date ASC`
      );
      const mapped = result.map((row) => ({
        invoiceCode: (() => {
          try {
            const parsed = row.data ? JSON.parse(row.data) : null;
            return parsed?.sale?.invoiceCode || parsed?.invoiceCode || null;
          } catch {
            return null;
          }
        })(),
        localId: row.local_id,
        serverId: row.server_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        totalCents: row.total_cents,
        paidCents: row.paid_cents,
        balanceCents: row.balance_cents,
        status: row.status,
        dueDate: row.due_date,
        synced: row.synced === 1,
        data: row.data,
      }));
      setARItems(mapped);
    } catch (error) {
      console.error('Error cargando cuentas por cobrar:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (isOnline) {
        await syncARBestEffort();
      }
    } catch (error) {
      console.error('Error sincronizando AR:', error);
    }
    await loadARItems();
  };

  const isOverdue = (dueDate?: number) => !!dueDate && dueDate < Date.now();

  const filteredItems = arItems.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      item.customerName.toLowerCase().includes(q) ||
      (item.invoiceCode || '').toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (filter === 'pending') return item.status === 'PENDIENTE';
    if (filter === 'partial') return item.status === 'PARCIAL';
    if (filter === 'overdue') return isOverdue(item.dueDate);
    return true;
  });

  const totalPending = arItems.reduce((sum, item) => sum + item.balanceCents, 0);

  const getStatusColor = (status: string, dueDate?: number) => {
    if (isOverdue(dueDate)) return ui.colors.danger;
    if (status === 'PARCIAL') return ui.colors.warning;
    return ui.colors.primary;
  };

  const renderARItem = ({ item }: { item: ARListItem }) => {
    const statusColor = getStatusColor(item.status, item.dueDate);
    const paidPercent = item.totalCents > 0 ? Math.round((item.paidCents / item.totalCents) * 100) : 0;

    return (
      <TouchableOpacity style={styles.arCard} onPress={() => navigation.navigate('RegisterPayment', { arId: item.localId })}>
        <View style={styles.arHeader}>
          <Text style={styles.customerName}>{item.customerName}</Text>
          <Chip compact style={[styles.statusChip, { backgroundColor: `${statusColor}20` }]} textStyle={[styles.statusChipText, { color: statusColor }]}>
            {isOverdue(item.dueDate) ? 'Vencida' : item.status}
          </Chip>
        </View>
        <Text style={styles.invoiceText}>Factura: {item.invoiceCode || 'N/A'}</Text>

        <Text style={styles.progressText}>Progreso de pago: {paidPercent}%</Text>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${Math.min(100, Math.max(0, paidPercent))}%` }]} />
        </View>

        <View style={styles.grid}>
          <View>
            <Text style={styles.label}>Pendiente</Text>
            <Text style={styles.value}>{formatCurrency(item.balanceCents)}</Text>
          </View>
          <View style={styles.rightCol}>
            <Text style={styles.label}>Pagado</Text>
            <Text style={styles.paid}>{formatCurrency(item.paidCents)}</Text>
          </View>
        </View>

        {item.dueDate ? <Text style={[styles.dueDate, isOverdue(item.dueDate) && styles.overdue]}>Vence: {formatDate(item.dueDate)}</Text> : null}

        <Button mode="contained" buttonColor={ui.colors.primary} compact onPress={() => navigation.navigate('RegisterPayment', { arId: item.localId })} style={styles.payButton}>
          Registrar Pago
        </Button>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cuentas por cobrar</Text>
        <Text style={styles.summaryLabel}>Total pendiente</Text>
        <Text style={styles.summaryValue}>{formatCurrency(totalPending)}</Text>
        <Text style={styles.summarySub}>{arItems.length} cuentas activas</Text>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar cliente o factura..."
            placeholderTextColor="#B8B2C8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>

        <View style={styles.filterContainer}>
          <Chip
            selected={filter === 'all'}
            onPress={() => setFilter('all')}
            style={[styles.filterChip, filter === 'all' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, filter === 'all' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Todas
          </Chip>
          <Chip
            selected={filter === 'pending'}
            onPress={() => setFilter('pending')}
            style={[styles.filterChip, filter === 'pending' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, filter === 'pending' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Pendientes
          </Chip>
          <Chip
            selected={filter === 'partial'}
            onPress={() => setFilter('partial')}
            style={[styles.filterChip, filter === 'partial' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, filter === 'partial' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Parciales
          </Chip>
          <Chip
            selected={filter === 'overdue'}
            onPress={() => setFilter('overdue')}
            style={[styles.filterChip, filter === 'overdue' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, filter === 'overdue' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Vencidas
          </Chip>
        </View>
      </View>

      <FlatList
        data={filteredItems}
        renderItem={renderARItem}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando...' : 'No hay cuentas por cobrar'}</Text>
          </View>
        }
      />
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
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  summaryLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  summaryValue: { color: '#fff', fontSize: 33, fontWeight: '800', marginTop: 3, marginBottom: 1 },
  summarySub: { color: 'rgba(255,255,255,0.82)', marginTop: 2, fontSize: 12 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: ui.radius.md, paddingLeft: 2, marginTop: 8, marginBottom: 10 },
  searchbar: {
    flex: 1,
    borderRadius: ui.radius.md,
    backgroundColor: 'transparent',
    elevation: 0,
  },
  searchInput: { minHeight: 40 },
  filterContainer: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterChip: {
    height: 32,
    borderRadius: ui.radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  filterChipSelected: {
    backgroundColor: '#fff',
  },
  filterChipText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextSelected: {
    color: ui.colors.primary,
    fontWeight: '700',
  },
  listContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  arCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
    marginBottom: 10,
  },
  arHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  customerName: { fontSize: 16, color: ui.colors.text, fontWeight: '700', flex: 1, marginRight: 8 },
  statusChip: { height: 28 },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  invoiceText: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 6 },
  progressText: { color: ui.colors.textMuted, fontSize: 11, marginBottom: 5 },
  progressBarBg: { height: 8, borderRadius: 8, backgroundColor: '#EEEAF6', overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: ui.colors.success, borderRadius: 8 },
  grid: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' },
  rightCol: { alignItems: 'flex-end' },
  label: { color: ui.colors.textMuted, fontSize: 11 },
  value: { color: ui.colors.text, fontWeight: '800', fontSize: 15, marginTop: 2 },
  paid: { color: ui.colors.success, fontWeight: '800', fontSize: 15, marginTop: 2 },
  dueDate: { marginTop: 9, color: ui.colors.textMuted, fontSize: 12 },
  overdue: { color: ui.colors.danger, fontWeight: '700' },
  payButton: { marginTop: 10, borderRadius: ui.radius.md, height: 40, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
});

