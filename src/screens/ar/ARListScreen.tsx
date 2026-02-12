import React, { useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, Surface, Chip, Divider, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { AccountReceivable } from '../../types';
import { formatCurrency, formatDate } from '../../utils/helpers';

interface ARListScreenProps {
  navigation: any;
}

export function ARListScreen({ navigation }: ARListScreenProps) {
  const [arItems, setARItems] = useState<AccountReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'partial' | 'overdue'>('all');

  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      loadARItems();
    }, [])
  );

  const loadARItems = async () => {
    try {
      const result = await db.query<any>(
        `SELECT * FROM accounts_receivable 
         WHERE status IN ('PENDIENTE', 'PARCIAL') 
         ORDER BY due_date ASC`
      );
      const mapped = result.map(row => ({
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
      const clerkToken = await getToken();
      if (clerkToken && subUserToken) {
        console.log('🔄 Sincronizando AR...');
        syncService.setGetTokenFunction(getToken);
        syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
        await syncService.fullSync(clerkToken);
        console.log('✅ AR sincronizado');
      }
    } catch (error) {
      console.error('❌ Error sincronizando AR:', error);
    }
    await loadARItems();
  };

  const isOverdue = (dueDate?: number) => {
    if (!dueDate) return false;
    return dueDate < Date.now();
  };

  const filteredItems = arItems.filter(item => {
    if (filter === 'pending') return item.status === 'PENDIENTE';
    if (filter === 'partial') return item.status === 'PARCIAL';
    if (filter === 'overdue') return isOverdue(item.dueDate);
    return true;
  });

  const totalPending = arItems.reduce((sum, item) => sum + item.balanceCents, 0);

  const getStatusColor = (status: string, dueDate?: number) => {
    if (isOverdue(dueDate)) return '#d32f2f';
    if (status === 'PARCIAL') return '#f57c00';
    return '#1a73e8';
  };

  const renderARItem = ({ item }: { item: AccountReceivable }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('ARDetail', { arId: item.localId })}
    >
      <Surface style={styles.arCard}>
        <View style={styles.arHeader}>
          <Text style={styles.customerName}>{item.customerName}</Text>
          <Chip 
            compact 
            style={[styles.statusChip, { backgroundColor: getStatusColor(item.status, item.dueDate) + '20' }]}
            textStyle={[styles.statusChipText, { color: getStatusColor(item.status, item.dueDate) }]}
          >
            {isOverdue(item.dueDate) ? 'Vencido' : item.status}
          </Chip>
        </View>

        <Divider style={styles.divider} />

        <View style={styles.arDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Total:</Text>
            <Text style={styles.detailValue}>{formatCurrency(item.totalCents)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Pagado:</Text>
            <Text style={styles.detailValue}>{formatCurrency(item.paidCents)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Pendiente:</Text>
            <Text style={[styles.detailValue, styles.balanceValue]}>
              {formatCurrency(item.balanceCents)}
            </Text>
          </View>
          {item.dueDate && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Vence:</Text>
              <Text style={[
                styles.detailValue,
                isOverdue(item.dueDate) && styles.overdueText
              ]}>
                {formatDate(item.dueDate)}
              </Text>
            </View>
          )}
        </View>

        <Button
          mode="contained"
          compact
          onPress={() => navigation.navigate('RegisterPayment', { arId: item.localId })}
          style={styles.payButton}
        >
          Registrar Pago
        </Button>
      </Surface>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Surface style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Total Pendiente</Text>
        <Text style={styles.summaryValue}>{formatCurrency(totalPending)}</Text>
        <Text style={styles.summarySubtext}>{arItems.length} cuentas</Text>
      </Surface>

      <View style={styles.filterContainer}>
        <Chip
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
          style={styles.filterChip}
        >
          Todas
        </Chip>
        <Chip
          selected={filter === 'pending'}
          onPress={() => setFilter('pending')}
          style={styles.filterChip}
        >
          Pendientes
        </Chip>
        <Chip
          selected={filter === 'partial'}
          onPress={() => setFilter('partial')}
          style={styles.filterChip}
        >
          Parciales
        </Chip>
        <Chip
          selected={filter === 'overdue'}
          onPress={() => setFilter('overdue')}
          style={styles.filterChip}
        >
          Vencidas
        </Chip>
      </View>

      <FlatList
        data={filteredItems}
        renderItem={renderARItem}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {loading ? 'Cargando...' : 'No hay cuentas por cobrar'}
            </Text>
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
  summaryCard: {
    margin: 12,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a73e8',
    marginVertical: 4,
  },
  summarySubtext: {
    fontSize: 12,
    color: '#888',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    height: 32,
  },
  listContent: {
    padding: 12,
    paddingBottom: 20,
  },
  arCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    elevation: 1,
  },
  arHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customerName: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  statusChip: {
    height: 28,
  },
  statusChipText: {
    fontSize: 12,
  },
  divider: {
    marginVertical: 12,
  },
  arDetails: {},
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
  },
  detailValue: {
    fontSize: 14,
  },
  balanceValue: {
    fontWeight: '600',
    color: '#1a73e8',
  },
  overdueText: {
    color: '#d32f2f',
  },
  payButton: {
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});

