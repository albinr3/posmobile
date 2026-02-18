import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, Alert } from 'react-native';
import { Text, Surface, Button, IconButton, Divider, Menu } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { useCartStore } from '../../store/cartStore';
import { formatCurrency, generateInvoiceCode, generateLocalId } from '../../utils/helpers';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { ui } from '../../theme/ui';
import { Asset } from 'expo-asset';
import { getBottomSafeInset } from '../../utils/safeArea';

interface CartScreenProps {
  navigation: any;
  route?: {
    params?: {
      customerId?: string | null;
      customerName?: string | null;
      editSaleLocalId?: string | null;
    };
  };
}

const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('es-DO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDateOnly = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString('es-DO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

export function CartScreen({ navigation, route }: CartScreenProps) {
  const insets = useSafeAreaInsets();
  const systemBottomInset = getBottomSafeInset(insets.bottom);
  const {
    items,
    updateQuantity,
    removeItem,
    getTotal,
    customerId,
    customerName,
    paymentMethod,
    setPaymentMethod,
    clear,
    editingSaleLocalId,
    editingInvoiceCode,
    clearEditContext,
  } = useCartStore();
  const logoUri = Asset.fromModule(require('../../../assets/movoLogoDark.png')).uri;
  const [loading, setLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const { setCustomer } = useCartStore();

  useFocusEffect(
    useCallback(() => {
      const routeCustomerId = route?.params?.customerId;
      const routeCustomerName = route?.params?.customerName;

      if (typeof routeCustomerId !== 'undefined' || typeof routeCustomerName !== 'undefined') {
        setCustomer(routeCustomerId ?? null, routeCustomerName ?? null);
      }
    }, [route?.params?.customerId, route?.params?.customerName, setCustomer])
  );

  const resolveLocalProductId = async (rawProductId: string): Promise<string | null> => {
    if (!rawProductId) return null;
    const row = await db.queryFirst<{ local_id: string }>(
      'SELECT local_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
      [rawProductId, rawProductId]
    );
    return row?.local_id || null;
  };

  const queueSaleUpdateForEdit = async (saleLocalId: string, salePayload: any) => {
    const serverRow = await db.queryFirst<{ server_id?: string }>(
      'SELECT server_id FROM sales WHERE local_id = ?',
      [saleLocalId]
    );

    if (serverRow?.server_id) {
      await syncService.queueOperation('sale', 'update', { ...salePayload, id: serverRow.server_id }, saleLocalId);
      return;
    }

    // Si no tiene server_id aún, actualizar el pending create existente para evitar PUT inválido.
    const pendingCreate = await db.queryFirst<{ id: number }>(
      `SELECT id
       FROM sync_queue
       WHERE entity_type = ? AND entity_local_id = ? AND action = ? AND status = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      ['sale', saleLocalId, 'create', 'pending']
    );

    if (pendingCreate?.id) {
      await db.update('sync_queue', String(pendingCreate.id), { data: JSON.stringify(salePayload) }, 'id');
    }
  };

  const paymentMethods = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Tarjeta', value: 'TARJETA' },
    { label: 'Transferencia', value: 'TRANSFERENCIA' },
    { label: 'Crédito', value: 'CREDITO' },
  ];

  const handleCompleteSale = async () => {
    if (items.length === 0) return;

    if (paymentMethod === 'CREDITO') {
      if (!customerId) {
        Alert.alert('Cliente requerido', 'Para vender a crédito debes seleccionar un cliente.');
        return;
      }

      const customerRow = await db.queryFirst<{ data?: string; name?: string }>(
        'SELECT data, name FROM customers WHERE local_id = ?',
        [customerId]
      );

      let creditEnabled = false;
      try {
        const customerData = customerRow?.data ? JSON.parse(customerRow.data) : null;
        const rawCreditEnabled = customerData?.creditEnabled ?? customerData?.credit_enabled ?? false;
        creditEnabled = rawCreditEnabled === true || rawCreditEnabled === 1 || rawCreditEnabled === '1';
      } catch {
        creditEnabled = false;
      }

      if (!creditEnabled) {
        Alert.alert(
          'Crédito no habilitado',
          `El cliente ${customerRow?.name || customerName || ''} no tiene crédito habilitado.`
        );
        return;
      }
    }

    setLoading(true);
    try {
      let localId = generateLocalId();
      let invoiceCode = generateInvoiceCode();
      const now = Date.now();
      let createdAt = now;
      let resolvedInvoiceCode = invoiceCode;

      const basePayload = {
        customerId,
        customerName,
        items: items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          priceCents: item.priceCents,
          unitPriceCents: item.priceCents,
          totalCents: item.totalCents,
          wasPriceOverridden: false,
        })),
        totalCents: getTotal(),
        paymentMethod,
        type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
        shippingCents: 0,
        status: 'completed',
      };

      if (editingSaleLocalId) {
        localId = editingSaleLocalId;
        const existing = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [editingSaleLocalId]);
        if (!existing) {
          Alert.alert('Factura', 'No se encontró la factura que estás editando.');
          setLoading(false);
          return;
        }

        resolvedInvoiceCode = String(existing.invoice_code || editingInvoiceCode || '-');
        invoiceCode = resolvedInvoiceCode;
        createdAt = Number(existing.created_at || now);

        let existingData: any = null;
        try {
          existingData = existing.data ? JSON.parse(existing.data) : null;
        } catch {
          existingData = null;
        }

        const oldItems = Array.isArray(existingData?.items) ? existingData.items : [];

        // Revertir stock anterior
        for (const oldItem of oldItems) {
          const qty = Number(oldItem?.quantity ?? oldItem?.qty ?? 0);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          const localProductId = await resolveLocalProductId(String(oldItem?.productId || ''));
          if (!localProductId) continue;
          await db.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [qty, localProductId]);
        }

        // Aplicar stock nuevo
        for (const item of items) {
          await db.runAsync('UPDATE products SET stock = stock - ? WHERE local_id = ?', [item.quantity, item.productId]);
        }

        const updatedData = {
          ...(existingData || {}),
          localId: editingSaleLocalId,
          invoiceCode: resolvedInvoiceCode,
          createdAt,
          soldAt: createdAt,
          ...basePayload,
          editedAt: now,
        };

        await db.update('sales', editingSaleLocalId, {
          customer_id: customerId,
          total_cents: getTotal(),
          status: 'completed',
          synced: 0,
          data: JSON.stringify(updatedData),
        });

        await queueSaleUpdateForEdit(editingSaleLocalId, {
          customerId,
          type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
          paymentMethod,
          createdAt,
          soldAt: createdAt,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: item.priceCents,
            price: item.priceCents / 100,
            wasPriceOverridden: false,
          })),
          shippingCents: 0,
          status: 'completed',
        });
      } else {
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
          soldAt: now,
        };

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

        await syncService.queueOperation('sale', 'create', saleData, localId);

        const syncedSale = await db.queryFirst<{ invoice_code?: string }>(
          'SELECT invoice_code FROM sales WHERE local_id = ?',
          [localId]
        );
        resolvedInvoiceCode = syncedSale?.invoice_code || invoiceCode;

        for (const item of items) {
          await db.runAsync('UPDATE products SET stock = stock - ? WHERE local_id = ?', [item.quantity, item.productId]);
        }
      }

      const itemsRows = items
        .map(
          (item) => `
            <div class="item">
              <div class="item-name">${escapeHtml(item.productName)}</div>
              <div class="item-meta">Cod: — · Ref: —</div>
              <div class="item-line">
                <span>${item.quantity} x ${formatCurrency(item.priceCents)}</span>
                <span class="item-total">${formatCurrency(item.totalCents)}</span>
              </div>
            </div>
          `
        )
        .join('');

      const subtotalCents = Math.round(getTotal() / 1.18);
      const itbisCents = getTotal() - subtotalCents;
      const saleTypeLabel = paymentMethod === 'CREDITO' ? 'Crédito' : 'Contado';
      const paymentMethodLabel =
        paymentMethod === 'EFECTIVO'
          ? 'Efectivo'
          : paymentMethod === 'TARJETA'
            ? 'Tarjeta'
            : paymentMethod === 'TRANSFERENCIA'
              ? 'Transferencia'
              : paymentMethod === 'CREDITO'
                ? 'Crédito'
                : paymentMethod;

      let creditDays = 0;
      if (paymentMethod === 'CREDITO' && customerId) {
        const customerRow = await db.queryFirst<{ data?: string }>(
          'SELECT data FROM customers WHERE local_id = ?',
          [customerId]
        );
        try {
          const customerData = customerRow?.data ? JSON.parse(customerRow.data) : null;
          creditDays = Number(
            customerData?.creditDays ??
            customerData?.credit_days ??
            0
          ) || 0;
        } catch {
          creditDays = 0;
        }
      }
      const creditDueDate = createdAt + (Math.max(creditDays, 0) * 24 * 60 * 60 * 1000);
      const showCreditDueDate = paymentMethod === 'CREDITO';

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page {
                size: 80mm auto;
                margin: 0;
              }
              * {
                box-sizing: border-box;
              }
              body {
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                color: #000;
                background: #fff;
              }
              .ticket {
                width: 80mm;
                margin: 0 auto;
                padding: 10px 10px 14px;
                font-size: 14px;
                line-height: 1.25;
              }
              .brand {
                text-align: center;
                margin-bottom: 6px;
              }
              .logo {
                height: 28px;
                width: auto;
              }
              .sep {
                border-top: 1px dashed #444;
                border-bottom: 1px dashed #444;
                padding: 7px 0;
                margin: 7px 0;
              }
              .row {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                margin: 3px 0;
              }
              .row span:last-child {
                text-align: right;
              }
              .item {
                border-bottom: 1px dashed #c4c4c4;
                padding-bottom: 7px;
                margin-bottom: 7px;
              }
              .item-name {
                font-weight: 700;
              }
              .item-meta {
                font-size: 12px;
                color: #666;
                margin-top: 1px;
              }
              .item-line {
                display: flex;
                justify-content: space-between;
                margin-top: 4px;
              }
              .item-total {
                font-weight: 700;
              }
              .totals .row {
                margin: 4px 0;
              }
              .total {
                border-top: 1px dashed #444;
                padding-top: 7px;
                margin-top: 6px;
                font-size: 18px;
                font-weight: 800;
              }
              .credit {
                border-top: 1px dashed #444;
                padding-top: 7px;
                margin-top: 7px;
                text-align: center;
                font-weight: 700;
              }
              .thanks {
                text-align: center;
                margin-top: 10px;
                font-weight: 600;
              }
            </style>
          </head>
          <body>
            <div class="ticket">
              <div class="brand">
                <img src="${escapeHtml(logoUri)}" class="logo" />
              </div>

              <div class="sep">
                <div class="row"><span>Factura:</span><span><strong>${escapeHtml(resolvedInvoiceCode)}</strong></span></div>
                <div class="row"><span>Fecha:</span><span>${escapeHtml(formatDateTime(createdAt))}</span></div>
                <div style="margin-top:4px;"><strong>Cliente:</strong> ${escapeHtml(customerName || '(General) Cliente general')}</div>
                <div style="margin-top:4px;"><strong>Tipo de venta:</strong> ${escapeHtml(saleTypeLabel)}</div>
                <div style="margin-top:4px;"><strong>Método de pago:</strong> ${escapeHtml(paymentMethodLabel)}</div>
              </div>

              <div>${itemsRows}</div>

              <div class="totals">
                <div class="row"><span>Subtotal</span><span>${formatCurrency(subtotalCents)}</span></div>
                <div class="row"><span>ITBIS (18% incluido)</span><span>${formatCurrency(itbisCents)}</span></div>
                <div class="row total"><span>TOTAL</span><span>${formatCurrency(getTotal())}</span></div>
              </div>

              ${paymentMethod === 'CREDITO' ? `
                <div class="credit">
                  <div>VENTA A CREDITO</div>
                  ${showCreditDueDate ? `<div style="margin-top:2px;font-weight:500;">Vence: ${escapeHtml(formatDateOnly(creditDueDate))}</div>` : ''}
                </div>
              ` : ''}
              <div class="thanks">Gracias por su compra</div>
            </div>
          </body>
        </html>
      `;

      await Print.printAsync({ html });

      // Limpiar carrito
      clear();
      clearEditContext();

      // Navegar a recibo
      navigation.navigate('Receipt', { saleId: localId, invoiceCode: resolvedInvoiceCode });
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
          iconColor={ui.colors.danger}
          onPress={() => removeItem(item.productId)}
        />
      </View>
    </Surface>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
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
        <BottomDock>
          <Surface style={styles.summaryCard}>
          {editingSaleLocalId ? (
            <View style={styles.editingBanner}>
              <Text style={styles.editingBannerText}>Editando factura {editingInvoiceCode || '-'}</Text>
            </View>
          ) : null}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Cliente:</Text>
            <Button mode="text" onPress={() => navigation.navigate('SelectCustomer')}>
              {customerName || '(General) Cliente general'}
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
            buttonColor={ui.colors.primary}
            textColor="#fff"
            labelStyle={styles.completeButtonLabel}
            onPress={handleCompleteSale}
            loading={loading}
            disabled={loading}
            style={styles.completeButton}
            contentStyle={styles.completeButtonContent}
          >
            {editingSaleLocalId ? 'Guardar Cambios' : 'Completar Venta'}
          </Button>
          </Surface>
        </BottomDock>
      )}

      <View pointerEvents="none" style={[styles.systemBottomBg, { height: systemBottomInset }]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.background,
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
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    elevation: 1,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: ui.colors.text,
  },
  itemPrice: {
    fontSize: 12,
    color: ui.colors.textMuted,
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
    color: ui.colors.text,
  },
  itemTotal: {
    alignItems: 'flex-end',
  },
  itemTotalText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: ui.colors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: ui.colors.textMuted,
    marginBottom: 16,
  },
  summaryCard: {
    padding: 16,
    borderTopLeftRadius: ui.radius.lg,
    borderTopRightRadius: ui.radius.lg,
    backgroundColor: ui.colors.surface,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    elevation: 8,
  },
  editingBanner: {
    backgroundColor: '#DBEAFE',
    borderRadius: ui.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  editingBannerText: {
    color: '#1E40AF',
    fontSize: 12,
    fontWeight: '800',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: ui.colors.textMuted,
  },
  divider: {
    marginVertical: 12,
    backgroundColor: ui.colors.border,
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
    color: ui.colors.text,
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: ui.colors.primary,
  },
  completeButton: {
    marginTop: 8,
    marginBottom: 5,
    fontSize: 20,
  },
  completeButtonContent: {
    paddingVertical: 8,
  },
  completeButtonLabel: {
    fontSize: 18,
    fontWeight: '800',
  },
  systemBottomBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: ui.colors.surface,
  },
});
