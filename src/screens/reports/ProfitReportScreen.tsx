import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import {
  isCancelledStatus,
  normalizeSaleType,
  parseJsonObject,
  rangeToTimestamps,
  resolveSaleTimestamp,
  toTimestamp,
  toYmd,
} from './reportUtils';

interface ProfitMetrics {
  salesTotalCents: number;
  salesCount: number;
  cashReturnsCount: number;
  cashReturnsTotalCents: number;
  paymentsTotalCents: number;
  paymentsCount: number;
  totalRevenueCents: number;
  costOfSalesCents: number;
  cashReturnsCostCents: number;
  grossProfitCents: number;
  operatingExpensesCents: number;
  operatingExpensesCount: number;
  operatingProfitCents: number;
  otherIncomeExpensesCents: number;
  salesItbisCents: number;
  cashReturnsItbisCents: number;
  purchasesItbisCents: number;
  taxesCents: number;
  netProfitCents: number;
  accountsReceivableTotalCents: number;
  accountsReceivableCount: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildProfitReportHtml(metrics: ProfitMetrics, from: string, to: string): string {
  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111; font-size: 12px; padding: 16px; }
          .title { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
          .muted { color: #666; margin-bottom: 12px; }
          .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px; }
          .card-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
          .row { display: flex; justify-content: space-between; margin: 4px 0; gap: 8px; }
          .label { color: #555; }
          .value { font-weight: 700; }
          .positive { color: #15803D; font-weight: 800; }
          .negative { color: #B91C1C; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="title">Estado de resultados</div>
        <div class="muted">Periodo: ${escapeHtml(from)} a ${escapeHtml(to)} | Generado: ${escapeHtml(formatDateTime(Date.now()))}</div>

        <div class="card">
          <div class="card-title">Ingresos / Ventas</div>
          <div class="row"><span class="label">Ventas al contado (${metrics.salesCount})</span><span class="value positive">${escapeHtml(formatCurrency(metrics.salesTotalCents))}</span></div>
          <div class="row"><span class="label">Pagos recibidos (${metrics.paymentsCount})</span><span class="value positive">${escapeHtml(formatCurrency(metrics.paymentsTotalCents))}</span></div>
          <div class="row"><span class="label">Devoluciones contado (${metrics.cashReturnsCount})</span><span class="value negative">-${escapeHtml(formatCurrency(metrics.cashReturnsTotalCents))}</span></div>
          <div class="row"><span class="label">Total ingresos</span><span class="value positive">${escapeHtml(formatCurrency(metrics.totalRevenueCents))}</span></div>
        </div>

        <div class="card">
          <div class="card-title">Costos y gastos</div>
          <div class="row"><span class="label">Costo de ventas</span><span class="value negative">-${escapeHtml(formatCurrency(metrics.costOfSalesCents))}</span></div>
          <div class="row"><span class="label">Reverso costo por devoluciones</span><span class="value positive">${escapeHtml(formatCurrency(metrics.cashReturnsCostCents))}</span></div>
          <div class="row"><span class="label">Gastos operativos (${metrics.operatingExpensesCount})</span><span class="value negative">-${escapeHtml(formatCurrency(metrics.operatingExpensesCents))}</span></div>
        </div>

        <div class="card">
          <div class="card-title">Impuestos</div>
          <div class="row"><span class="label">ITBIS en ventas</span><span class="value">${escapeHtml(formatCurrency(metrics.salesItbisCents))}</span></div>
          <div class="row"><span class="label">ITBIS devuelto (contado)</span><span class="value negative">-${escapeHtml(formatCurrency(metrics.cashReturnsItbisCents))}</span></div>
          <div class="row"><span class="label">ITBIS en compras</span><span class="value">${escapeHtml(formatCurrency(metrics.purchasesItbisCents))}</span></div>
          <div class="row"><span class="label">Impuestos netos</span><span class="value">${escapeHtml(formatCurrency(metrics.taxesCents))}</span></div>
        </div>

        <div class="card">
          <div class="card-title">Resultado</div>
          <div class="row"><span class="label">Utilidad bruta</span><span class="value ${metrics.grossProfitCents >= 0 ? 'positive' : 'negative'}">${escapeHtml(formatCurrency(metrics.grossProfitCents))}</span></div>
          <div class="row"><span class="label">Utilidad operativa</span><span class="value ${metrics.operatingProfitCents >= 0 ? 'positive' : 'negative'}">${escapeHtml(formatCurrency(metrics.operatingProfitCents))}</span></div>
          <div class="row"><span class="label">Utilidad neta</span><span class="value ${metrics.netProfitCents >= 0 ? 'positive' : 'negative'}">${escapeHtml(formatCurrency(metrics.netProfitCents))}</span></div>
        </div>

        <div class="card">
          <div class="card-title">Cuentas por cobrar</div>
          <div class="row"><span class="label">Cuentas activas (${metrics.accountsReceivableCount})</span><span class="value">${escapeHtml(formatCurrency(metrics.accountsReceivableTotalCents))}</span></div>
        </div>
      </body>
    </html>
  `;
}

function getDefaultRange(): { from: string; to: string } {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  return { from: toYmd(fromDate), to: toYmd(toDate) };
}

export function ProfitReportScreen() {
  const defaults = useMemo(() => getDefaultRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [metrics, setMetrics] = useState<ProfitMetrics>({
    salesTotalCents: 0,
    salesCount: 0,
    cashReturnsCount: 0,
    cashReturnsTotalCents: 0,
    paymentsTotalCents: 0,
    paymentsCount: 0,
    totalRevenueCents: 0,
    costOfSalesCents: 0,
    cashReturnsCostCents: 0,
    grossProfitCents: 0,
    operatingExpensesCents: 0,
    operatingExpensesCount: 0,
    operatingProfitCents: 0,
    otherIncomeExpensesCents: 0,
    salesItbisCents: 0,
    cashReturnsItbisCents: 0,
    purchasesItbisCents: 0,
    taxesCents: 0,
    netProfitCents: 0,
    accountsReceivableTotalCents: 0,
    accountsReceivableCount: 0,
  });

  const loadReport = useCallback(async (fromYmd: string, toYmd: string) => {
    const { fromTs, toTs } = rangeToTimestamps(fromYmd, toYmd);

    setLoading(true);
    try {
      const [salesRows, paymentRows, expenseRows, productRows, purchaseRows, supplierRows, arRows, returnRows, returnItemRows] = await Promise.all([
        db.query<any>(
          `SELECT local_id, server_id, total_cents, status, created_at, data
           FROM sales
           ORDER BY created_at DESC, rowid DESC`
        ),
        db.query<any>('SELECT amount_cents, data FROM payments'),
        db.query<any>(
          `SELECT amount_cents, expense_date
           FROM operating_expenses
           WHERE expense_date >= ? AND expense_date <= ?`,
          [fromTs, toTs]
        ),
        db.query<any>('SELECT local_id, server_id, cost_cents, data FROM products'),
        db.query<any>(
          `SELECT purchased_at, cancelled_at, data
           FROM purchases
           WHERE purchased_at <= ?`,
          [toTs]
        ),
        db.query<any>('SELECT local_id, server_id, discount_percent_bp FROM suppliers'),
        db.query<any>(
          `SELECT balance_cents, status
           FROM accounts_receivable
           WHERE status IN ('PENDIENTE', 'PARCIAL')`
        ),
        db.query<any>(
          `SELECT local_id, total_cents, returned_at, cancelled_at, sale_local_id, sale_server_id, data
           FROM returns
           WHERE returned_at >= ? AND returned_at <= ?
           ORDER BY returned_at DESC, rowid DESC`,
          [fromTs, toTs]
        ),
        db.query<any>(
          `SELECT return_local_id, product_local_id, product_server_id, qty, data
           FROM return_items
           ORDER BY rowid DESC`
        ),
      ]);

      const costByProductId = new Map<string, number>();
      for (const row of productRows) {
        const parsed = parseJsonObject(row.data);
        const costCents = Number(row.cost_cents || parsed?.costCents || 0);
        const localId = String(row.local_id || '');
        const serverId = row.server_id ? String(row.server_id) : null;

        if (localId) costByProductId.set(localId, costCents);
        if (serverId) costByProductId.set(serverId, costCents);
      }

      const supplierDiscountById = new Map<string, number>();
      for (const row of supplierRows) {
        const discountPercentBp = Math.max(0, Math.round(Number(row.discount_percent_bp || 0)));
        const localId = String(row.local_id || '');
        const serverId = row.server_id ? String(row.server_id) : null;
        if (localId) supplierDiscountById.set(localId, discountPercentBp);
        if (serverId) supplierDiscountById.set(serverId, discountPercentBp);
      }

      const purchaseCostTimelineByProduct = new Map<string, Array<{ purchasedAt: number; netCostCents: number }>>();
      let purchasesItbisCents = 0;

      for (const row of purchaseRows) {
        const parsedPurchase = parseJsonObject(row.data);
        const cancelledAt = toTimestamp(row.cancelled_at ?? parsedPurchase?.cancelledAt);
        if (cancelledAt !== null) continue;

        const purchasedAt = Number(row.purchased_at || toTimestamp(parsedPurchase?.purchasedAt) || 0);
        if (!Number.isFinite(purchasedAt) || purchasedAt <= 0) continue;

        const supplierId = String(parsedPurchase?.supplierId || '');
        const supplierServerId = String(parsedPurchase?.supplierServerId || '');
        const supplierDiscountBp =
          Number(supplierDiscountById.get(supplierId))
          || Number(supplierDiscountById.get(supplierServerId))
          || 0;

        const purchaseItems = Array.isArray(parsedPurchase?.items) ? parsedPurchase.items : [];
        for (const rawItem of purchaseItems) {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
          const item = rawItem as Record<string, unknown>;

          const productId = String(item.productId || '');
          const productServerId = item.productServerId ? String(item.productServerId) : null;
          const qty = Number(item.qty ?? item.quantity ?? 0);
          if (!productId || !Number.isFinite(qty) || qty <= 0) continue;

          const unitCostCents = Math.max(0, Math.round(Number(item.unitCostCents || 0)));
          const netCostCents = Math.max(
            0,
            Math.round(Number(item.netCostCents ?? item.unitCostCents ?? 0))
          );
          const itemDiscountRaw = Number(item.discountPercentBp);
          const discountPercentBp = Number.isFinite(itemDiscountRaw) ? itemDiscountRaw : supplierDiscountBp;
          const discountedUnitCostCents = Math.max(
            0,
            Math.round(unitCostCents * (1 - discountPercentBp / 10000))
          );
          const purchaseIncludesItbis = item.purchaseIncludesItbis === true;
          const itemItbisPerUnit = purchaseIncludesItbis
            ? Math.max(0, netCostCents - discountedUnitCostCents)
            : 0;

          if (purchasedAt >= fromTs && purchasedAt <= toTs) {
            purchasesItbisCents += Math.round(itemItbisPerUnit * qty);
          }

          const purchasePoint = { purchasedAt, netCostCents };
          const localTimeline = purchaseCostTimelineByProduct.get(productId) || [];
          localTimeline.push(purchasePoint);
          purchaseCostTimelineByProduct.set(productId, localTimeline);

          if (productServerId) {
            const serverTimeline = purchaseCostTimelineByProduct.get(productServerId) || [];
            serverTimeline.push(purchasePoint);
            purchaseCostTimelineByProduct.set(productServerId, serverTimeline);
          }
        }
      }

      for (const [, timeline] of purchaseCostTimelineByProduct) {
        timeline.sort((a, b) => a.purchasedAt - b.purchasedAt);
      }

      const saleCatalog = salesRows.map((row) => {
        const parsed = parseJsonObject(row.data);
        const cancelledAt = toTimestamp(parsed?.cancelledAt);
        const cancelled = isCancelledStatus(row.status) || cancelledAt !== null;
        const createdAt = resolveSaleTimestamp(row.created_at, parsed);
        return {
          localId: String(row.local_id || ''),
          serverId: row.server_id ? String(row.server_id) : '',
          parsed,
          totalCents: Number(row.total_cents || parsed?.totalCents || 0),
          createdAt,
          cancelled,
          saleType: normalizeSaleType(parsed?.type, parsed?.paymentMethod),
        };
      });

      const salesByAnyId = new Map<string, (typeof saleCatalog)[number]>();
      for (const sale of saleCatalog) {
        if (sale.localId) salesByAnyId.set(sale.localId, sale);
        if (sale.serverId) salesByAnyId.set(sale.serverId, sale);
      }

      const validSales = saleCatalog.filter(
        (sale) => !sale.cancelled && sale.createdAt >= fromTs && sale.createdAt <= toTs
      );

      const cashSales = validSales.filter((sale) => sale.saleType === 'CONTADO');

      const grossCashSalesTotalCents = cashSales.reduce((sum, sale) => sum + sale.totalCents, 0);

      const activePayments = paymentRows
        .map((row) => {
          const parsed = parseJsonObject(row.data);
          const paidAt = toTimestamp(parsed?.paidAt || parsed?.createdAt || parsed?.date);
          const cancelledAt = toTimestamp(parsed?.cancelledAt);
          const statusNormalized = String(parsed?.status || '').toLowerCase();
          const cancelled = Boolean(cancelledAt || statusNormalized === 'cancelled' || parsed?.cancel === true);
          return {
            amountCents: Number(row.amount_cents || parsed?.amountCents || 0),
            paidAt,
            cancelled,
          };
        })
        .filter((payment) => !payment.cancelled)
        .filter((payment) => Boolean(payment.paidAt && payment.paidAt >= fromTs && payment.paidAt <= toTs));

      const paymentsTotalCents = activePayments.reduce((sum, payment) => sum + payment.amountCents, 0);
      const returnItemsByReturnLocalId = new Map<string, any[]>();
      for (const row of returnItemRows) {
        const returnLocalId = String(row.return_local_id || '');
        if (!returnLocalId) continue;
        const items = returnItemsByReturnLocalId.get(returnLocalId) || [];
        items.push(row);
        returnItemsByReturnLocalId.set(returnLocalId, items);
      }

      const resolveHistoricalUnitCost = (productId: string, soldAt: number, fallbackCostCents: number) => {
        const timeline = purchaseCostTimelineByProduct.get(productId);
        if (!timeline || timeline.length === 0) return fallbackCostCents;

        let historyCost = 0;
        for (let index = timeline.length - 1; index >= 0; index -= 1) {
          if (timeline[index].purchasedAt <= soldAt) {
            historyCost = timeline[index].netCostCents;
            break;
          }
        }
        if (historyCost <= 0) {
          historyCost = timeline[timeline.length - 1].netCostCents;
        }
        return historyCost > 0 ? historyCost : fallbackCostCents;
      };

      let cashReturnsTotalCents = 0;
      let cashReturnsCostCents = 0;
      let cashReturnsItbisCents = 0;
      let cashReturnsCount = 0;
      for (const row of returnRows) {
        const parsed = parseJsonObject(row.data);
        const cancelledAt = toTimestamp(row.cancelled_at ?? parsed?.cancelledAt);
        if (cancelledAt !== null) continue;

        const returnedAt = toTimestamp(row.returned_at ?? parsed?.returnedAt);
        if (!returnedAt || returnedAt < fromTs || returnedAt > toTs) continue;

        const saleRefs = [
          String(row.sale_local_id || ''),
          String(row.sale_server_id || ''),
          String(parsed?.saleLocalId || ''),
          String(parsed?.saleServerId || ''),
          String(parsed?.saleId || ''),
          String((parsed?.sale as any)?.id || ''),
        ].filter((value) => value.trim() !== '');
        const saleRecord = saleRefs.map((id) => salesByAnyId.get(id)).find(Boolean) || null;

        const parsedSaleType = String((parsed?.sale as any)?.type || '').toUpperCase();
        const saleType = parsedSaleType === 'CREDITO' || parsedSaleType === 'CONTADO'
          ? parsedSaleType
          : saleRecord?.saleType || normalizeSaleType(parsed?.type, null);
        if (saleType !== 'CONTADO') continue;
        if (saleRecord?.cancelled) continue;

        const totalCents = Number(row.total_cents || parsed?.totalCents || 0);
        if (!Number.isFinite(totalCents) || totalCents <= 0) continue;

        cashReturnsTotalCents += totalCents;
        cashReturnsCount += 1;

        const parsedItbis = Number(parsed?.itbisCents);
        if (Number.isFinite(parsedItbis) && parsedItbis >= 0) {
          cashReturnsItbisCents += parsedItbis;
        } else {
          const parsedSubtotal = Number(parsed?.subtotalCents || 0);
          if (Number.isFinite(parsedSubtotal) && parsedSubtotal > 0) {
            cashReturnsItbisCents += Math.max(0, totalCents - parsedSubtotal);
          } else {
            const inferredSubtotal = Math.round(totalCents / 1.18);
            cashReturnsItbisCents += Math.max(0, totalCents - inferredSubtotal);
          }
        }

        const saleOccurredAt =
          saleRecord?.createdAt ||
          toTimestamp((parsed?.sale as any)?.soldAt) ||
          toTimestamp((parsed?.sale as any)?.createdAt) ||
          returnedAt;

        const itemRows = returnItemsByReturnLocalId.get(String(row.local_id || '')) || [];
        if (itemRows.length > 0) {
          for (const itemRow of itemRows) {
            const itemParsed = parseJsonObject(itemRow.data);
            const productId = String(
              itemRow.product_server_id ||
              itemRow.product_local_id ||
              itemParsed?.productId ||
              ''
            );
            const qty = Number(itemRow.qty || itemParsed?.qty || 0);
            if (!productId || !Number.isFinite(qty) || qty <= 0) continue;

            const fallbackCostCents = Number(costByProductId.get(productId) || 0);
            const resolvedUnitCost = resolveHistoricalUnitCost(productId, saleOccurredAt, fallbackCostCents);
            cashReturnsCostCents += Math.round(resolvedUnitCost * qty);
          }
        } else {
          const parsedItems = Array.isArray(parsed?.items) ? parsed.items : [];
          for (const rawItem of parsedItems) {
            const item = rawItem as Record<string, unknown>;
            const productId = String(item.productId || '');
            const qty = Number(item.qty || 0);
            if (!productId || !Number.isFinite(qty) || qty <= 0) continue;

            const fallbackCostCents = Number(costByProductId.get(productId) || 0);
            const resolvedUnitCost = resolveHistoricalUnitCost(productId, saleOccurredAt, fallbackCostCents);
            cashReturnsCostCents += Math.round(resolvedUnitCost * qty);
          }
        }
      }

      const salesTotalCents = grossCashSalesTotalCents - cashReturnsTotalCents;
      const totalRevenueCents = salesTotalCents + paymentsTotalCents;

      let grossCostOfSalesCents = 0;
      for (const sale of validSales) {
        const items = Array.isArray(sale.parsed?.items) ? sale.parsed.items : [];
        for (const rawItem of items) {
          const item = rawItem as Record<string, unknown>;
          const productId = String(item.productId || '');
          const qty = Number(item.quantity ?? item.qty ?? 0);
          if (!productId || !Number.isFinite(qty) || qty <= 0) continue;

          const inlineCost = Number(item.costCents ?? item.unitCostCents ?? item.productCostCents ?? 0);
          const historyCost = resolveHistoricalUnitCost(productId, sale.createdAt, 0);

          const resolvedCost =
            Number.isFinite(inlineCost) && inlineCost > 0
              ? inlineCost
              : historyCost > 0
                ? historyCost
                : Number(costByProductId.get(productId) || 0);

          grossCostOfSalesCents += Math.round(resolvedCost * qty);
        }
      }
      const costOfSalesCents = grossCostOfSalesCents - cashReturnsCostCents;

      const grossProfitCents = totalRevenueCents - costOfSalesCents;

      const operatingExpensesCents = expenseRows.reduce(
        (sum, row) => sum + Number(row.amount_cents || 0),
        0
      );
      const operatingExpensesCount = expenseRows.length;

      const operatingProfitCents = grossProfitCents - operatingExpensesCents;

      let grossSalesItbisCents = 0;
      for (const sale of validSales) {
        const parsedItbis = Number(sale.parsed?.itbisCents);
        if (Number.isFinite(parsedItbis) && parsedItbis > 0) {
          grossSalesItbisCents += parsedItbis;
          continue;
        }

        const subtotalCents = Number(sale.parsed?.subtotalCents || 0);
        if (Number.isFinite(subtotalCents) && subtotalCents > 0) {
          grossSalesItbisCents += Math.max(0, sale.totalCents - subtotalCents);
          continue;
        }

        const inferredSubtotal = Math.round(sale.totalCents / 1.18);
        grossSalesItbisCents += Math.max(0, sale.totalCents - inferredSubtotal);
      }
      const salesItbisCents = grossSalesItbisCents - cashReturnsItbisCents;

      const taxesCents = salesItbisCents - purchasesItbisCents;

      const otherIncomeExpensesCents = 0;
      const netProfitCents = operatingProfitCents - otherIncomeExpensesCents - taxesCents;

      const accountsReceivableTotalCents = arRows.reduce(
        (sum, row) => sum + Number(row.balance_cents || 0),
        0
      );

      setMetrics({
        salesTotalCents,
        salesCount: cashSales.length,
        cashReturnsCount,
        cashReturnsTotalCents,
        paymentsTotalCents,
        paymentsCount: activePayments.length,
        totalRevenueCents,
        costOfSalesCents,
        cashReturnsCostCents,
        grossProfitCents,
        operatingExpensesCents,
        operatingExpensesCount,
        operatingProfitCents,
        otherIncomeExpensesCents,
        salesItbisCents,
        cashReturnsItbisCents,
        purchasesItbisCents,
        taxesCents,
        netProfitCents,
        accountsReceivableTotalCents,
        accountsReceivableCount: arRows.length,
      });
    } catch (error) {
      console.error('Error cargando reporte de ganancia:', error);
      setMetrics({
        salesTotalCents: 0,
        salesCount: 0,
        cashReturnsCount: 0,
        cashReturnsTotalCents: 0,
        paymentsTotalCents: 0,
        paymentsCount: 0,
        totalRevenueCents: 0,
        costOfSalesCents: 0,
        cashReturnsCostCents: 0,
        grossProfitCents: 0,
        operatingExpensesCents: 0,
        operatingExpensesCount: 0,
        operatingProfitCents: 0,
        otherIncomeExpensesCents: 0,
        salesItbisCents: 0,
        cashReturnsItbisCents: 0,
        purchasesItbisCents: 0,
        taxesCents: 0,
        netProfitCents: 0,
        accountsReceivableTotalCents: 0,
        accountsReceivableCount: 0,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReport(from, to);
    }, [from, to, loadReport])
  );

  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      const html = buildProfitReportHtml(metrics, from, to);
      const pdf = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exportar estado de resultados',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.error('Error exportando estado de resultados:', error);
      Alert.alert('Exportacion', 'No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  }, [from, metrics, to]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Estado de resultados</Text>
          <Text style={styles.subtitle}>Ganancia calculada por periodo.</Text>
          <Button
            mode="outlined"
            style={styles.exportButton}
            textColor={ui.colors.primary}
            onPress={handleExportPdf}
            disabled={loading || exporting}
            loading={exporting}
          >
            Exportar PDF
          </Button>
        </View>

        <View style={styles.filtersCard}>
          <View style={styles.row}>
            <TextInput
              mode="outlined"
              label="Desde (YYYY-MM-DD)"
              value={from}
              onChangeText={setFrom}
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TextInput
              mode="outlined"
              label="Hasta (YYYY-MM-DD)"
              value={to}
              onChangeText={setTo}
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
          </View>
          <View style={styles.row}>
            <Button mode="contained" buttonColor={ui.colors.primary} style={styles.halfBtn} onPress={() => loadReport(from, to)}>
              Aplicar
            </Button>
            <Button
              mode="outlined"
              textColor={ui.colors.primary}
              style={styles.halfBtn}
              onPress={() => {
                const defaultRange = getDefaultRange();
                setFrom(defaultRange.from);
                setTo(defaultRange.to);
                loadReport(defaultRange.from, defaultRange.to);
              }}
            >
              Ultimos 30 dias
            </Button>
          </View>
        </View>

        {loading ? <Text style={styles.loadingText}>Cargando...</Text> : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ingresos / Ventas</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Ventas al contado ({metrics.salesCount})</Text>
            <Text style={styles.metricPositive}>{formatCurrency(metrics.salesTotalCents)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Pagos recibidos ({metrics.paymentsCount})</Text>
            <Text style={styles.metricPositive}>{formatCurrency(metrics.paymentsTotalCents)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Devoluciones contado ({metrics.cashReturnsCount})</Text>
            <Text style={styles.metricNegative}>-{formatCurrency(metrics.cashReturnsTotalCents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total ingresos</Text>
            <Text style={styles.totalPositive}>{formatCurrency(metrics.totalRevenueCents)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Costo de ventas</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Costo de productos vendidos</Text>
            <Text style={styles.metricNegative}>-{formatCurrency(metrics.costOfSalesCents)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Reverso costo por devoluciones</Text>
            <Text style={styles.metricPositive}>{formatCurrency(metrics.cashReturnsCostCents)}</Text>
          </View>
        </View>

        <View style={[styles.highlightCard, styles.highlightBlue]}>
          <Text style={styles.highlightTitle}>Utilidad bruta</Text>
          <Text style={[styles.highlightValue, metrics.grossProfitCents >= 0 ? styles.positiveText : styles.negativeText]}>
            {formatCurrency(metrics.grossProfitCents)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Gastos operativos</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Total gastos ({metrics.operatingExpensesCount})</Text>
            <Text style={styles.metricNegative}>-{formatCurrency(metrics.operatingExpensesCents)}</Text>
          </View>
        </View>

        <View style={[styles.highlightCard, styles.highlightPurple]}>
          <Text style={styles.highlightTitle}>Utilidad operativa</Text>
          <Text style={[styles.highlightValue, metrics.operatingProfitCents >= 0 ? styles.positiveText : styles.negativeText]}>
            {formatCurrency(metrics.operatingProfitCents)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Impuestos</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>ITBIS en ventas (neto)</Text>
            <Text style={styles.metricLabel}>{formatCurrency(metrics.salesItbisCents)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>ITBIS devuelto (contado)</Text>
            <Text style={styles.metricNegative}>-{formatCurrency(metrics.cashReturnsItbisCents)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>ITBIS en compras</Text>
            <Text style={styles.metricLabel}>{formatCurrency(metrics.purchasesItbisCents)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Impuestos netos</Text>
            <Text style={styles.metricLabel}>{formatCurrency(metrics.taxesCents)}</Text>
          </View>
        </View>

        <View style={[styles.netCard, metrics.netProfitCents >= 0 ? styles.netCardPositive : styles.netCardNegative]}>
          <Text style={styles.netTitle}>Utilidad neta</Text>
          <Text style={styles.netValue}>{formatCurrency(metrics.netProfitCents)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Cuentas por cobrar</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Cuentas activas ({metrics.accountsReceivableCount})</Text>
            <Text style={styles.metricLabel}>{formatCurrency(metrics.accountsReceivableTotalCents)}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingBottom: 24 },
  header: { marginBottom: 10 },
  title: { color: ui.colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: ui.colors.textMuted, marginTop: 4 },
  exportButton: { marginTop: 10, alignSelf: 'flex-start' },
  filtersCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  halfBtn: { flex: 1 },
  loadingText: { color: ui.colors.textMuted, textAlign: 'center', marginBottom: 10 },
  card: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
    marginBottom: 10,
  },
  sectionTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  metricLabel: { color: ui.colors.textMuted, fontSize: 13, flex: 1 },
  metricPositive: { color: '#15803D', fontWeight: '700' },
  metricNegative: { color: '#B91C1C', fontWeight: '700' },
  totalRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: ui.colors.text, fontWeight: '700' },
  totalPositive: { color: '#15803D', fontSize: 16, fontWeight: '800' },
  highlightCard: {
    borderRadius: ui.radius.lg,
    borderWidth: 2,
    padding: 14,
    marginBottom: 10,
  },
  highlightBlue: { borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
  highlightPurple: { borderColor: '#DDD6FE', backgroundColor: '#F5F3FF' },
  highlightTitle: { color: ui.colors.text, fontWeight: '700' },
  highlightValue: { marginTop: 6, fontSize: 24, fontWeight: '800' },
  positiveText: { color: '#15803D' },
  negativeText: { color: '#B91C1C' },
  netCard: {
    borderRadius: ui.radius.lg,
    borderWidth: 2,
    padding: 14,
    marginBottom: 10,
  },
  netCardPositive: { borderColor: '#86EFAC', backgroundColor: '#DCFCE7' },
  netCardNegative: { borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  netTitle: { color: ui.colors.text, fontSize: 17, fontWeight: '800' },
  netValue: { marginTop: 6, color: ui.colors.text, fontSize: 26, fontWeight: '900' },
});
