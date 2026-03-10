import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from '../../components/SafeAreaView';
import { Surface, Text, Chip } from 'react-native-paper';
import { db } from '../../database/Database';
import { formatCurrency } from '../../utils/helpers';
import { formatProductQty, inferProductUnit } from '../../utils/productUnits';

interface ProductDetailScreenProps {
  route: any;
}

export function ProductDetailScreen({ route }: ProductDetailScreenProps) {
  const { productId } = route.params;
  const [product, setProduct] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const parsedProduct = (() => {
    try {
      return product?.data ? JSON.parse(product.data) : null;
    } catch {
      return null;
    }
  })();
  const unit = inferProductUnit(parsedProduct);

  useEffect(() => {
    loadProduct();
  }, [productId]);

  const loadProduct = async () => {
    try {
      const result = await db.queryFirst<any>(
        'SELECT * FROM products WHERE local_id = ?',
        [productId]
      );
      setProduct(result || null);
    } catch (error) {
      console.error('Error cargando detalle de producto:', error);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text>Cargando producto...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text>No se encontro el producto.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={styles.card}>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.price}>{formatCurrency(product.price_cents || 0)}</Text>

          <View style={styles.row}>
            <Text style={styles.label}>SKU:</Text>
            <Text style={styles.value}>{product.sku || 'N/A'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Stock:</Text>
            <Text style={styles.value}>{formatProductQty(product.stock ?? 0, unit)}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Costo:</Text>
            <Text style={styles.value}>{formatCurrency(product.cost_cents || 0)}</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Estado sync:</Text>
            <Chip compact>{product.synced === 1 ? 'Sincronizado' : 'Pendiente'}</Chip>
          </View>
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 10,
    padding: 16,
    backgroundColor: '#fff',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  price: {
    fontSize: 18,
    color: '#1a73e8',
    fontWeight: '600',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
  },
});
