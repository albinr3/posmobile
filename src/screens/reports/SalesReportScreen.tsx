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
import { calcDocumentTotalsByTaxMode, normalizeDiscountPercentBp } from '../../utils/tax';
import {
  isCancelledStatus,
  normalizeSaleType,
  parseJsonObject,
  rangeToTimestamps,
  resolveSaleTimestamp,
  toTimestamp,
  toYmd,
} from './reportUtils';

interface SalesReportRow {
  localId: string;
  invoiceCode: string;
  customerName: string;
  type: 'CONTADO' | 'CREDITO';
  totalCents: number;
  createdAt: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildSalesReportHtml(rows: SalesReportRow[], from: string, to: string, totalCents: number): string {
  const rowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.invoiceCode)}</td>
          <td>${escapeHtml(row.customerName)}</td>
          <td>${escapeHtml(row.type)}</td>
          <td>${escapeHtml(formatDateTime(row.createdAt))}</td>
          <td>${escapeHtml(formatCurrency(row.totalCents))}</td>
        </tr>
      `
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          @page { size: Letter; margin: 14mm; }
          body { font-family: Arial, sans-serif; color: #111; font-size: 11px; }
          .title { font-size: 18px; font-weight: 800; margin-bottom: 4px; }
          .muted { color: #666; margin-bottom: 10px; }
          .summary { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
          .summary-row { display: flex; justify-content: space-between; margin: 4px 0; }
          .summary-label { color: #555; }
          .summary-value { font-weight: 700; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="title">Reporte de ventas</div>
        <div class="muted">Generado: ${escapeHtml(formatDateTime(Date.now()))}</div>

        <div class="summary">
          <div class="summary-row"><span class="summary-label">Rango</span><span class="summary-value">${escapeHtml(`${from} a ${to}`)}</span></div>
          <div class="summary-row"><span class="summary-label">Facturas</span><span class="summary-value">${escapeHtml(rows.length)}</span></div>
          <div class="summary-row"><span class="summary-label">Total vendido</span><span class="summary-value">${escapeHtml(formatCurrency(totalCents))}</span></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Factura</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Fecha</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;
}

export function SalesReportScreen() {
  const today = useMemo(() => toYmd(new Date()), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [rows, setRows] = useState<SalesReportRow[]>([]);

  const loadReport = useCallback(async (fromYmd: string, toYmd: string) => {
    const { fromTs, toTs } = rangeToTimestamps(fromYmd, toYmd);

    setLoading(true);
    try {
      const [salesRows, customers] = await Promise.all([
        db.query<any>(
          `SELECT local_id, invoice_code, customer_id, total_cents, status, created_at, data
           FROM sales
           ORDER BY created_at DESC, rowid DESC`
        ),
        db.query<{ local_id: string; name: string }>('SELECT local_id, name FROM customers'),
      ]);

      const customerNameById = new Map<string, string>();
      for (const customer of customers) {
        customerNameById.set(String(customer.local_id), String(customer.name || 'Cliente'));
      }

      const mapped: SalesReportRow[] = [];

      for (const row of salesRows) {
        const parsed = parseJsonObject(row.data);
        const cancelledAt = toTimestamp(parsed?.cancelledAt);

        if (isCancelledStatus(row.status) || cancelledAt !== null) {
          continue;
        }

        const localId = String(row.local_id || '');
        const invoiceCode =
          String(row.invoice_code || parsed?.invoiceCode || parsed?.invoice_code || '-');

        const customerId = String(row.customer_id || parsed?.customerId || '');
        const parsedCustomerName = typeof parsed?.customerName === 'string' ? parsed.customerName : null;
        const customerName = parsedCustomerName || customerNameById.get(customerId) || 'Cliente';

        const createdAt = resolveSaleTimestamp(row.created_at, parsed);
        if (!Number.isFinite(createdAt) || createdAt < fromTs || createdAt > toTs) {
          continue;
        }
        let totalCents = Number(row.total_cents || parsed?.totalCents || 0);
        if ((!Number.isFinite(totalCents) || totalCents <= 0) && Array.isArray(parsed?.items) && parsed.items.length > 0) {
          totalCents = calcDocumentTotalsByTaxMode({
            items: parsed.items.map((item: any) => ({
              quantity: Number(item?.quantity ?? item?.qty ?? 0),
              priceCents: Number(item?.priceCents ?? item?.unitPriceCents ?? 0),
              itbisRateBp: Number(item?.itbisRateBp ?? item?.product?.itbisRateBp ?? 1800),
            })),
            shippingCents: Number(
              parsed?.shippingCents ??
              parsed?.fleteCents ??
              (Number.isFinite(Number(parsed?.shipping ?? parsed?.flete))
                ? Math.round(Number(parsed?.shipping ?? parsed?.flete) * 100)
                : 0)
            ),
            salePricesIncludeItbis: parsed?.salePricesIncludeItbis !== false,
            discountPercentBp: normalizeDiscountPercentBp(parsed?.discountPercentBp ?? 0),
          }).totalCents;
        }
        const type = normalizeSaleType(parsed?.type, parsed?.paymentMethod);

        mapped.push({
          localId,
          invoiceCode,
          customerName,
          type,
          totalCents,
          createdAt,
        });
      }

      setRows(mapped);
    } catch (error) {
      console.error('Error cargando reporte de ventas:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReport(from, to);
    }, [from, to, loadReport])
  );

  const totalCents = rows.reduce((sum, row) => sum + row.totalCents, 0);

  const handleExportPdf = useCallback(async () => {
    if (rows.length === 0) {
      Alert.alert('Exportacion', 'No hay ventas para exportar.');
      return;
    }

    setExporting(true);
    try {
      const html = buildSalesReportHtml(rows, from, to, totalCents);
      const pdf = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exportar reporte de ventas',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.error('Error exportando reporte de ventas:', error);
      Alert.alert('Exportacion', 'No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  }, [rows, from, to, totalCents]);

  const handlePrintLetter = useCallback(async () => {
    if (rows.length === 0) {
      Alert.alert('Impresion', 'No hay ventas para imprimir.');
      return;
    }

    setPrinting(true);
    try {
      const html = buildSalesReportHtml(rows, from, to, totalCents);
      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error imprimiendo reporte de ventas:', error);
      Alert.alert('Impresion', 'No se pudo imprimir el reporte.');
    } finally {
      setPrinting(false);
    }
  }, [rows, from, to, totalCents]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Reporte de ventas</Text>
          <Text style={styles.subtitle}>Listado y total por rango.</Text>
        </View>

        <View style={styles.filtersCard}>
          <View style={styles.row}>
            <TextInput
              label="Desde (YYYY-MM-DD)"
              value={from}
              onChangeText={setFrom}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TextInput
              label="Hasta (YYYY-MM-DD)"
              value={to}
              onChangeText={setTo}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
          </View>
          <View style={styles.row}>
            <Button mode="contained" style={styles.halfBtn} buttonColor={ui.colors.primary} onPress={() => loadReport(from, to)}>
              Aplicar
            </Button>
            <Button
              mode="outlined"
              style={styles.halfBtn}
              textColor={ui.colors.primary}
              onPress={() => {
                const now = toYmd(new Date());
                setFrom(now);
                setTo(now);
                loadReport(now, now);
              }}
            >
              Hoy
            </Button>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{formatCurrency(totalCents)}</Text>
          <Text style={styles.summaryHint}>{rows.length} facturas</Text>
          <View style={styles.actionsRow}>
            <Button
              mode="outlined"
              icon="file-pdf-box"
              style={styles.actionBtn}
              textColor={ui.colors.primary}
              onPress={handleExportPdf}
              disabled={loading || exporting || printing || rows.length === 0}
              loading={exporting}
            >
              Exportar PDF
            </Button>
            <Button
              mode="outlined"
              icon="printer"
              style={styles.actionBtn}
              textColor={ui.colors.primary}
              onPress={handlePrintLetter}
              disabled={loading || printing || exporting || rows.length === 0}
              loading={printing}
            >
              Imprimir carta
            </Button>
          </View>
        </View>

        <View style={styles.listCard}>
          <Text style={styles.listTitle}>Facturas</Text>

          {loading ? <Text style={styles.emptyText}>Cargando...</Text> : null}
          {!loading && rows.length === 0 ? <Text style={styles.emptyText}>Sin ventas en el rango.</Text> : null}

          {!loading
            ? rows.map((row) => (
                <View key={row.localId} style={styles.itemRow}>
                  <View style={styles.itemLeft}>
                    <Text style={styles.invoiceCode}>{row.invoiceCode}</Text>
                    <Text style={styles.itemMeta}>{row.customerName}</Text>
                    <Text style={styles.itemMeta}>{formatDateTime(row.createdAt)}</Text>
                  </View>
                  <View style={styles.itemRight}>
                    <Text style={[styles.typeBadge, row.type === 'CREDITO' ? styles.typeCredit : styles.typeCash]}>{row.type}</Text>
                    <Text style={styles.itemTotal}>{formatCurrency(row.totalCents)}</Text>
                  </View>
                </View>
              ))
            : null}
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
  summaryCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
  },
  summaryLabel: { color: ui.colors.textMuted, fontSize: 13 },
  summaryValue: { color: ui.colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
  summaryHint: { color: ui.colors.textMuted, marginTop: 2 },
  actionsRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },
  listCard: {
    marginTop: 10,
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
  },
  listTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  itemRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemLeft: { flex: 1, marginRight: 8 },
  invoiceCode: { color: ui.colors.text, fontWeight: '800' },
  itemMeta: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  itemRight: { alignItems: 'flex-end' },
  typeBadge: {
    borderRadius: ui.radius.round,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  typeCash: { backgroundColor: '#DCFCE7', color: '#166534' },
  typeCredit: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  itemTotal: { marginTop: 6, color: ui.colors.text, fontSize: 15, fontWeight: '800' },
  emptyText: { color: ui.colors.textMuted, paddingVertical: 8, textAlign: 'center' },
});
