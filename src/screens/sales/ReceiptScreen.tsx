import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Share } from 'react-native';
import { Text, Surface, Button, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../database/Database';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { Sale, SaleItem } from '../../types';

interface ReceiptScreenProps {
  navigation: any;
  route?: {
    params?: {
      saleId?: string;
      invoiceCode?: string;
    };
  };
}

export function ReceiptScreen({ navigation, route }: ReceiptScreenProps) {
  const saleId = route?.params?.saleId || '';
  const invoiceCode = route?.params?.invoiceCode || '';
  const [sale, setSale] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSale();
  }, []);

  const loadSale = async () => {
    try {
      const result = await db.queryFirst<any>(
        'SELECT * FROM sales WHERE local_id = ?',
        [saleId]
      );
      if (result) {
        const saleData = JSON.parse(result.data);
        setSale({
          ...result,
          ...saleData,
        });
      }
    } catch (error) {
      console.error('Error cargando venta:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!sale) return;

    const items = sale.items
      .map((item: SaleItem) => `${item.productName} x${item.quantity} - ${formatCurrency(item.totalCents)}`)
      .join('\n');

    const message = `
🧾 *Factura ${invoiceCode}*
Fecha: ${formatDateTime(sale.createdAt)}
${sale.customerName ? `Cliente: ${sale.customerName}` : ''}

*Productos:*
${items}

*Total: ${formatCurrency(sale.totalCents)}*

Gracias por su compra!
- MOVOPos
    `.trim();

    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error compartiendo:', error);
    }
  };

  const handlePrint = () => {
    navigation.navigate('PrintReceipt', { saleId, invoiceCode });
  };

  const handleNewSale = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'POS' }],
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Cargando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!sale) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Venta no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Surface style={styles.receiptCard}>
          <View style={styles.successIcon}>
            <Text style={styles.checkmark}>✓</Text>
          </View>
          
          <Text style={styles.successText}>¡Venta Completada!</Text>

          <Divider style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.label}>Factura:</Text>
            <Text style={styles.value}>{invoiceCode}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Fecha:</Text>
            <Text style={styles.value}>{formatDateTime(sale.createdAt)}</Text>
          </View>

          {sale.customerName && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Cliente:</Text>
              <Text style={styles.value}>{sale.customerName}</Text>
            </View>
          )}

          <View style={styles.infoRow}>
            <Text style={styles.label}>Método de Pago:</Text>
            <Text style={styles.value}>{sale.paymentMethod}</Text>
          </View>

          <Divider style={styles.divider} />

          <Text style={styles.sectionTitle}>Productos</Text>
          {sale.items?.map((item: SaleItem, index: number) => (
            <View key={index} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.productName}</Text>
                <Text style={styles.itemQty}>x{item.quantity} @ {formatCurrency(item.priceCents)}</Text>
              </View>
              <Text style={styles.itemTotal}>{formatCurrency(item.totalCents)}</Text>
            </View>
          ))}

          <Divider style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(sale.totalCents)}</Text>
          </View>
        </Surface>

        <View style={styles.actions}>
          <Button
            mode="outlined"
            icon="share-variant"
            onPress={handleShare}
            style={styles.actionButton}
          >
            Compartir
          </Button>

          <Button
            mode="outlined"
            icon="printer"
            onPress={handlePrint}
            style={styles.actionButton}
          >
            Imprimir
          </Button>
        </View>

        <Button
          mode="contained"
          icon="plus"
          onPress={handleNewSale}
          style={styles.newSaleButton}
          contentStyle={styles.newSaleButtonContent}
        >
          Nueva Venta
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
  },
  receiptCard: {
    padding: 20,
    borderRadius: 12,
    elevation: 2,
  },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4caf50',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  checkmark: {
    fontSize: 32,
    color: '#fff',
  },
  successText: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  divider: {
    marginVertical: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
  },
  itemQty: {
    fontSize: 12,
    color: '#666',
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '500',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  newSaleButton: {
    marginTop: 16,
  },
  newSaleButtonContent: {
    paddingVertical: 8,
  },
});
