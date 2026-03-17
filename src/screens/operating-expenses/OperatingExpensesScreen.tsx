import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { Searchbar, Text, Icon } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useSyncAuth } from '../../hooks/useSyncAuth';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface OperatingExpensesScreenProps {
  navigation: any;
}

interface OperatingExpenseItem {
  localId: string;
  serverId?: string | null;
  description: string;
  amountCents: number;
  expenseDate: number;
  category?: string | null;
  notes?: string | null;
  synced: boolean;
}

export function OperatingExpensesScreen({ navigation }: OperatingExpensesScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<OperatingExpenseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { runFullSyncIfAuthenticated } = useSyncAuth();
  const { isOnline } = useSyncStore();
  const isOnlineRef = useRef(isOnline);
  const isSyncingOnFocusRef = useRef(false);
  isOnlineRef.current = isOnline;

  const loadLocalItems = useCallback(async () => {
    const rows = await db.query<any>(
      `SELECT local_id, server_id, description, amount_cents, expense_date, category, notes, synced, data
       FROM operating_expenses
       ORDER BY expense_date DESC, rowid DESC`
    );
    const mapped = rows.map((row) => {
      let parsed: any = null;
      try {
        parsed = row?.data ? JSON.parse(row.data) : null;
      } catch {
        parsed = null;
      }
      return {
        localId: String(row.local_id),
        serverId: row.server_id ? String(row.server_id) : null,
        description: String(parsed?.description || row.description || ''),
        amountCents: Number(parsed?.amountCents || row.amount_cents || 0),
        expenseDate:
          Number(row.expense_date || 0) ||
          (parsed?.expenseDate ? new Date(parsed.expenseDate).getTime() : Date.now()),
        category: parsed?.category ?? row.category ?? null,
        notes: parsed?.notes ?? row.notes ?? null,
        synced: row.synced === 1,
      } as OperatingExpenseItem;
    });
    setItems(mapped);
  }, []);

  const syncBestEffort = useCallback(async () => {
    return runFullSyncIfAuthenticated({ isOnline: isOnlineRef.current });
  }, [runFullSyncIfAuthenticated]);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      await loadLocalItems();
      if (!isOnlineRef.current) return;
      const synced = await syncBestEffort();
      if (synced) {
        await loadLocalItems();
      }
    } catch (error) {
      console.error('Error cargando gastos operativos:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadLocalItems, syncBestEffort]);

  useFocusEffect(
    useCallback(() => {
      if (isSyncingOnFocusRef.current) return;
      isSyncingOnFocusRef.current = true;
      let active = true;

      loadItems()
        .catch((error) => {
          console.error('Error cargando gastos operativos al abrir pantalla:', error);
        })
        .finally(() => {
          if (active) {
            isSyncingOnFocusRef.current = false;
          }
        });

      return () => {
        active = false;
        isSyncingOnFocusRef.current = false;
      };
    }, [loadItems])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadItems();
  };

  const handleDelete = async (item: OperatingExpenseItem) => {
    Alert.alert('Eliminar gasto', '¿Seguro que deseas eliminar este gasto operativo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            const localId = item.localId;
            if (item.serverId) {
              await syncService.queueOperation(
                'operating_expense',
                'delete',
                { id: item.serverId },
                localId
              );
            } else {
              await db.runAsync(
                "DELETE FROM sync_queue WHERE entity_type = 'operating_expense' AND entity_local_id = ? AND status IN ('pending','error')",
                [localId]
              );
            }
            await db.delete('operating_expenses', localId);
            await loadLocalItems();
          } catch (error) {
            console.error('Error eliminando gasto operativo:', error);
            Alert.alert('Error', 'No se pudo eliminar el gasto.');
          }
        },
      },
    ]);
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return items;
    return items.filter((item) => {
      return (
        item.description.toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery]);

  const totalCents = filteredItems.reduce((sum, item) => sum + item.amountCents, 0);

  const renderItem = ({ item }: { item: OperatingExpenseItem }) => (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.description}>{item.description}</Text>
        <Text style={styles.amount}>{formatCurrency(item.amountCents)}</Text>
      </View>
      <Text style={styles.meta}>Fecha: {formatDate(item.expenseDate)}</Text>
      <Text style={styles.meta}>Categoría: {item.category || '—'}</Text>
      {item.notes ? <Text style={styles.meta}>Notas: {item.notes}</Text> : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionButton, styles.editButton]}
          onPress={() => navigation.navigate('AddOperatingExpense', { expenseLocalId: item.localId })}
        >
          <Icon source="pencil" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={() => handleDelete(item)}>
          <Icon source="delete" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gastos operativos</Text>
        <Text style={styles.summaryLabel}>Total filtrado</Text>
        <Text style={styles.summaryValue}>{formatCurrency(totalCents)}</Text>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar por descripción, categoría o notas..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando gastos...' : 'No hay gastos operativos'}</Text>
          </View>
        }
      />

      <SafeFab icon="plus" color="#fff" style={styles.fab} onPress={() => navigation.navigate('AddOperatingExpense')} />
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
  summaryLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  summaryValue: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 2, marginBottom: 6 },
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
  card: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  description: { flex: 1, fontSize: 15, fontWeight: '700', color: ui.colors.text },
  amount: { fontSize: 16, fontWeight: '800', color: ui.colors.danger },
  meta: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  actionsRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButton: { backgroundColor: ui.colors.primary },
  deleteButton: { backgroundColor: ui.colors.danger },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});

