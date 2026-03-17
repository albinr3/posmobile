import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Button, Menu, Text, TextInput, Chip } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/helpers';
import { parseJsonObject, rangeToTimestamps, toTimestamp } from './reportUtils';

interface CustomerOption {
  id: string;
  name: string;
}

interface ARReportItem {
  localId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  invoiceCode: string;
  soldAt: number | null;
  dueDate: number | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: 'PENDIENTE' | 'PARCIAL' | 'PAGADO';
}

interface ARStats {
  totalItems: number;
  totalPendiente: number;
  totalVencido: number;
  countVencidas: number;
  topDebtors: Array<{
    customerId: string;
    customerName: string;
    invoiceCount: number;
    balanceCents: number;
  }>;
}

type ARStatusFilter = 'PENDING_DEFAULT' | 'PENDIENTE' | 'PARCIAL' | 'ALL';

const STATUS_OPTIONS: Array<{ value: ARStatusFilter; label: string }> = [
  { value: 'PENDING_DEFAULT', label: 'Pendientes + Parciales' },
  { value: 'PENDIENTE', label: 'Solo pendientes' },
  { value: 'PARCIAL', label: 'Solo parciales' },
  { value: 'ALL', label: 'Todas' },
];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildArReportHtml(
  reportRows: ARReportItem[],
  reportStats: ARStats,
  context: {
    generatedAt: number;
    statusLabel: string;
    customerName: string;
    invoiceCode: string;
    startDate: string;
    endDate: string;
    minAmount: string;
    maxAmount: string;
    overdueOnly: boolean;
  }
): string {
  const filters: string[] = [];
  filters.push(`Estado: ${context.statusLabel}`);
  filters.push(`Cliente: ${context.customerName}`);
  if (context.invoiceCode.trim()) filters.push(`Factura contiene: ${context.invoiceCode.trim()}`);
  if (context.startDate.trim() || context.endDate.trim()) {
    const from = context.startDate.trim() || context.endDate.trim();
    const to = context.endDate.trim() || context.startDate.trim();
    filters.push(`Rango: ${from} a ${to}`);
  }
  if (context.minAmount.trim()) filters.push(`Monto minimo: ${context.minAmount.trim()}`);
  if (context.maxAmount.trim()) filters.push(`Monto maximo: ${context.maxAmount.trim()}`);
  if (context.overdueOnly) filters.push('Solo vencidas');

  const rowsHtml = reportRows
    .map((item) => {
      const paidCents = Math.max(0, item.totalCents - item.balanceCents);
      const soldAt = item.soldAt ? formatDate(item.soldAt) : '-';
      const dueDate = item.dueDate ? formatDate(item.dueDate) : '-';
      const phone = item.customerPhone ? item.customerPhone : '-';
      return `
        <tr>
          <td>${escapeHtml(item.invoiceCode)}</td>
          <td>${escapeHtml(item.customerName)}</td>
          <td>${escapeHtml(phone)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(soldAt)}</td>
          <td>${escapeHtml(dueDate)}</td>
          <td>${escapeHtml(formatCurrency(item.totalCents))}</td>
          <td>${escapeHtml(formatCurrency(paidCents))}</td>
          <td>${escapeHtml(formatCurrency(item.balanceCents))}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          @page { size: Letter; margin: 14mm; }
          body { font-family: Arial, sans-serif; color: #111; font-size: 11px; padding: 16px; }
          .title { font-size: 18px; font-weight: 800; margin-bottom: 2px; }
          .subtitle { color: #555; margin-bottom: 8px; }
          .muted { color: #666; margin-bottom: 10px; }
          .stats { display: flex; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
          .stat { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; min-width: 150px; }
          .stat-label { color: #666; font-size: 10px; }
          .stat-value { font-size: 14px; font-weight: 700; margin-top: 3px; }
          .section-title { font-size: 13px; font-weight: 700; margin: 10px 0 6px; }
          ul { margin: 0 0 10px 18px; padding: 0; }
          li { margin: 2px 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-size: 10px; }
          .empty { text-align: center; color: #666; padding: 10px; border: 1px solid #ddd; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="title">Reporte de cuentas por cobrar</div>
        <div class="subtitle">Pendientes, vencidas y deudores.</div>
        <div class="muted">Generado: ${escapeHtml(formatDateTime(context.generatedAt))}</div>

        <div class="stats">
          <div class="stat">
            <div class="stat-label">Total facturas</div>
            <div class="stat-value">${escapeHtml(reportStats.totalItems)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total pendiente</div>
            <div class="stat-value">${escapeHtml(formatCurrency(reportStats.totalPendiente))}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total vencido</div>
            <div class="stat-value">${escapeHtml(formatCurrency(reportStats.totalVencido))}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Facturas vencidas</div>
            <div class="stat-value">${escapeHtml(reportStats.countVencidas)}</div>
          </div>
        </div>

        <div class="section-title">Filtros aplicados</div>
        <ul>
          ${filters.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
        </ul>

        <div class="section-title">Facturas (${reportRows.length})</div>
        ${
          reportRows.length
            ? `
              <table>
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Cliente</th>
                    <th>Telefono</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th>Vence</th>
                    <th>Total</th>
                    <th>Pagado</th>
                    <th>Pendiente</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            `
            : '<div class="empty">No hay facturas para exportar con los filtros actuales.</div>'
        }
      </body>
    </html>
  `;
}

function normalizeArStatus(status: unknown): 'PENDIENTE' | 'PARCIAL' | 'PAGADO' {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PARCIAL') return 'PARCIAL';
  if (normalized === 'PAGADO' || normalized === 'PAGADA') return 'PAGADO';
  return 'PENDIENTE';
}

export function AccountsReceivableReportScreen() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ARReportItem[]>([]);
  const [stats, setStats] = useState<ARStats>({
    totalItems: 0,
    totalPendiente: 0,
    totalVencido: 0,
    countVencidas: 0,
    topDebtors: [],
  });

  const [status, setStatus] = useState<ARStatusFilter>('PENDING_DEFAULT');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [invoiceCode, setInvoiceCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [customerMenuVisible, setCustomerMenuVisible] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  const loadCustomers = useCallback(async () => {
    try {
      const rowsResult = await db.query<{ local_id: string; name: string }>(
        'SELECT local_id, name FROM customers ORDER BY name ASC'
      );
      setCustomers(rowsResult.map((row) => ({ id: String(row.local_id), name: String(row.name || 'Cliente') })));
    } catch (error) {
      console.error('Error cargando clientes para filtro AR:', error);
      setCustomers([]);
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const rawRows = await db.query<any>('SELECT * FROM accounts_receivable ORDER BY due_date ASC, rowid DESC');
      const now = Date.now();

      const minAmountCents = minAmount.trim() ? Math.round(Number(minAmount) * 100) : null;
      const maxAmountCents = maxAmount.trim() ? Math.round(Number(maxAmount) * 100) : null;
      const hasDateFilter = Boolean(startDate.trim() || endDate.trim());
      const { fromTs, toTs } = rangeToTimestamps(startDate || endDate, endDate || startDate);

      const mapped: ARReportItem[] = [];

      for (const row of rawRows) {
        const parsed = parseJsonObject(row.data);
        const parsedSale = (parsed?.sale as Record<string, unknown>) || null;
        const parsedCustomer = (parsed?.customer as Record<string, unknown>) || null;

        const item: ARReportItem = {
          localId: String(row.local_id),
          customerId: String(row.customer_id || parsed?.customerId || ''),
          customerName: String(row.customer_name || parsedCustomer?.name || 'Cliente'),
          customerPhone:
            typeof parsedCustomer?.phone === 'string' && parsedCustomer.phone.trim()
              ? parsedCustomer.phone
              : null,
          invoiceCode: String(parsedSale?.invoiceCode || parsed?.invoiceCode || '-'),
          soldAt: toTimestamp(parsedSale?.soldAt || parsed?.soldAt || parsed?.createdAt),
          dueDate: toTimestamp(row.due_date || parsed?.dueDate),
          totalCents: Number(row.total_cents || parsed?.totalCents || 0),
          paidCents: Number(row.paid_cents || parsed?.paidCents || 0),
          balanceCents: Number(row.balance_cents || parsed?.balanceCents || 0),
          status: normalizeArStatus(row.status || parsed?.status),
        };

        if (status === 'PENDIENTE' && item.status !== 'PENDIENTE') continue;
        if (status === 'PARCIAL' && item.status !== 'PARCIAL') continue;
        if (status === 'PENDING_DEFAULT' && !(item.status === 'PENDIENTE' || item.status === 'PARCIAL')) continue;

        if (customerId !== 'ALL' && item.customerId !== customerId) continue;

        if (invoiceCode.trim()) {
          const q = invoiceCode.trim().toLowerCase();
          if (!item.invoiceCode.toLowerCase().includes(q)) continue;
        }

        if (hasDateFilter) {
          if (!item.soldAt || item.soldAt < fromTs || item.soldAt > toTs) continue;
        }

        if (minAmountCents !== null && item.balanceCents < minAmountCents) continue;
        if (maxAmountCents !== null && item.balanceCents > maxAmountCents) continue;

        const isOverdue = Boolean(item.dueDate && item.dueDate < now && item.status !== 'PAGADO');
        if (overdueOnly && !isOverdue) continue;

        mapped.push(item);
      }

      const totalPendiente = mapped
        .filter((item) => item.status === 'PENDIENTE' || item.status === 'PARCIAL')
        .reduce((sum, item) => sum + item.balanceCents, 0);

      const overdueItems = mapped.filter(
        (item) => item.status !== 'PAGADO' && Boolean(item.dueDate && item.dueDate < now)
      );

      const totalVencido = overdueItems.reduce((sum, item) => sum + item.balanceCents, 0);

      const byCustomer = new Map<string, { name: string; invoiceCount: number; balanceCents: number }>();
      for (const item of mapped) {
        const current = byCustomer.get(item.customerId) || {
          name: item.customerName,
          invoiceCount: 0,
          balanceCents: 0,
        };
        current.invoiceCount += 1;
        current.balanceCents += item.balanceCents;
        byCustomer.set(item.customerId, current);
      }

      const topDebtors = Array.from(byCustomer.entries())
        .sort((a, b) => b[1].balanceCents - a[1].balanceCents)
        .slice(0, 5)
        .map(([id, value]) => ({
          customerId: id,
          customerName: value.name,
          invoiceCount: value.invoiceCount,
          balanceCents: value.balanceCents,
        }));

      setRows(mapped);
      setStats({
        totalItems: mapped.length,
        totalPendiente,
        totalVencido,
        countVencidas: overdueItems.length,
        topDebtors,
      });
    } catch (error) {
      console.error('Error cargando reporte AR:', error);
      setRows([]);
      setStats({ totalItems: 0, totalPendiente: 0, totalVencido: 0, countVencidas: 0, topDebtors: [] });
    } finally {
      setLoading(false);
    }
  }, [customerId, endDate, invoiceCode, maxAmount, minAmount, overdueOnly, startDate, status]);

  useFocusEffect(
    useCallback(() => {
      loadCustomers();
      loadReport();
    }, [loadCustomers, loadReport])
  );

  const selectedCustomerName =
    customerId === 'ALL'
      ? 'Todos los clientes'
      : customers.find((customer) => customer.id === customerId)?.name || 'Cliente';
  const selectedStatusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label || 'Todas';

  const handleExportPdf = useCallback(async () => {
    if (rows.length === 0) {
      Alert.alert('Exportacion', 'No hay datos para exportar.');
      return;
    }

    setExporting(true);
    try {
      const html = buildArReportHtml(rows, stats, {
        generatedAt: Date.now(),
        statusLabel: selectedStatusLabel,
        customerName: selectedCustomerName,
        invoiceCode,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        overdueOnly,
      });
      const pdf = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exportar reporte de cuentas por cobrar',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.error('Error exportando reporte AR:', error);
      Alert.alert('Exportacion', 'No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  }, [
    endDate,
    invoiceCode,
    maxAmount,
    minAmount,
    overdueOnly,
    rows,
    selectedCustomerName,
    selectedStatusLabel,
    startDate,
    stats,
  ]);

  const handlePrintLetter = useCallback(async () => {
    if (rows.length === 0) {
      Alert.alert('Impresion', 'No hay datos para imprimir.');
      return;
    }

    setPrinting(true);
    try {
      const html = buildArReportHtml(rows, stats, {
        generatedAt: Date.now(),
        statusLabel: selectedStatusLabel,
        customerName: selectedCustomerName,
        invoiceCode,
        startDate,
        endDate,
        minAmount,
        maxAmount,
        overdueOnly,
      });
      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error imprimiendo reporte AR:', error);
      Alert.alert('Impresion', 'No se pudo imprimir el reporte.');
    } finally {
      setPrinting(false);
    }
  }, [
    endDate,
    invoiceCode,
    maxAmount,
    minAmount,
    overdueOnly,
    rows,
    selectedCustomerName,
    selectedStatusLabel,
    startDate,
    stats,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Cuentas por cobrar</Text>
          <Text style={styles.subtitle}>Pendientes, vencidas y ranking de deudores.</Text>
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

        <View style={styles.statsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total facturas</Text>
            <Text style={styles.metricValue}>{stats.totalItems}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total pendiente</Text>
            <Text style={[styles.metricValue, { color: '#C2410C' }]}>{formatCurrency(stats.totalPendiente)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total vencido</Text>
            <Text style={[styles.metricValue, { color: '#B91C1C' }]}>{formatCurrency(stats.totalVencido)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Facturas vencidas</Text>
            <Text style={[styles.metricValue, { color: '#B91C1C' }]}>{stats.countVencidas}</Text>
          </View>
        </View>

        {stats.topDebtors.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Mayores deudores</Text>
            {stats.topDebtors.map((debtor, index) => (
              <View key={debtor.customerId} style={styles.debtorRow}>
                <Text style={styles.debtorName}>#{index + 1} {debtor.customerName}</Text>
                <Text style={styles.debtorValue}>{formatCurrency(debtor.balanceCents)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Filtros</Text>

          <View style={styles.chipRow}>
            {STATUS_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={status === option.value}
                onPress={() => setStatus(option.value)}
                style={[styles.filterChip, status === option.value && styles.filterChipSelected]}
                textStyle={[styles.filterChipText, status === option.value && styles.filterChipTextSelected]}
                showSelectedOverlay={false}
              >
                {option.label}
              </Chip>
            ))}
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
            label="Codigo de factura"
            value={invoiceCode}
            onChangeText={setInvoiceCode}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

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
            selected={overdueOnly}
            onPress={() => setOverdueOnly((value) => !value)}
            style={[styles.overdueChip, overdueOnly && styles.overdueChipSelected]}
            textStyle={[styles.overdueChipText, overdueOnly && styles.overdueChipTextSelected]}
            showSelectedOverlay={false}
          >
            Solo vencidas
          </Chip>

          <View style={styles.row}>
            <Button mode="contained" buttonColor={ui.colors.primary} style={styles.halfBtn} onPress={loadReport}>
              Aplicar
            </Button>
            <Button
              mode="outlined"
              style={styles.halfBtn}
              textColor={ui.colors.primary}
              onPress={() => {
                setStatus('PENDING_DEFAULT');
                setCustomerId('ALL');
                setInvoiceCode('');
                setStartDate('');
                setEndDate('');
                setMinAmount('');
                setMaxAmount('');
                setOverdueOnly(false);
              }}
            >
              Limpiar
            </Button>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Facturas</Text>

          {loading ? <Text style={styles.emptyText}>Cargando...</Text> : null}
          {!loading && rows.length === 0 ? <Text style={styles.emptyText}>No se encontraron cuentas por cobrar.</Text> : null}

          {!loading
            ? rows.map((item) => {
                const paidCents = Math.max(0, item.totalCents - item.balanceCents);
                const isOverdue = Boolean(item.dueDate && item.dueDate < Date.now() && item.status !== 'PAGADO');
                return (
                  <View key={item.localId} style={[styles.invoiceRow, isOverdue && styles.invoiceRowOverdue]}>
                    <View style={styles.invoiceHeader}>
                      <Text style={styles.invoiceCode}>{item.invoiceCode}</Text>
                      <Text
                        style={[
                          styles.statusText,
                          item.status === 'PAGADO'
                            ? styles.statusPaid
                            : item.status === 'PARCIAL'
                              ? styles.statusPartial
                              : styles.statusPending,
                        ]}
                      >
                        {item.status}
                      </Text>
                    </View>

                    <Text style={styles.invoiceMeta}>{item.customerName}</Text>
                    {item.customerPhone ? <Text style={styles.invoiceMeta}>{item.customerPhone}</Text> : null}
                    {item.soldAt ? <Text style={styles.invoiceMeta}>Fecha: {formatDate(item.soldAt)}</Text> : null}
                    {item.dueDate ? (
                      <Text style={[styles.invoiceMeta, isOverdue && styles.overdueText]}>
                        Vence: {formatDate(item.dueDate)}
                      </Text>
                    ) : null}

                    <View style={styles.amountRow}>
                      <Text style={styles.amountLabel}>Total: {formatCurrency(item.totalCents)}</Text>
                      <Text style={styles.amountLabel}>Pagado: {formatCurrency(paidCents)}</Text>
                      <Text style={styles.amountValue}>Pendiente: {formatCurrency(item.balanceCents)}</Text>
                    </View>
                  </View>
                );
              })
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
  actionsRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },
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
  debtorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  debtorName: { color: ui.colors.text, fontWeight: '700' },
  debtorValue: { color: '#B91C1C', fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { backgroundColor: '#F4F1FA' },
  filterChipSelected: { backgroundColor: '#E9D5FF' },
  filterChipText: { color: '#544F63', fontSize: 11, fontWeight: '600' },
  filterChipTextSelected: { color: ui.colors.primary, fontWeight: '700' },
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
  row: { flexDirection: 'row', gap: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  halfBtn: { flex: 1 },
  overdueChip: { alignSelf: 'flex-start', marginBottom: 10, backgroundColor: '#F4F1FA' },
  overdueChipSelected: { backgroundColor: '#FEE2E2' },
  overdueChipText: { color: '#544F63', fontWeight: '600' },
  overdueChipTextSelected: { color: '#991B1B', fontWeight: '700' },
  invoiceRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
  },
  invoiceRowOverdue: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  invoiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  invoiceCode: { color: ui.colors.text, fontWeight: '800' },
  statusText: { fontSize: 12, fontWeight: '700' },
  statusPending: { color: '#B91C1C' },
  statusPartial: { color: '#C2410C' },
  statusPaid: { color: '#15803D' },
  invoiceMeta: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  overdueText: { color: '#B91C1C', fontWeight: '700' },
  amountRow: { marginTop: 8 },
  amountLabel: { color: ui.colors.textMuted, fontSize: 12, marginTop: 1 },
  amountValue: { color: ui.colors.text, fontWeight: '800', marginTop: 4 },
  emptyText: { color: ui.colors.textMuted, textAlign: 'center', paddingVertical: 8 },
});
