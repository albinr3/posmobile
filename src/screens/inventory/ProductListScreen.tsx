import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { Searchbar, Text, Surface, FAB, Chip, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { Product } from '../../types';
import { formatCurrency } from '../../utils/helpers';

interface ProductListScreenProps {
  navigation: any;
}

export function ProductListScreen({ navigation }: ProductListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'low_stock' | 'out_of_stock'>('all');
  
  // NUEVO: Agregar hooks para autenticación
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [])
  );

  const loadProducts = async () => {
    try {
      const result = await db.query<any>('SELECT * FROM products ORDER BY name');
      const mapped = result.map(row => ({
        isActive: (() => {
          try {
            const parsed = row.data ? JSON.parse(row.data) : null;
            if (typeof parsed?.isActive === 'boolean') return parsed.isActive;
            if (typeof parsed?.active === 'boolean') return parsed.active;
          } catch {
            // no-op
          }
          return true;
        })(),
        localId: row.local_id,
        serverId: row.server_id,
        name: row.name,
        sku: row.sku,
        reference: row.reference,
        barcode: row.barcode,
        priceCents: row.price_cents,
        costCents: row.cost_cents,
        stock: row.stock,
        minStock: row.min_stock,
        categoryId: row.category_id,
        categoryName: row.category_name,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        unit: row.unit,
        imageUrl: row.image_url,
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

  // MODIFICADO: Agregar sincronización con el servidor
  const onRefresh = async () => {
    setRefreshing(true);
    
    try {
      // Sincronizar con el servidor
      const clerkToken = await getToken();
      if (clerkToken && subUserToken) {
        console.log('🔄 Sincronizando productos desde el servidor...');
        
        // Configurar funciones de obtención de tokens
        syncService.setGetTokenFunction(getToken);
        syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
        
        // Ejecutar sincronización
        await syncService.fullSync(clerkToken);
        console.log('✅ Productos sincronizados correctamente');
      } else {
        console.warn('⚠️ No hay tokens de autenticación disponibles para sincronizar');
      }
    } catch (error) {
      console.error('❌ Error sincronizando productos:', error);
      // No mostrar error al usuario, solo registrar en consola
    }
    
    // Recargar productos de la BD local
    await loadProducts();
  };

  const filteredProducts = products
    .filter(product => {
      if (product.isActive === false) return false;
      if (filter === 'low_stock') return product.stock > 0 && product.stock <= 10;
      if (filter === 'out_of_stock') return product.stock <= 0;
      return true;
    })
    .filter(product =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.sku && product.sku.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const getStockColor = (stock: number) => {
    if (stock <= 0) return '#d32f2f';
    if (stock <= 10) return '#f57c00';
    return '#4caf50';
  };

  const renderProduct = ({ item }: { item: Product }) => (
    <Surface 
      style={styles.productCard}
      onTouchEnd={() => navigation.navigate('ProductDetail', { productId: item.localId })}
    >
      <View style={styles.productInfo}>
        <Text style={styles.productName}>{item.name}</Text>
        {item.sku && <Text style={styles.productSku}>SKU: {item.sku}</Text>}
        <Text style={styles.productPrice}>{formatCurrency(item.priceCents)}</Text>
      </View>
      <View style={styles.stockInfo}>
        <Text style={[styles.stockText, { color: getStockColor(item.stock) }]}>
          Stock: {item.stock}
        </Text>
        {!item.synced && (
          <Chip 
            icon="cloud-upload" 
            style={styles.pendingChip}
            textStyle={styles.pendingChipText}
            compact
          >
            Pendiente
          </Chip>
        )}
      </View>
    </Surface>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Buscar productos..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
        />
        <View style={styles.filterContainer}>
          <Chip
            selected={filter === 'all'}
            onPress={() => setFilter('all')}
            style={styles.filterChip}
          >
            Todos
          </Chip>
          <Chip
            selected={filter === 'low_stock'}
            onPress={() => setFilter('low_stock')}
            style={styles.filterChip}
          >
            Stock Bajo
          </Chip>
          <Chip
            selected={filter === 'out_of_stock'}
            onPress={() => setFilter('out_of_stock')}
            style={styles.filterChip}
          >
            Sin Stock
          </Chip>
        </View>
      </View>

      <FlatList
        data={filteredProducts}
        renderItem={renderProduct}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#1a73e8']}
            tintColor="#1a73e8"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {loading ? 'Cargando productos...' : 'No hay productos'}
            </Text>
            {!loading && (
              <Text style={[styles.emptyText, { marginTop: 8, fontSize: 14 }]}>
                Desliza hacia abajo para sincronizar
              </Text>
            )}
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AddProduct')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchbar: {
    marginBottom: 12,
  },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    marginRight: 8,
  },
  list: {
    padding: 16,
  },
  productCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: 'white',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  productSku: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 14,
    color: '#1a73e8',
    fontWeight: '500',
  },
  stockInfo: {
    alignItems: 'flex-end',
  },
  stockText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pendingChip: {
    marginTop: 4,
    height: 24,
  },
  pendingChipText: {
    fontSize: 10,
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
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: '#1a73e8',
  },
});
