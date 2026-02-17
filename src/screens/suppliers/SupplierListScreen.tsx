import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Searchbar, Text, Avatar } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { ui } from '../../theme/ui';

interface SupplierListScreenProps {
  navigation: any;
}

interface SupplierItem {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
}

export function SupplierListScreen({ navigation }: SupplierListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      const clerkToken = await getToken();
      if (!clerkToken || !subUserToken) {
        setSuppliers([]);
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };

      const response = await axios.get(`${API_URL}/api/suppliers`, { headers });
      const rows = (response.data?.data || []).map((item: any) => ({
        id: String(item.id),
        name: String(item.name || ''),
        contactName: item.contactName ? String(item.contactName) : null,
        phone: item.phone ? String(item.phone) : null,
      }));
      setSuppliers(rows);
    } catch (error) {
      console.error('Error cargando proveedores:', error);
      setSuppliers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId, getToken, subUserToken]);

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
    <TouchableOpacity style={styles.supplierCard} onPress={() => navigation.navigate('AddSupplier', { supplierId: item.id })}>
      <View style={styles.supplierInfo}>
        <Avatar.Text size={42} label={item.name.substring(0, 2).toUpperCase()} style={styles.avatar} labelStyle={styles.avatarLabel} />
        <View style={styles.supplierDetails}>
          <Text style={styles.supplierName}>{item.name}</Text>
          <Text style={styles.supplierMeta}>{item.contactName || 'Sin contacto'}</Text>
          <Text style={styles.supplierMeta}>{item.phone || 'Sin teléfono'}</Text>
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
        keyExtractor={(item) => item.id}
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
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});
