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

interface CategoryListScreenProps {
  navigation: any;
}

interface CategoryItem {
  id: string;
  internalId?: string | null;
  name: string;
  description?: string | null;
}

export function CategoryListScreen({ navigation }: CategoryListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true);
      const clerkToken = await getToken();
      if (!clerkToken || !subUserToken) {
        setCategories([]);
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };

      const response = await axios.get(`${API_URL}/api/categories`, {
        headers,
      });

      const rows = (response.data?.data || []).map((item: any) => ({
        id: String(item.id ?? item.categoryId ?? ''),
        internalId: item.internalId ? String(item.internalId) : null,
        name: String(item.name || ''),
        description: item.description ? String(item.description) : null,
      }));
      setCategories(rows);
    } catch (error) {
      console.error('Error cargando categorías:', error);
      setCategories([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId, getToken, subUserToken]);

  useFocusEffect(
    useCallback(() => {
      loadCategories();
    }, [loadCategories])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCategories();
  };

  const filteredCategories = categories.filter(
    (item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderCategory = ({ item }: { item: CategoryItem }) => (
    <TouchableOpacity style={styles.categoryCard} onPress={() => navigation.navigate('AddCategory', { categoryId: item.id })}>
      <View style={styles.categoryInfo}>
        <Avatar.Text size={42} label={item.name.substring(0, 2).toUpperCase()} style={styles.avatar} labelStyle={styles.avatarLabel} />
        <View style={styles.categoryDetails}>
          <Text style={styles.categoryName}>{item.name}</Text>
          <Text style={styles.categoryId}>ID: {item.id}</Text>
          <Text style={styles.categoryDescription}>{item.description || 'Sin descripción'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Categorías</Text>
        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar categorías..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={filteredCategories}
        renderItem={renderCategory}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando categorías...' : 'No hay categorías'}</Text>
          </View>
        }
      />

      <SafeFab icon="plus" color="#fff" style={styles.fab} onPress={() => navigation.navigate('AddCategory')} />
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
  categoryCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  categoryInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { backgroundColor: '#EEE1FF' },
  avatarLabel: { color: ui.colors.primary, fontWeight: '700' },
  categoryDetails: { marginLeft: 10, flex: 1 },
  categoryName: { fontSize: 15, fontWeight: '700', color: ui.colors.text },
  categoryId: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  categoryDescription: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});
