import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Searchbar, Text, Avatar, Chip } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useSyncStore } from '../../store/syncStore';
import { useSyncAuth } from '../../hooks/useSyncAuth';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';

interface CategoryListScreenProps {
  navigation: any;
}

interface CategoryItem {
  localId: string;
  serverId: string | null;
  internalId?: string | null;
  name: string;
  description?: string | null;
  synced: boolean;
}

export function CategoryListScreen({ navigation }: CategoryListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { isOnline } = useSyncStore();
  const { runFullSyncIfAuthenticated } = useSyncAuth();
  const isSyncingOnFocusRef = useRef(false);
  const isOnlineRef = useRef(isOnline);

  isOnlineRef.current = isOnline;

  const mapCategoryRows = useCallback((rows: any[]): CategoryItem[] => {
    return rows.map((row) => {
      let parsed: any = null;
      try {
        parsed = row?.data ? JSON.parse(row.data) : null;
      } catch {
        parsed = null;
      }
      const serverId = row.server_id ? String(row.server_id) : null;
      return {
        localId: String(row.local_id),
        serverId,
        internalId: parsed?.internalId ? String(parsed.internalId) : null,
        name: String(row.name || parsed?.name || ''),
        description:
          typeof row.description === 'string'
            ? row.description
            : typeof parsed?.description === 'string'
              ? parsed.description
              : null,
        synced: row.synced === 1,
      };
    });
  }, []);

  const loadCategoriesFromDb = useCallback(async () => {
    const rows = await db.query<any>(
      'SELECT local_id, server_id, name, description, synced, data FROM categories ORDER BY name ASC'
    );
    setCategories(mapCategoryRows(rows));
  }, [mapCategoryRows]);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      await loadCategoriesFromDb();
    } catch (error) {
      console.error('Error cargando categorías:', error);
      setCategories([]);
    } finally {
      setLoading(false);
    }

    try {
      const synced = await runFullSyncIfAuthenticated({
        isOnline: isOnlineRef.current,
        ignoreCooldown: true,
      });
      if (!synced) return;

      await loadCategoriesFromDb();
    } catch (error) {
      console.error('Error sincronizando categorías:', error);
    } finally {
      setRefreshing(false);
    }
  }, [loadCategoriesFromDb, runFullSyncIfAuthenticated]);

  useFocusEffect(
    useCallback(() => {
      if (isSyncingOnFocusRef.current) return;
      isSyncingOnFocusRef.current = true;
      let active = true;

      const run = async () => {
        await loadCategories();
        if (active) {
          isSyncingOnFocusRef.current = false;
        }
      };

      run().catch((error) => {
        console.error('Error en focus de categorías:', error);
        if (active) {
          isSyncingOnFocusRef.current = false;
        }
      });

      return () => {
        active = false;
        isSyncingOnFocusRef.current = false;
      };
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
    <TouchableOpacity style={styles.categoryCard} onPress={() => navigation.navigate('AddCategory', { categoryId: item.localId })}>
      <View style={styles.categoryInfo}>
        <Avatar.Text size={42} label={item.name.substring(0, 2).toUpperCase()} style={styles.avatar} labelStyle={styles.avatarLabel} />
        <View style={styles.categoryDetails}>
          <Text style={styles.categoryName}>{item.name}</Text>
          <Text style={styles.categoryId}>ID: {item.serverId || item.localId}</Text>
          <Text style={styles.categoryDescription}>{item.description || 'Sin descripción'}</Text>
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
        keyExtractor={(item) => item.localId}
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
  pendingChip: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#FFE8CC', height: 23 },
  pendingChipText: { color: ui.colors.warning, fontSize: 10 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
  fab: { backgroundColor: ui.colors.primary },
});

