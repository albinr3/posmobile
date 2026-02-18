import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Button, Chip, Menu, Text, TextInput } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';

import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { parseJsonObject, rangeToTimestamps, toTimestamp } from './reportUtils';

interface CustomerOption {
  id: string;
  name: string;
}

interface ReceiptItem {
  localId: string;
  receiptCode: string;
  paidAt: number;
  customerId: string | null;
  customerName: string;
  invoiceCode: string;
  amountCents: number;
  method: string;
  note: string | null;
  cancelledAt: number | null;
}

interface ReceiptStats {
  totalPayments: number;
  cancelledPayments: number;
  totalAmount: number;
  cancelledAmount: number;
  byMethod: Record<string, { count: number; total: number }>;
}

const METHOD_OPTIONS = ['ALL', 'EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE', 'OTRO'];

export function ReceiptsReportScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptItem[]>([]);
  const [stats, setStats] = useState<ReceiptStats>({
    totalPayments: 0,
    cancelledPayments: 0,
    totalAmount: 0,
    cancelledAmount: 0,
    byMethod: {},
  });

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [receiptCode, setReceiptCode] = useState('');
  const [method, setMethod] = useState<string>('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerMenuVisible, setCustomerMenuVisible] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const rowsResult = await db.query<{ local_id: string; name: string }>(
        'SELECT local_id, name FROM customers ORDER BY name ASC'
      );
      setCustomers(rowsResult.map((row) => ({ id: String(row.local_id), name: String(row.name || 'Cliente') })));
    } catch (error) {
      console.error('Error cargando clientes para filtro de recibos:', error);
      setCustomers([]);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const [paymentRows, arRows] = await Promise.all([
        db.query<any>('SELECT local_id, receipt_code, amount_cents, ar_id, data FROM payments ORDER BY rowid DESC'),
        db.query<any>('SELECT local_id, customer_id, customer_name, data FROM accounts_receivable'),
      ]);

      const arByLocalId = new Map<
        string,
        {
          customerId: string | null;
          customerName: string;
          invoiceCode: string;
        }
      >();

      for (const arRow of arRows) {
        const parsed = parseJsonObject(arRow.data);
        const parsedSale = (parsed?.sale as Record<string, unknown>) || null;
        arByLocalId.set(String(arRow.local_id), {
          customerId: arRow.customer_id ? String(arRow.customer_id) : null,
          customerName: String(arRow.customer_name || parsed?.customerName || 'Cliente'),
          invoiceCode: String(parsedSale?.invoiceCode || parsed?.invoiceCode || '-'),
        });
      }

      const minAmountCents = minAmount.trim() ? Math.round(Number(minAmount) * 100) : null;
      const maxAmountCents = maxAmount.trim() ? Math.round(Number(maxAmount) * 100) : null;
      const hasDateFilter = Boolean(startDate.trim() || endDate.trim());
      const { fromTs, toTs } = rangeToTimestamps(startDate || endDate, endDate || startDate);

      const mapped: ReceiptItem[] = [];

      for (const row of paymentRows) {
        const parsed = parseJsonObject(row.data);
        const arData = row.ar_id ? arByLocalId.get(String(row.ar_id)) : undefined;

        const paidAt = toTimestamp(parsed?.paidAt || parsed?.createdAt || parsed?.date || Date.now()) || Date.now();
        const cancelledAt = toTimestamp(parsed?.cancelledAt);
        const statusNormalized = String(parsed?.status || '').toLowerCase();
        const isCancelled = Boolean(cancelledAt || statusNormalized === 'cancelled' || parsed?.cancel === true);

        if (!includeCancelled && isCancelled) continue;

        const item: ReceiptItem = {
          localId: String(row.local_id),
          receiptCode: String(parsed?.receiptCode || row.receipt_code || '-'),
          paidAt,
          customerId:
            typeof parsed?.customerId === 'string'
              ? parsed.customerId
              : arData?.customerId || null,
          customerName:
            typeof parsed?.customerName === 'string' && parsed.customerName.trim()
              ? parsed.customerName
              : arData?.customerName || 'Cliente',
          invoiceCode:
            typeof parsed?.invoiceCode === 'string' && parsed.invoiceCode.trim()
              ? parsed.invoiceCode
              : arData?.invoiceCode || '-',
          amountCents: Number(parsed?.amountCents || row.amount_cents || 0),
          method: String(parsed?.method || parsed?.paymentMethod || 'OTRO').toUpperCase(),
          note:
            typeof parsed?.note === 'string'
              ? parsed.note
              : typeof parsed?.notes === 'string'
                ? parsed.notes
                : null,
          cancelledAt: isCancelled ? cancelledAt || Date.now() : null,
        };

        if (hasDateFilter && (item.paidAt < fromTs || item.paidAt > toTs)) continue;

        if (customerId !== 'ALL' && item.customerId !== customerId) continue;

        if (receiptCode.trim()) {
          const query = receiptCode.trim().toLowerCase();
          if (!item.receiptCode.toLowerCase().includes(query)) continue;
        }

        if (method !== 'ALL' && item.method !== method) continue;

        if (minAmountCents !== null && item.amountCents < minAmountCents) continue;
        if (maxAmountCents !== null && item.amountCents > maxAmountCents) continue;

        mapped.push(item);
      }

      const activePayments = mapped.filter((item) => !item.cancelledAt);
      const cancelledPayments = mapped.filter((item) => Boolean(item.cancelledAt));

      const byMethod: Record<string, { count: number; total: number }> = {};
      for (const item of activePayments) {
        if (!byMethod[item.method]) {
          byMethod[item.method] = { count: 0, total: 0 };
        }
        byMethod[item.method].count += 1;
        byMethod[item.method].total += item.amountCents;
      }

      setRows(mapped);
      setStats({
        totalPayments: activePayments.length,
        cancelledPayments: cancelledPayments.length,
        totalAmount: activePayments.reduce((sum, item) => sum + item.amountCents, 0),
        cancelledAmount: cancelledPayments.reduce((sum, item) => sum + item.amountCents, 0),
        byMethod,
      });
    } catch (error) {
      console.error('Error cargando reporte de recibos:', error);
      setRows([]);
      setStats({ totalPayments: 0, cancelledPayments: 0, totalAmount: 0, cancelledAmount: 0, byMethod: {} });
    } finally {
      setLoading(false);
    }
  }, [customerId, endDate, includeCancelled, maxAmount, method, minAmount, receiptCode, startDate]);

  useFocusEffect(
    useCallback(() => {
      loadCustomers();
      loadReport();
    }, [loadCustomers, loadReport])
  );

  const selectedCustomerName = useMemo(() => {
    if (customerId === 'ALL') return 'Todos los clientes';
    return customers.find((customer) => customer.id === customerId)?.name || 'Cliente';
  }, [customerId, customers]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Reporte de recibos</Text>
          <Text style={styles.subtitle}>Recibos de pagos CxC por filtro.</Text>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total recibos</Text>
            <Text style={styles.metricValue}>{stats.totalPayments}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Monto total</Text>
            <Text style={[styles.metricValue, { color: '#15803D' }]}>{formatCurrency(stats.totalAmount)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Cancelados</Text>
            <Text style={[styles.metricValue, { color: '#B91C1C' }]}>{stats.cancelledPayments}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Monto cancelado</Text>
            <Text style={[styles.metricValue, { color: '#B91C1C' }]}>{formatCurrency(stats.cancelledAmount)}</Text>
          </View>
        </View>

        {Object.keys(stats.byMethod).length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Por metodo de pago</Text>
            {Object.entries(stats.byMethod).map(([methodKey, data]) => (
              <View key={methodKey} style={styles.methodRow}>
                <Text style={styles.methodName}>{methodKey}</Text>
                <Text style={styles.methodValue}>{formatCurrency(data.total)} ({data.count})</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Filtros</Text>

          <View style={styles.row}>
            <TextInput
              mode="outlined"
              label="Fecha desde"
              value={startDate}
              onChangeText={setStartDate}
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TextInput
              mode="outlined"
              label="Fecha hasta"
              value={endDate}
              onChangeText={setEndDate}
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
          </View>

          <Menu
            visible={customerMenuVisible}
            onDismiss={() => setCustomerMenuVisible(false)}
            anchor={
              <TouchableOpacity style={styles.selectLike} onPress={() => setCustomerMenuVisible(true)}>
                <Text style={styles.selectLikeText}>{selectedCustomerName}</Text>
                <Text style={styles.selectCaret}>▼</Text>
              </TouchableOpacity>
            }
          >
            <Menu.Item onPress={() => { setCustomerId('ALL'); setCustomerMenuVisible(false); }} title="Todos los clientes" />
            {customers.map((customer) => (
              <Menu.Item
                key={customer.id}
                onPress={() => {
                  setCustomerId(customer.id);
                  setCustomerMenuVisible(false);
                }}
                title={customer.name}
              />
            ))}
          </Menu>

          <TextInput
            mode="outlined"
            label="Codigo de recibo"
            value={receiptCode}
            onChangeText={setReceiptCode}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

          <View style={styles.chipRow}>
            {METHOD_OPTIONS.map((option) => (
              <Chip
                key={option}
                selected={method === option}
                onPress={() => setMethod(option)}
                style={[styles.filterChip, method === option && styles.filterChipSelected]}
                textStyle={[styles.filterChipText, method === option && styles.filterChipTextSelected]}
                showSelectedOverlay={false}
              >
                {option}
              </Chip>
            ))}
          </View>

          <View style={styles.row}>
            <TextInput
              mode="outlined"
              label="Monto minimo"
              value={minAmount}
              onChangeText={setMinAmount}
              keyboardType="decimal-pad"
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TextInput
              mode="outlined"
              label="Monto maximo"
              value={maxAmount}
              onChangeText={setMaxAmount}
              keyboardType="decimal-pad"
              style={[styles.input, styles.halfInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
          </View>

          <Chip
            selected={includeCancelled}
            onPress={() => setIncludeCancelled((value) => !value)}
            style={[styles.cancelledChip, includeCancelled && styles.cancelledChipSelected]}
            textStyle={[styles.cancelledChipText, includeCancelled && styles.cancelledChipTextSelected]}
            showSelectedOverlay={false}
          >
            Incluir cancelados
          </Chip>

          <View style={styles.row}>
            <Button mode="contained" buttonColor={ui.colors.primary} style={styles.halfBtn} onPress={loadReport}>
              Aplicar
            </Button>
            <Button
              mode="outlined"
              textColor={ui.colors.primary}
              style={styles.halfBtn}
              onPress={() => {
                setStartDate('');
                setEndDate('');
                setCustomerId('ALL');
                setReceiptCode('');
                setMethod('ALL');
                setMinAmount('');
                setMaxAmount('');
                setIncludeCancelled(false);
              }}
            >
              Limpiar
            </Button>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recibos</Text>

          {loading ? <Text style={styles.emptyText}>Cargando...</Text> : null}
          {!loading && rows.length === 0 ? <Text style={styles.emptyText}>No se encontraron recibos.</Text> : null}

          {!loading
            ? rows.map((item) => (
                <View key={item.localId} style={[styles.receiptRow, item.cancelledAt ? styles.receiptRowCancelled : null]}>
                  <View style={styles.receiptHeader}>
                    <Text style={styles.receiptCode}>{item.receiptCode}</Text>
                    <Text style={[styles.status, item.cancelledAt ? styles.statusCancelled : styles.statusActive]}>
                      {item.cancelledAt ? 'CANCELADO' : 'ACTIVO'}
                    </Text>
                  </View>

                  <Text style={styles.receiptMeta}>{item.customerName}</Text>
                  <Text style={styles.receiptMeta}>Factura: {item.invoiceCode}</Text>
                  <Text style={styles.receiptMeta}>Fecha: {formatDateTime(item.paidAt)}</Text>
                  <Text style={styles.receiptMeta}>Metodo: {item.method}</Text>
                  {item.note ? <Text style={styles.receiptMeta}>Nota: {item.note}</Text> : null}

                  <Text style={styles.receiptAmount}>{formatCurrency(item.amountCents)}</Text>
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
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  metricCard: {
    width: '48.5%',
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
  },
  metricLabel: { color: ui.colors.textMuted, fontSize: 12 },
  metricValue: { color: ui.colors.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  card: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  methodRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  methodName: { color: ui.colors.text, fontWeight: '700' },
  methodValue: { color: ui.colors.textMuted, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  halfBtn: { flex: 1 },
  selectLike: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  selectLikeText: { color: ui.colors.text, fontSize: 14 },
  selectCaret: { color: ui.colors.textMuted, fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { backgroundColor: '#F4F1FA' },
  filterChipSelected: { backgroundColor: '#E9D5FF' },
  filterChipText: { color: '#544F63', fontSize: 11, fontWeight: '600' },
  filterChipTextSelected: { color: ui.colors.primary, fontWeight: '700' },
  cancelledChip: { alignSelf: 'flex-start', marginBottom: 10, backgroundColor: '#F4F1FA' },
  cancelledChipSelected: { backgroundColor: '#FEE2E2' },
  cancelledChipText: { color: '#544F63', fontWeight: '600' },
  cancelledChipTextSelected: { color: '#991B1B', fontWeight: '700' },
  receiptRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
  },
  receiptRowCancelled: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  receiptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  receiptCode: { color: ui.colors.text, fontWeight: '800' },
  status: { fontSize: 12, fontWeight: '700' },
  statusActive: { color: '#15803D' },
  statusCancelled: { color: '#B91C1C' },
  receiptMeta: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  receiptAmount: { color: ui.colors.text, fontSize: 15, fontWeight: '800', marginTop: 8 },
  emptyText: { color: ui.colors.textMuted, textAlign: 'center', paddingVertical: 8 },
});
