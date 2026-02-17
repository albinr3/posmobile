import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Searchbar, Text, Chip } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface PurchaseListScreenProps {
  navigation: any;
}

interface PurchaseItem {
  id: string;
  purchasedAt: string;
  supplierName?: string | null;
  notes?: string | null;
  totalCents: number;
  cancelledAt?: string | null;
  itemsCount: number;
}

export function PurchaseListScreen({ navigation }: PurchaseListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();

  const loadPurchases = async () => {
    try {
      setLoading(true);
      const clerkToken = await getToken();
      if (!clerkToken || !subUserToken) {
        setPurchases([]);
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };

      const response = await axios.get(`${API_URL}/api/purchases`, { headers });
      const rows = (response.data?.data || []).map((item: any) => ({
        id: String(item.id),
        purchasedAt: String(item.purchasedAt || ''),
        supplierName: item.supplierName ? String(item.supplierName) : null,
        notes: item.notes ? String(item.notes) : null,
        totalCents: Number(item.totalCents || 0),
        cancelledAt: item.cancelledAt ? String(item.cancelledAt) : null,
        itemsCount: Number(item.itemsCount || 0),
      }));
      setPurchases(rows);
    } catch (error) {
      console.error('Error cargando compras:', error);
      setPurchases([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadPurchases();
    }, [accountId, subUserToken])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPurchases();
  };

  const filteredPurchases = purchases.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (item.supplierName || '').toLowerCase().includes(q) ||
      (item.notes || '').toLowerCase().includes(q)
    );
  });

  const renderPurchase = ({ item }: { item: PurchaseItem }) => (
    <TouchableOpacity style={styles.purchaseCard} onPress={() => navigation.navigate('AddPurchase', { purchaseId: item.id })}>
      <View style={styles.rowBetween}>
        <Text style={styles.supplierName}>{item.supplierName || 'Proveedor no especificado'}</Text>
        {item.cancelledAt ? (
          <Chip compact style={styles.cancelledChip} textStyle={styles.cancelledChipText}>
            Cancelada
          </Chip>
        ) : null}
      </View>

      <Text style={styles.meta}>Fecha: {formatDate(new Date(item.purchasedAt).getTime())}</Text>
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
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
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
  supplierName: { fontSize: 15, fontWeight: '700', color: ui.colors.text, flex: 1, marginRight: 8 },
  cancelledChip: { backgroundColor: '#FDE8E8', height: 24 },
  cancelledChipText: { color: ui.colors.danger, fontSize: 10 },
  meta: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  totalRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: ui.colors.textMuted, fontSize: 12, fontWeight: '700' },
  totalValue: { color: ui.colors.text, fontSize: 16, fontWeight: '800' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});
