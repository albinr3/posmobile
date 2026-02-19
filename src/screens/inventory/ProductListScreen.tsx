import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert, Image } from 'react-native';
import { Searchbar, Text, Chip, IconButton } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { SafeFab } from '../../components/SafeFab';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { Product } from '../../types';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface ProductListScreenProps {
  navigation: any;
}

export function ProductListScreen({ navigation }: ProductListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const syncingOnFocusRef = useRef(false);
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const syncOnEnter = async () => {
        await loadProducts();
        if (syncingOnFocusRef.current) return;
        syncingOnFocusRef.current = true;
        try {
          await syncProducts(false);
          if (active) await loadProducts();
        } finally {
          syncingOnFocusRef.current = false;
        }
      };
      syncOnEnter();
      return () => {
        active = false;
      };
    }, [])
  );

  const syncProducts = async (showSessionAlert: boolean) => {
    const clerkToken = await getToken();
    if (!clerkToken || !subUserToken) {
      if (showSessionAlert) {
        Alert.alert('Sincronización', 'No hay sesión activa para sincronizar.');
      }
      return false;
    }

    // Reintentar productos que quedaron en error en cola (ej: imagen no subida).
    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'pending', retry_count = 0
       WHERE entity_type = 'product' AND action IN ('create', 'update') AND status = 'error'`
    );

    syncService.setTokenGetter(getToken);
    syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
    await syncService.fullSync(clerkToken, { ignoreCooldown: true });
    return true;
  };

  const loadProducts = async () => {
    try {
      const result = await db.query<any>('SELECT * FROM products ORDER BY name');
      const mapped = result.map((row) => ({
        parsedData: (() => {
          try {
            return row.data ? JSON.parse(row.data) : null;
          } catch {
            return null;
          }
        })(),
        isActive: (() => {
          try {
            const parsed = row.data ? JSON.parse(row.data) : null;
            if (typeof parsed?.isActive === 'boolean') return parsed.isActive;
            if (typeof parsed?.active === 'boolean') return parsed.active;
          } catch {
            return true;
          }
          return true;
        })(),
        localId: row.local_id,
        serverId: row.server_id,
        name: row.name,
        sku: row.sku,
        priceCents: row.price_cents,
        costCents: row.cost_cents,
        stock: row.stock,
        imageUrl: row.image_url || null,
        synced: row.synced === 1,
        data: row.data,
      }));
      setProducts(mapped);
    } catch (error) {
      console.error('Error cargando productos:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncProducts(true);
    } catch (error) {
      console.error('Error sincronizando productos:', error);
    }
    await loadProducts();
  };

  const filteredProducts = products
    .filter((product: any) => product.isActive !== false)
    .filter(
      (product) =>
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (product.sku && product.sku.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const getProductImage = (item: any) => {
    const fromParsed = Array.isArray(item.parsedData?.imageUrls) ? item.parsedData.imageUrls[0] : null;
    const fromLocalPending = item.parsedData?.imageUri ? String(item.parsedData.imageUri) : null;
    return fromParsed || fromLocalPending || item.imageUrl || null;
  };

  const goToEditProduct = (productId: string) => {
    navigation.navigate('ProductEdit', { productId });
  };

  const renderListProduct = ({ item }: { item: Product }) => (
    <TouchableOpacity style={styles.productCard} onPress={() => goToEditProduct(item.localId)}>
      <View style={styles.middle}>
        <Text numberOfLines={1} style={styles.name}>
          {item.name}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{item.sku ? item.sku : 'Sin SKU'}</Text>
          <Text style={styles.separatorDot}>•</Text>
          <Text style={[styles.stock, item.stock <= 0 ? styles.out : item.stock <= 10 ? styles.low : styles.ok]}>
            {item.stock <= 10 && item.stock > 0 ? `Bajo: ${item.stock}` : `Stock: ${item.stock}`}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={styles.price}>{formatCurrency(item.priceCents)}</Text>
        {!item.synced ? (
          <Chip compact style={styles.pendingChip} textStyle={styles.pendingChipText}>
            Pendiente
          </Chip>
        ) : null}
      </View>
      <View style={styles.actionsCol}>
        <TouchableOpacity onPress={() => goToEditProduct(item.localId)}>
          <IconButton icon="pencil" size={16} iconColor="#b295e8" style={styles.editButtonIcon} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderGridProduct = ({ item }: { item: Product }) => (
    <TouchableOpacity style={styles.gridRowCard} onPress={() => goToEditProduct(item.localId)}>
      <View style={styles.gridImageWrap}>
        {getProductImage(item) ? (
          <Image source={{ uri: getProductImage(item) }} style={styles.gridImage} resizeMode="cover" />
        ) : (
          <View style={styles.gridPlaceholder}>
            <IconButton icon="package-variant-closed" size={22} iconColor="#b8a3e9" />
          </View>
        )}
      </View>
      <View style={styles.gridInfo}>
        <View style={styles.gridTopRow}>
          <Text numberOfLines={1} style={styles.gridName}>
            {item.name}
          </Text>
          <Text style={styles.gridPrice}>{formatCurrency(item.priceCents)}</Text>
        </View>
        <View style={styles.gridMetaRow}>
          <Text style={styles.gridMetaSku}>{item.sku ? item.sku : 'Sin SKU'}</Text>
          <Text style={styles.gridMetaDot}>•</Text>
          <Text style={[styles.gridStock, item.stock <= 0 ? styles.out : item.stock <= 10 ? styles.low : styles.ok]}>
            {item.stock <= 10 && item.stock > 0 ? `Bajo: ${item.stock}` : `Stock: ${item.stock}`}
          </Text>
        </View>
      </View>
      <View style={styles.gridActionsCol}>
        <TouchableOpacity onPress={() => goToEditProduct(item.localId)}>
          <IconButton icon="pencil" size={16} iconColor="#b295e8" style={styles.editButtonIcon} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Productos</Text>
        </View>
        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar..."
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
            placeholderTextColor="#B8B2C8"
          />
          <IconButton icon="barcode-scan" size={19} iconColor={ui.colors.primary} onPress={() => navigation.navigate('BarcodeScanner')} />
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewButton, viewMode === 'grid' && styles.viewButtonActive]}
              onPress={() => setViewMode('grid')}
            >
              <IconButton icon="view-grid-outline" size={17} iconColor={viewMode === 'grid' ? ui.colors.primary : '#fff'} style={styles.toggleIcon} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewButton, viewMode === 'list' && styles.viewButtonActive]}
              onPress={() => setViewMode('list')}
            >
              <IconButton icon="format-list-bulleted" size={17} iconColor={viewMode === 'list' ? ui.colors.primary : '#fff'} style={styles.toggleIcon} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <FlatList
        key={viewMode}
        data={filteredProducts}
        renderItem={viewMode === 'grid' ? renderGridProduct : renderListProduct}
        numColumns={1}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={viewMode === 'grid' ? styles.gridList : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando productos...' : 'No hay productos'}</Text>
          </View>
        }
      />

      <SafeFab icon="plus" color="#fff" style={styles.fab} bottomOffset={8} rightOffset={18} onPress={() => navigation.navigate('AddProduct')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f2f7' },
  header: {
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    elevation: 6,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headerTitle: { color: '#fff', fontSize: 40 / 1.6, fontWeight: '800' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchbar: { flex: 1, elevation: 0, backgroundColor: '#fff', borderRadius: 10, minHeight: 42, justifyContent: 'center' },
  searchInput: { minHeight: 36, color: '#31244b', fontSize: 14 },
  viewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 10,
    padding: 2,
    marginRight: 2,
  },
  viewButton: { borderRadius: 8 },
  viewButtonActive: { backgroundColor: '#fff' },
  toggleIcon: { margin: 0 },
  list: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 130 },
  gridList: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 130 },
  productCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e9e5f0',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thumbnailWrap: { width: 44, height: 44, borderRadius: 6, overflow: 'hidden', backgroundColor: '#f3f0f9' },
  thumbnail: { width: '100%', height: '100%' },
  placeholderThumb: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  middle: { flex: 1, justifyContent: 'center' },
  right: { alignItems: 'flex-end', minWidth: 88 },
  name: { color: '#5d3db3', fontSize: 15, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  meta: { color: '#8f88a4', fontSize: 11, fontWeight: '600' },
  separatorDot: { color: '#c7bddb', fontSize: 12, marginHorizontal: 4 },
  price: { color: ui.colors.primary, fontSize: 15, fontWeight: '900' },
  stock: { fontSize: 11, fontWeight: '700' },
  ok: { color: ui.colors.success },
  low: { color: '#da5164' },
  out: { color: ui.colors.danger },
  pendingChip: { marginTop: 4, backgroundColor: '#EEE1FF', height: 20 },
  pendingChipText: { color: ui.colors.primary, fontSize: 10 },
  actionsCol: {
    borderLeftWidth: 1,
    borderLeftColor: '#eee7fa',
    paddingLeft: 4,
    marginLeft: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonIcon: { margin: 0 },
  gridRowCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e9e5f0',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gridImageWrap: {
    width: 56,
    height: 56,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#f3f0f9',
  },
  gridImage: { width: '100%', height: '100%' },
  gridPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  gridInfo: { flex: 1, justifyContent: 'center' },
  gridTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  gridName: { flex: 1, color: '#5d3db3', fontSize: 30 / 2.3, fontWeight: '800' },
  gridPrice: { color: ui.colors.primary, fontSize: 30 / 2.3, fontWeight: '900' },
  gridMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  gridMetaSku: { color: '#7f6cab', fontSize: 11, fontWeight: '600' },
  gridMetaDot: { color: '#c7bddb', fontSize: 12, marginHorizontal: 4 },
  gridStock: { fontSize: 11, fontWeight: '700' },
  gridActionsCol: {
    borderLeftWidth: 1,
    borderLeftColor: '#eee7fa',
    paddingLeft: 4,
    marginLeft: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: { paddingVertical: 50, alignItems: 'center' },
  emptyText: { color: ui.colors.textMuted },
  fab: {
    backgroundColor: ui.colors.primary,
    shadowColor: ui.colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});


