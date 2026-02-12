import React, { useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Searchbar, Text, Surface, Button, IconButton, FAB, Badge } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useCartStore } from '../../store/cartStore';
import { db } from '../../database/Database';
import { Product } from '../../types';
import { formatCurrency } from '../../utils/helpers';

interface POSScreenProps {
  navigation: any;
}

interface POSProduct extends Product {
  isActive: boolean;
}

export function POSScreen({ navigation }: POSScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<POSProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const { items, addItem, getTotal, getItemCount } = useCartStore();

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadProducts();
    }, [])
  );

  const loadProducts = async () => {
    try {
      const result = await db.query<any>('SELECT * FROM products ORDER BY name');
      const mapped = result.map(row => ({
        localId: row.local_id,
        serverId: row.server_id,
        name: row.name,
        sku: row.sku,
        priceCents: row.price_cents,
        stock: row.stock,
        synced: row.synced === 1,
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
        data: row.data,
      }));
      setProducts(mapped);
    } catch (error) {
      console.error('Error cargando productos:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products
    .filter((product) => product.synced && !!product.serverId && product.isActive)
    .filter(product =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.sku && product.sku.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const handleProductPress = (product: POSProduct) => {
    if (!product.synced || !product.serverId || !product.isActive) {
      Alert.alert('Producto no disponible', 'Este producto no esta activo o no ha sido sincronizado.');
      return;
    }
    if (product.stock <= 0) {
      Alert.alert('Sin stock', 'Este producto no tiene stock disponible.');
      return;
    }
    addItem(product);
  };

  const handleScanBarcode = () => {
    navigation.navigate('BarcodeScanner', {
      onScan: (barcode: string) => {
        setSearchQuery(barcode);
      },
    });
  };

  const renderProduct = ({ item }: { item: POSProduct }) => (
    <TouchableOpacity onPress={() => handleProductPress(item)}>
      <Surface style={styles.productCard}>
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          {item.sku && <Text style={styles.productSku}>SKU: {item.sku}</Text>}
          <Text style={styles.productStock}>Stock: {item.stock}</Text>
        </View>
        <View style={styles.productPriceContainer}>
          <Text style={styles.productPrice}>{formatCurrency(item.priceCents)}</Text>
          <IconButton icon="plus-circle" size={28} onPress={() => handleProductPress(item)} />
        </View>
      </Surface>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.searchContainer}>
        <Searchbar
          placeholder="Buscar producto o código..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
        />
        <IconButton
          icon="barcode-scan"
          size={28}
          onPress={handleScanBarcode}
          style={styles.scanButton}
        />
      </View>

      <FlatList
        data={filteredProducts}
        renderItem={renderProduct}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.listContent}
        numColumns={2}
        columnWrapperStyle={styles.row}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {loading ? 'Cargando productos...' : 'No se encontraron productos'}
            </Text>
          </View>
        }
      />

      {getItemCount() > 0 && (
        <Surface style={styles.cartBar}>
          <View style={styles.cartInfo}>
            <Text style={styles.cartCount}>{getItemCount()} productos</Text>
            <Text style={styles.cartTotal}>{formatCurrency(getTotal())}</Text>
          </View>
          <Button
            mode="contained"
            onPress={() => navigation.navigate('Cart')}
            contentStyle={styles.cartButtonContent}
          >
            Ver Carrito
          </Button>
        </Surface>
      )}

      <FAB
        icon="barcode-scan"
        style={styles.fab}
        onPress={handleScanBarcode}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  searchbar: {
    flex: 1,
    elevation: 0,
    backgroundColor: '#f0f0f0',
  },
  scanButton: {
    marginLeft: 8,
  },
  listContent: {
    padding: 8,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'space-between',
  },
  productCard: {
    width: '48%',
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    elevation: 1,
  },
  productInfo: {
    marginBottom: 8,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  productSku: {
    fontSize: 12,
    color: '#666',
  },
  productStock: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  productPriceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
  cartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    elevation: 8,
  },
  cartInfo: {
    flex: 1,
  },
  cartCount: {
    fontSize: 14,
    color: '#666',
  },
  cartTotal: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  cartButtonContent: {
    paddingHorizontal: 16,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 90,
    backgroundColor: '#1a73e8',
  },
});
