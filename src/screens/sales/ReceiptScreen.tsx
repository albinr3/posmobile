import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Share, Alert } from 'react-native';
import { Text, Surface, Button, Divider } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { Sale, SaleItem, SalePaymentSplit } from '../../types';
import { ui } from '../../theme/ui';
import { formatPaymentWithBank } from '../../utils/paymentMethods';
import { formatProductQty } from '../../utils/productUnits';
import { getSalesSettings } from '../../services/settings/salesSettings';
import { calcDocumentTotalsByTaxMode, normalizeDiscountPercentBp } from '../../utils/tax';
import { formatCustomerLabel, GENERIC_CUSTOMER_DISPLAY_NAME } from '../../utils/customerLabels';
import { LEGAL_TIP_PERCENT_BP, resolveLegalTipSummary } from '../../utils/legalTip';

interface ReceiptScreenProps {
  navigation: any;
  route?: {
    params?: {
      saleId?: string;
      invoiceCode?: string;
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

const resolveSaleCreatedAt = (rowCreatedAt: unknown, saleData: any): number => {
  const candidates = [
    rowCreatedAt,
    saleData?.createdAt,
    saleData?.soldAt,
    saleData?.date,
  ];

  for (const candidate of candidates) {
    const asNumber = Number(candidate);
    if (Number.isFinite(asNumber)) return asNumber;
    if (typeof candidate === 'string' && candidate.trim()) {
      const asDate = new Date(candidate).getTime();
      if (Number.isFinite(asDate)) return asDate;
    }
    if (candidate instanceof Date) {
      const ts = candidate.getTime();
      if (Number.isFinite(ts)) return ts;
    }
  }

  return Date.now();
};

const resolveSaleShippingCents = (saleData: any): number => {
  const rawShippingCents = saleData?.shippingCents ?? saleData?.fleteCents ?? null;
  if (rawShippingCents !== null && rawShippingCents !== undefined) {
    const parsedShippingCents = Number(rawShippingCents);
    if (Number.isFinite(parsedShippingCents)) return Math.max(0, Math.round(parsedShippingCents));
  }

  const rawShippingAmount = saleData?.shipping ?? saleData?.flete ?? null;
  if (rawShippingAmount !== null && rawShippingAmount !== undefined) {
    const parsedShippingAmount = Number(rawShippingAmount);
    if (Number.isFinite(parsedShippingAmount)) return Math.max(0, Math.round(parsedShippingAmount * 100));
  }

  return 0;
};

const resolveSaleLegalTip = (saleData: any): { legalTipPercentBp: number; legalTipCents: number } => {
  const fallbackBaseCents = Number(saleData?.legalTipBaseCents ?? saleData?.subtotalCents ?? 0);
  const summary = resolveLegalTipSummary(saleData, fallbackBaseCents);
  return {
    legalTipPercentBp: Number.isFinite(Number(summary.legalTipPercentBp))
      ? Math.max(0, Math.round(Number(summary.legalTipPercentBp)))
      : LEGAL_TIP_PERCENT_BP,
    legalTipCents: Number.isFinite(Number(summary.legalTipCents))
      ? Math.max(0, Math.round(Number(summary.legalTipCents)))
      : 0,
  };
};

const buildReceiptHtml = (params: {
  invoiceCode: string;
  createdAt: number;
  customerName?: string | null;
  paymentMethod?: string | null;
  transferBankName?: string | null;
  paymentSplits?: SalePaymentSplit[];
  totalCents: number;
  shippingCents?: number;
  items: SaleItem[];
  logoUri: string;
  showItbisBreakdown: boolean;
  salePricesIncludeItbis?: boolean;
  discountPercentBp?: number | null;
  discountTotalCents?: number;
  legalTipPercentBp?: number;
  legalTipCents?: number;
}) => {
  const {
    invoiceCode,
    createdAt,
    customerName,
    paymentMethod,
    transferBankName,
    paymentSplits,
    totalCents,
    shippingCents = 0,
    items,
    logoUri,
    showItbisBreakdown,
    discountPercentBp,
    discountTotalCents,
    legalTipPercentBp,
    legalTipCents,
  } = params;

  const itemsRows = (items || [])
    .map(
      (item) => {
        const productReference = String((item as any)?.reference || '').trim() || '-';
        return `
        <div class="item">
          <div class="item-name">${escapeHtml(item.productName)} | ${escapeHtml(productReference)}</div>
          <div class="item-line">
            <span>${formatProductQty(item.quantity, item.unit)} x ${formatCurrency(item.priceCents)}</span>
            <span class="item-total">${formatCurrency(item.totalCents)}</span>
          </div>
        </div>
      `;
      }
    )
    .join('');

  const salePricesIncludeItbis = params.salePricesIncludeItbis !== false;
  const totals = calcDocumentTotalsByTaxMode({
    items: (items || []).map((item: any) => ({
      quantity: Number(item.quantity || 0),
      priceCents: Number(item.priceCents || item.unitPriceCents || 0),
      itbisRateBp: Number(item.itbisRateBp || 1800),
    })),
    shippingCents,
    salePricesIncludeItbis,
    discountPercentBp: normalizeDiscountPercentBp(discountPercentBp ?? 0),
  });
  const resolvedDiscountTotalCents = Math.max(
    0,
    Math.round(Number(discountTotalCents ?? totals.discountTotalCents ?? 0))
  );
  const resolvedDiscountPercentBp = normalizeDiscountPercentBp(discountPercentBp ?? 0);
  const shippingRow = shippingCents > 0
    ? `<div class="row"><span>Flete</span><span>${formatCurrency(shippingCents)}</span></div>`
    : '';
  const discountRow = resolvedDiscountTotalCents > 0
    ? `<div class="row"><span>Descuento (${(resolvedDiscountPercentBp / 100).toFixed(2).replace(/\.?0+$/, '')}%)</span><span>-${formatCurrency(resolvedDiscountTotalCents)}</span></div>`
    : '';
  const resolvedLegalTipPercentBp = Number.isFinite(Number(legalTipPercentBp))
    ? Math.max(0, Math.round(Number(legalTipPercentBp)))
    : LEGAL_TIP_PERCENT_BP;
  const resolvedLegalTipCents = Number.isFinite(Number(legalTipCents))
    ? Math.max(0, Math.round(Number(legalTipCents)))
    : 0;
  const legalTipRow = resolvedLegalTipCents > 0
    ? `<div class="row"><span>Propina legal (${(resolvedLegalTipPercentBp / 100).toFixed(2).replace(/\.?0+$/, '')}%)</span><span>${formatCurrency(resolvedLegalTipCents)}</span></div>`
    : '';
  const taxRows = showItbisBreakdown
    ? `
          <div class="row"><span>Subtotal</span><span>${formatCurrency(totals.subtotalCents)}</span></div>
          <div class="row"><span>ITBIS (${salePricesIncludeItbis ? 'incluido' : 'no incluido'})</span><span>${formatCurrency(totals.itbisCents)}</span></div>
          ${discountRow}
          ${shippingRow}
          ${legalTipRow}
      `
    : `${discountRow}${shippingRow}${legalTipRow}`;
  const saleTypeLabel = paymentMethod === 'CREDITO' ? 'Crédito' : 'Contado';
  const paymentSummary = paymentMethod === 'DIVIDIR_PAGO'
    ? (paymentSplits || []).map((split) => `${formatPaymentWithBank(split.method, split.transferBankName)} ${formatCurrency(split.amountCents)}`).join(' + ')
    : formatPaymentWithBank(paymentMethod, transferBankName);

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #000; background: #fff; }
          .ticket { width: 80mm; margin: 0 auto; padding: 10px 10px 14px; font-size: 14px; line-height: 1.25; }
          .brand { text-align: center; margin-bottom: 6px; }
          .logo { height: 28px; width: auto; }
          .sep { border-top: 1px dashed #444; border-bottom: 1px dashed #444; padding: 7px 0; margin: 7px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
          .item { border-bottom: 1px dashed #c4c4c4; padding-bottom: 7px; margin-bottom: 7px; }
          .item-name { font-weight: 700; }
          .item-line { display: flex; justify-content: space-between; margin-top: 4px; }
          .item-total { font-weight: 700; }
          .total { border-top: 1px dashed #444; padding-top: 7px; margin-top: 6px; font-size: 18px; font-weight: 800; display: flex; justify-content: space-between; }
          .thanks { text-align: center; margin-top: 10px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="brand">
            <img src="${escapeHtml(logoUri)}" class="logo" />
          </div>
          <div class="sep">
            <div class="row"><span>Factura:</span><span><strong>${escapeHtml(invoiceCode)}</strong></span></div>
            <div class="row"><span>Fecha:</span><span>${escapeHtml(formatDateTime(createdAt))}</span></div>
            <div style="margin-top:4px;"><strong>Cliente:</strong> ${escapeHtml(formatCustomerLabel(customerName || GENERIC_CUSTOMER_DISPLAY_NAME))}</div>
            <div style="margin-top:4px;"><strong>Tipo de venta:</strong> ${escapeHtml(saleTypeLabel)}</div>
            <div style="margin-top:4px;"><strong>Método de pago:</strong> ${escapeHtml(paymentSummary || '-')}</div>
          </div>
          <div>${itemsRows}</div>
          ${taxRows}
          <div class="total"><span>TOTAL</span><span>${formatCurrency(totalCents)}</span></div>
          <div class="thanks">Gracias por su compra</div>
        </div>
      </body>
    </html>
  `;
};

export function ReceiptScreen({ navigation, route }: ReceiptScreenProps) {
  const saleId = route?.params?.saleId || '';
  const routeInvoiceCode = route?.params?.invoiceCode || '';
  const logoUri = Asset.fromModule(require('../../../assets/movoLogoDark.png')).uri;
  const [sale, setSale] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showItbisBreakdown, setShowItbisBreakdown] = useState(true);

  useEffect(() => {
    loadSale();
    getSalesSettings()
      .then((settings) => setShowItbisBreakdown(settings.showItbisOnReceipts))
      .catch(() => setShowItbisBreakdown(true));
  }, []);

  const loadSale = async () => {
    try {
      const result = await db.queryFirst<any>(
        'SELECT * FROM sales WHERE local_id = ?',
        [saleId]
      );
      if (result) {
        const saleData = JSON.parse(result.data);
        const createdAt = resolveSaleCreatedAt(result.created_at, saleData);
        setSale({
          ...result,
          ...saleData,
          createdAt,
          soldAt: saleData?.soldAt || createdAt,
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
    const displayInvoiceCode = sale?.invoice_code || sale?.invoiceCode || routeInvoiceCode;
    const createdAt = resolveSaleCreatedAt(sale?.created_at, sale);
    const legalTip = resolveSaleLegalTip(sale);
    const html = buildReceiptHtml({
      invoiceCode: displayInvoiceCode,
      createdAt,
      customerName: sale.customerName,
      paymentMethod: sale.paymentMethod,
      transferBankName: sale.transferBankName,
      paymentSplits: sale.paymentSplits || [],
      totalCents: sale.totalCents,
      shippingCents: resolveSaleShippingCents(sale),
      items: sale.items || [],
      logoUri,
      showItbisBreakdown,
      salePricesIncludeItbis: typeof sale.salePricesIncludeItbis === 'boolean' ? sale.salePricesIncludeItbis : true,
      discountPercentBp: normalizeDiscountPercentBp(sale.discountPercentBp ?? 0),
      discountTotalCents: Number(sale.discountTotalCents || 0),
      legalTipPercentBp: legalTip.legalTipPercentBp,
      legalTipCents: legalTip.legalTipCents,
    });

    try {
      const pdf = await Print.printToFileAsync({ html });
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (sharingAvailable) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Factura ${displayInvoiceCode}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Share.share({
          title: `Factura ${displayInvoiceCode}`,
          message: `Factura ${displayInvoiceCode}`,
          url: pdf.uri,
        });
      }
    } catch (error) {
      console.error('Error compartiendo:', error);
      Alert.alert('Error', 'No se pudo abrir el menú para compartir.');
    }
  };

  const handlePrint = async () => {
    if (!sale) return;

    const displayInvoiceCode = sale?.invoice_code || sale?.invoiceCode || routeInvoiceCode;
    const createdAt = resolveSaleCreatedAt(sale?.created_at, sale);
    const legalTip = resolveSaleLegalTip(sale);
    const html = buildReceiptHtml({
      invoiceCode: displayInvoiceCode,
      createdAt,
      customerName: sale.customerName,
      paymentMethod: sale.paymentMethod,
      transferBankName: sale.transferBankName,
      paymentSplits: sale.paymentSplits || [],
      totalCents: sale.totalCents,
      shippingCents: resolveSaleShippingCents(sale),
      items: sale.items || [],
      logoUri,
      showItbisBreakdown,
      salePricesIncludeItbis: typeof sale.salePricesIncludeItbis === 'boolean' ? sale.salePricesIncludeItbis : true,
      discountPercentBp: normalizeDiscountPercentBp(sale.discountPercentBp ?? 0),
      discountTotalCents: Number(sale.discountTotalCents || 0),
      legalTipPercentBp: legalTip.legalTipPercentBp,
      legalTipCents: legalTip.legalTipCents,
    });

    try {
      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error imprimiendo:', error);
      Alert.alert('Error', 'No se pudo abrir la vista de impresión.');
    }
  };

  const handleNewSale = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'POS' }],
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <Text>Cargando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!sale) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <Text>Venta no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayInvoiceCode = sale?.invoice_code || sale?.invoiceCode || routeInvoiceCode;
  const displayCreatedAt = resolveSaleCreatedAt(sale?.created_at, sale);
  const saleLegalTip = resolveSaleLegalTip(sale);

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
            <Text style={styles.value}>{displayInvoiceCode}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Fecha:</Text>
            <Text style={styles.value}>{formatDateTime(displayCreatedAt)}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Cliente:</Text>
            <Text style={styles.value}>
              {formatCustomerLabel(sale.customerName || GENERIC_CUSTOMER_DISPLAY_NAME, sale.customerVisualId)}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Método de Pago:</Text>
            <Text style={styles.value}>
              {sale.paymentMethod === 'DIVIDIR_PAGO'
                ? (sale.paymentSplits || [])
                    .map((split: SalePaymentSplit) => formatPaymentWithBank(split.method, split.transferBankName))
                    .join(' + ')
                : formatPaymentWithBank(sale.paymentMethod, sale.transferBankName)}
            </Text>
          </View>

          <Divider style={styles.divider} />

          <Text style={styles.sectionTitle}>Productos</Text>
          {sale.items?.map((item: SaleItem, index: number) => (
            <View key={index} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.productName}</Text>
                <Text style={styles.itemQty}>{formatProductQty(item.quantity, item.unit)} @ {formatCurrency(item.priceCents)}</Text>
              </View>
              <Text style={styles.itemTotal}>{formatCurrency(item.totalCents)}</Text>
            </View>
          ))}

          <Divider style={styles.divider} />

          {resolveSaleShippingCents(sale) > 0 ? (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Flete:</Text>
              <Text style={styles.value}>{formatCurrency(resolveSaleShippingCents(sale))}</Text>
            </View>
          ) : null}

          {Number(sale.discountTotalCents || 0) > 0 ? (
            <View style={styles.infoRow}>
              <Text style={styles.label}>
                Descuento ({(normalizeDiscountPercentBp(sale.discountPercentBp ?? 0) / 100).toFixed(2).replace(/\.?0+$/, '')}%):
              </Text>
              <Text style={styles.value}>-{formatCurrency(Number(sale.discountTotalCents || 0))}</Text>
            </View>
          ) : null}

          {saleLegalTip.legalTipCents > 0 ? (
            <View style={styles.infoRow}>
              <Text style={styles.label}>
                Propina legal ({(saleLegalTip.legalTipPercentBp / 100).toFixed(2).replace(/\.?0+$/, '')}%):
              </Text>
              <Text style={styles.value}>{formatCurrency(saleLegalTip.legalTipCents)}</Text>
            </View>
          ) : null}

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
            textColor={ui.colors.primary}
          >
            Compartir
          </Button>

          <Button
            mode="outlined"
            icon="printer"
            onPress={handlePrint}
            style={styles.actionButton}
            textColor={ui.colors.primary}
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
          buttonColor={ui.colors.primary}
          textColor="#fff"
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
    backgroundColor: ui.colors.background,
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
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    elevation: 2,
  },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ui.colors.success,
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
    color: ui.colors.text,
  },
  divider: {
    marginVertical: 16,
    backgroundColor: ui.colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: ui.colors.textMuted,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
    color: ui.colors.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: ui.colors.text,
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
    color: ui.colors.text,
  },
  itemQty: {
    fontSize: 12,
    color: ui.colors.textMuted,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '500',
    color: ui.colors.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderColor: ui.colors.primary,
  },
  newSaleButton: {
    marginTop: 16,
  },
  newSaleButtonContent: {
    paddingVertical: 8,
  },
});
