import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';

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

interface SalesReportRow {
  localId: string;
  invoiceCode: string;
  customerName: string;
  type: 'CONTADO' | 'CREDITO';
  totalCents: number;
  createdAt: number;
}

export function SalesReportScreen() {
  const today = useMemo(() => toYmd(new Date()), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(true);
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
        const totalCents = Number(row.total_cents || parsed?.totalCents || 0);
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
