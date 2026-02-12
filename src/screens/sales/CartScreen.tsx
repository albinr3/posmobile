import React, { useState } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Surface, Button, IconButton, Divider, Menu } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCartStore } from '../../store/cartStore';
import { formatCurrency, generateInvoiceCode, generateLocalId } from '../../utils/helpers';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';

interface CartScreenProps {
  navigation: any;
}

export function CartScreen({ navigation }: CartScreenProps) {
  const { items, updateQuantity, removeItem, getTotal, customerId, customerName, paymentMethod, setPaymentMethod, clear } = useCartStore();
  const [loading, setLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const paymentMethods = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Tarjeta', value: 'TARJETA' },
    { label: 'Transferencia', value: 'TRANSFERENCIA' },
    { label: 'Crédito', value: 'CREDITO' },
  ];

  const handleCompleteSale = async () => {
    if (items.length === 0) return;

    setLoading(true);
    try {
      const localId = generateLocalId();
      const invoiceCode = generateInvoiceCode();
      const now = Date.now();

      const saleData = {
        localId,
        invoiceCode,
        customerId,
        customerName,
        items,
        totalCents: getTotal(),
        paymentMethod,
        status: 'completed',
        createdAt: now,
      };

      // Guardar venta en SQLite
      await db.insert('sales', {
        local_id: localId,
        invoice_code: invoiceCode,
        customer_id: customerId,
        total_cents: getTotal(),
        status: 'completed',
        created_at: now,
        synced: 0,
        data: JSON.stringify(saleData),
      });

      // Agregar a cola de sincronización y disparar procesamiento si hay internet
      await syncService.queueOperation('sale', 'create', saleData, localId);

      // Actualizar stock localmente
      for (const item of items) {
        await db.runAsync(
          'UPDATE products SET stock = stock - ? WHERE local_id = ?',
          [item.quantity, item.productId]
        );
      }

      // Limpiar carrito
      clear();

      // Navegar a recibo
      navigation.navigate('Receipt', { saleId: localId, invoiceCode });
    } catch (error) {
      console.error('Error completando venta:', error);
      Alert.alert('Error', 'No se pudo completar la venta');
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: typeof items[0] }) => (
    <Surface style={styles.itemCard}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={2}>{item.productName}</Text>
        <Text style={styles.itemPrice}>{formatCurrency(item.priceCents)} c/u</Text>
      </View>
      <View style={styles.quantityContainer}>
        <IconButton
          icon="minus"
          size={20}
          onPress={() => updateQuantity(item.productId, item.quantity - 1)}
        />
        <Text style={styles.quantity}>{item.quantity}</Text>
        <IconButton
          icon="plus"
          size={20}
          onPress={() => updateQuantity(item.productId, item.quantity + 1)}
        />
      </View>
      <View style={styles.itemTotal}>
        <Text style={styles.itemTotalText}>{formatCurrency(item.totalCents)}</Text>
        <IconButton
          icon="delete"
          size={20}
          iconColor="#d32f2f"
          onPress={() => removeItem(item.productId)}
        />
      </View>
    </Surface>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.productId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>El carrito está vacío</Text>
            <Button mode="contained" onPress={() => navigation.goBack()}>
              Agregar Productos
            </Button>
          </View>
        }
      />

      {items.length > 0 && (
        <Surface style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Cliente:</Text>
            <Button mode="text" onPress={() => navigation.navigate('SelectCustomer')}>
              {customerName || 'Seleccionar'}
            </Button>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Método de Pago:</Text>
            <Menu
              visible={menuVisible}
              onDismiss={() => setMenuVisible(false)}
              anchor={
                <Button mode="text" onPress={() => setMenuVisible(true)}>
                  {paymentMethods.find(m => m.value === paymentMethod)?.label}
                </Button>
              }
            >
              {paymentMethods.map((method) => (
                <Menu.Item
                  key={method.value}
                  onPress={() => {
                    setPaymentMethod(method.value);
                    setMenuVisible(false);
                  }}
                  title={method.label}
                />
              ))}
            </Menu>
          </View>

          <Divider style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{formatCurrency(getTotal())}</Text>
          </View>

          <Button
            mode="contained"
            onPress={handleCompleteSale}
            loading={loading}
            disabled={loading}
            style={styles.completeButton}
            contentStyle={styles.completeButtonContent}
          >
            Completar Venta
          </Button>
        </Surface>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  listContent: {
    padding: 12,
    paddingBottom: 240,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    elevation: 1,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemPrice: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  quantity: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'center',
  },
  itemTotal: {
    alignItems: 'flex-end',
  },
  itemTotalText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  summaryCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  divider: {
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  completeButton: {
    marginTop: 8,
  },
  completeButtonContent: {
    paddingVertical: 8,
  },
});
