import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert, Text as RNText, Share } from 'react-native';
import { Searchbar, Text, Icon, TextInput } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useSyncAuth } from '../../hooks/useSyncAuth';
import { formatPaymentWithBank } from '../../utils/paymentMethods';
import { hasConnectedPrinter, printPaymentReceiptDirect } from '../../services/printing/thermalPrinterService';

interface PaymentReceiptsScreenProps {
  navigation: any;
}

interface PaymentReceiptItem {
  id: string;
  localId?: string | null;
  serverId?: string | null;
  receiptCode: string;
  amountCents: number;
  paymentMethod: string;
  transferBankName?: string | null;
  customerName: string;
  invoiceCode?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt: number;
  balanceAfterCents?: number | null;
  cancelledAt?: number | null;
  arId?: string | null;
  batchItems?: PaymentReceiptItem[];
}

export function PaymentReceiptsScreen({ navigation }: PaymentReceiptsScreenProps) {
  const [receipts, setReceipts] = useState<PaymentReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const todayIso = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);
  const [startDate, setStartDate] = useState<string>(todayIso);
  const [endDate, setEndDate] = useState<string>(todayIso);
  const { isOnline } = useSyncStore();
  const { runFullSyncIfAuthenticated } = useSyncAuth();
  const loadReceiptsRef = useRef<(() => Promise<void>) | null>(null);

  const loadLocalReceipts = useCallback(async () => {
    const arRows = await db.query<any>('SELECT local_id, balance_cents, data FROM accounts_receivable');
    const invoiceCodeByArLocalId = new Map<string, string>();
    const balanceByArLocalId = new Map<string, number>();
    for (const arRow of arRows) {
      const arLocalId = arRow?.local_id ? String(arRow.local_id) : '';
      if (!arLocalId) continue;
      balanceByArLocalId.set(arLocalId, Number(arRow.balance_cents || 0));
      try {
        const arParsed = arRow?.data ? JSON.parse(arRow.data) : null;
        const invoiceCode = String(arParsed?.sale?.invoiceCode || arParsed?.invoiceCode || '').trim();
        if (invoiceCode) {
          invoiceCodeByArLocalId.set(arLocalId, invoiceCode);
        }
      } catch {
        // ignore malformed AR payloads
      }
    }

    const rows = await db.query<any>(
      `SELECT local_id, server_id, receipt_code, amount_cents, ar_id, data
       FROM payments
       ORDER BY rowid DESC`
    );
    const mapped = rows.map((row) => {
      let parsed: any = null;
      try {
        parsed = row?.data ? JSON.parse(row.data) : null;
      } catch {
        parsed = null;
      }
      const arLocalId = row.ar_id ? String(row.ar_id) : '';
      const fallbackInvoiceCode = arLocalId ? invoiceCodeByArLocalId.get(arLocalId) || null : null;
      const fallbackBalanceAfterCents = arLocalId ? balanceByArLocalId.get(arLocalId) ?? null : null;
      return {
        id: String(row.server_id || row.local_id),
        localId: String(row.local_id),
        serverId: row.server_id ? String(row.server_id) : null,
        receiptCode: String(parsed?.receiptCode || row.receipt_code || '-'),
        amountCents: Number(parsed?.amountCents || row.amount_cents || 0),
        paymentMethod: String(parsed?.method || parsed?.paymentMethod || 'EFECTIVO'),
        transferBankName: parsed?.transferBankName ? String(parsed.transferBankName) : null,
        customerName: String(parsed?.customerName || 'Cliente'),
        invoiceCode: parsed?.invoiceCode ? String(parsed.invoiceCode) : fallbackInvoiceCode,
        reference: parsed?.reference ? String(parsed.reference) : null,
        notes: parsed?.note ? String(parsed.note) : parsed?.notes ? String(parsed.notes) : null,
        createdAt: Number(parsed?.paidAt || parsed?.createdAt || Date.now()),
        balanceAfterCents: Number.isFinite(Number(parsed?.balanceAfterCents))
          ? Number(parsed.balanceAfterCents)
          : fallbackBalanceAfterCents,
        cancelledAt: parsed?.cancelledAt ? Number(parsed.cancelledAt) : null,
        arId: row.ar_id ? String(row.ar_id) : null,
      } as PaymentReceiptItem;
    });
    return mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, []);

  const applyLocalCancelledState = useCallback(async (item: PaymentReceiptItem, cancelledAt: number) => {
    const localPayment = item.localId
      ? { local_id: item.localId }
      : await db.queryFirst<{ local_id?: string }>(
          'SELECT local_id FROM payments WHERE server_id = ? OR receipt_code = ? LIMIT 1',
          [item.id, item.receiptCode]
        );
    const localPaymentId = localPayment?.local_id ? String(localPayment.local_id) : null;
    if (!localPaymentId) return null;

    const paymentRow = await db.queryFirst<any>('SELECT data, ar_id FROM payments WHERE local_id = ?', [localPaymentId]);
    let paymentData: any = {};
    try {
      paymentData = paymentRow?.data ? JSON.parse(paymentRow.data) : {};
    } catch {
      paymentData = {};
    }

    await db.update('payments', localPaymentId, {
      synced: 0,
      data: JSON.stringify({
        ...paymentData,
        id: item.id,
        serverId: item.id,
        receiptCode: item.receiptCode,
        amountCents: item.amountCents,
        customerName: item.customerName,
        status: 'cancelled',
        cancel: true,
        cancelledAt,
      }),
    });

    const arLocalId = item.arId || (paymentRow?.ar_id ? String(paymentRow.ar_id) : null);
    if (arLocalId) {
      const arRow = await db.queryFirst<any>(
        'SELECT total_cents, paid_cents FROM accounts_receivable WHERE local_id = ?',
        [arLocalId]
      );
      if (arRow) {
        const totalCents = Number(arRow.total_cents || 0);
        const currentPaidCents = Number(arRow.paid_cents || 0);
        const newPaidCents = Math.max(0, currentPaidCents - item.amountCents);
        const newBalanceCents = Math.max(0, totalCents - newPaidCents);
        const newStatus = newBalanceCents <= 0 ? 'PAGADO' : newPaidCents > 0 ? 'PARCIAL' : 'PENDIENTE';
        await db.update('accounts_receivable', arLocalId, {
          paid_cents: newPaidCents,
          balance_cents: newBalanceCents,
          status: newStatus,
        });
      }
    }

    return localPaymentId;
  }, []);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    try {
      const localRows = await loadLocalReceipts();
      setReceipts(localRows);
    } catch (error) {
      console.error('Error cargando recibos de pago:', error);
    } finally {
      setLoading(false);
    }

    try {
      const synced = await runFullSyncIfAuthenticated({
        isOnline,
        ignoreCooldown: true,
      });
      if (!synced) return;

      const freshRows = await loadLocalReceipts();
      setReceipts(freshRows);
    } catch (error) {
      console.error('Error sincronizando recibos de pago:', error);
    } finally {
      setRefreshing(false);
    }
  }, [isOnline, loadLocalReceipts, runFullSyncIfAuthenticated]);

  loadReceiptsRef.current = loadReceipts;

  useFocusEffect(
    useCallback(() => {
      loadReceiptsRef.current?.();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReceipts();
  };

  const filteredReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const parseDateStart = (value: string): number | null => {
      const parts = value.trim().split('-').map((v) => Number(v));
      if (parts.length !== 3) return null;
      const [y, m, d] = parts;
      if (!y || !m || !d) return null;
      const date = new Date(y, m - 1, d, 0, 0, 0, 0);
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    };
    const parseDateEnd = (value: string): number | null => {
      const parts = value.trim().split('-').map((v) => Number(v));
      if (parts.length !== 3) return null;
      const [y, m, d] = parts;
      if (!y || !m || !d) return null;
      const date = new Date(y, m - 1, d, 23, 59, 59, 999);
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    };

    const startTs = startDate ? parseDateStart(startDate) : null;
    const endTs = endDate ? parseDateEnd(endDate) : null;

    return receipts.filter((item) => {
      if (q) {
        const matchesQuery =
          item.receiptCode.toLowerCase().includes(q) ||
          (item.customerName || '').toLowerCase().includes(q) ||
          (item.invoiceCode || '').toLowerCase().includes(q);
        if (!matchesQuery) return false;
      }
      if (startTs !== null && item.createdAt < startTs) return false;
      if (endTs !== null && item.createdAt > endTs) return false;
      return true;
    });
  }, [receipts, searchQuery, startDate, endDate]);

  const groupedReceipts = useMemo(() => {
    const groups = new Map<string, PaymentReceiptItem[]>();
    for (const item of filteredReceipts) {
      const key = item.receiptCode || item.id;
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }

    return Array.from(groups.values())
      .map((items) => {
        const sorted = [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const first = sorted[0];
        if (!first) return null;
        if (sorted.length === 1) return first;
        const totalCents = sorted.reduce((sum, row) => sum + row.amountCents, 0);
        const hasCancelled = sorted.some((row) => !!row.cancelledAt);
        return {
          ...first,
          amountCents: totalCents,
          invoiceCode: `${sorted.length} facturas`,
          cancelledAt: hasCancelled ? first.cancelledAt || null : null,
          batchItems: sorted,
        } as PaymentReceiptItem;
      })
      .filter((item): item is PaymentReceiptItem => !!item)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [filteredReceipts]);

  const handleReprint = async (item: PaymentReceiptItem) => {
    try {
      const shouldAttemptPrint = await hasConnectedPrinter();
      if (!shouldAttemptPrint) {
        Alert.alert('Impresión', 'No hay una impresora conectada en Ajustes.');
        return;
      }

      const printResult = await printPaymentReceiptDirect({
        receiptCode: item.receiptCode,
        createdAt: item.createdAt,
        customerName: item.customerName,
        invoiceCode: item.invoiceCode || null,
        paymentMethod: item.paymentMethod,
        transferBankName: item.transferBankName || null,
        reference: item.reference || null,
        notes: item.notes || null,
        amountCents: item.amountCents,
        balanceAfterCents: item.balanceAfterCents ?? null,
        cancelledAt: item.cancelledAt || null,
      });

      if (printResult.printed) return;
      if (printResult.reason === 'missing_config') {
        Alert.alert('Impresión', 'No hay impresora térmica conectada. Ve a Ajustes > Impresora.');
        return;
      }
      if (printResult.reason === 'missing_native_module') {
        Alert.alert('Impresión', 'Esta app no tiene soporte nativo para impresora térmica Bluetooth. Genera un nuevo build.');
        return;
      }
      Alert.alert('Impresión', printResult.message || 'No se pudo imprimir el recibo.');
    } catch (error) {
      console.error('Error imprimiendo recibo de pago:', error);
      Alert.alert('Impresión', 'No se pudo imprimir el recibo.');
    }
  };

  const escapeHtml = (value: string) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const buildReceiptPdfHtml = (item: PaymentReceiptItem) => {
    const paymentLabel = formatPaymentWithBank(item.paymentMethod, item.transferBankName);
    const cancelledTag = item.cancelledAt ? '<div class="badge">CANCELADO</div>' : '';
    return `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; background: #fff; }
            .page { padding: 20px; }
            .title { font-size: 18px; font-weight: 800; margin-bottom: 8px; }
            .badge { display: inline-block; background: #FEE2E2; color: #DC2626; font-weight: 700; font-size: 11px; padding: 4px 8px; border-radius: 999px; }
            .row { display: flex; justify-content: space-between; margin: 6px 0; }
            .label { color: #6B7280; font-size: 12px; }
            .value { font-size: 13px; font-weight: 600; }
            .total { margin-top: 12px; font-size: 18px; font-weight: 800; display: flex; justify-content: space-between; }
            .notes { margin-top: 10px; font-size: 12px; color: #374151; }
            .divider { border-top: 1px solid #E5E7EB; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="title">Recibo de pago</div>
            ${cancelledTag}
            <div class="divider"></div>
            <div class="row"><span class="label">Recibo</span><span class="value">${escapeHtml(item.receiptCode)}</span></div>
            <div class="row"><span class="label">Cliente</span><span class="value">${escapeHtml(item.customerName || 'Cliente')}</span></div>
            <div class="row"><span class="label">Factura</span><span class="value">${escapeHtml(item.invoiceCode || '-')}</span></div>
            <div class="row"><span class="label">Fecha</span><span class="value">${escapeHtml(formatDateTime(item.createdAt))}</span></div>
            <div class="row"><span class="label">Método</span><span class="value">${escapeHtml(paymentLabel || '-')}</span></div>
            <div class="row"><span class="label">Referencia</span><span class="value">${escapeHtml(item.reference || '-')}</span></div>
            <div class="row"><span class="label">Balance</span><span class="value">${item.balanceAfterCents !== null && item.balanceAfterCents !== undefined ? escapeHtml(formatCurrency(item.balanceAfterCents)) : '-'}</span></div>
            ${item.notes ? `<div class="notes"><strong>Notas:</strong> ${escapeHtml(item.notes)}</div>` : ''}
            <div class="total"><span>Total</span><span>${formatCurrency(item.amountCents)}</span></div>
          </div>
        </body>
      </html>
    `;
  };

  const handleSharePdf = async (item: PaymentReceiptItem) => {
    try {
      const html = buildReceiptPdfHtml(item);
      const pdf = await Print.printToFileAsync({ html });
      const sharingAvailable = await Sharing.isAvailableAsync();
      const dialogTitle = `Recibo ${item.receiptCode}`;

      if (sharingAvailable) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Share.share({
          title: dialogTitle,
          message: dialogTitle,
          url: pdf.uri,
        });
      }
    } catch (error) {
      console.error('Error compartiendo PDF del recibo:', error);
      Alert.alert('PDF', 'No se pudo compartir el PDF del recibo.');
    }
  };

  const handleCancelReceipt = (item: PaymentReceiptItem) => {
    if (item.cancelledAt) {
      Alert.alert('Recibo', 'Este recibo ya está cancelado.');
      return;
    }

    Alert.alert('Cancelar recibo', `¿Seguro que deseas cancelar ${item.receiptCode}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, cancelar',
        style: 'destructive',
        onPress: async () => {
          try {
            const cancelledAt = Date.now();
            const serverPaymentId = item.serverId || null;
            if (!serverPaymentId) {
              Alert.alert('Sync', 'No se puede cancelar: el recibo aun no tiene id de servidor.');
              return;
            }
            const localPaymentId = await applyLocalCancelledState(item, cancelledAt);
            await syncService.queueOperation(
              'payment',
              'update',
              {
                id: serverPaymentId,
                cancel: true,
                status: 'cancelled',
                cancelledAt,
              },
              localPaymentId || `payment_${serverPaymentId}`
            );

            Alert.alert(
              'Recibo',
              isOnline
                ? 'Recibo cancelado localmente. Se sincronizara en segundo plano.'
                : 'Recibo marcado para cancelacion. Se sincronizara cuando haya internet.'
            );
            await loadReceipts();
          } catch (error) {
            console.error('Error cancelando recibo de pago:', error);
            Alert.alert('Error', 'No se pudo cancelar el recibo.');
          }
        },
      },
    ]);
  };

  const renderReceipt = ({ item }: { item: PaymentReceiptItem }) => (
    <View style={styles.card}>
      {item.batchItems && item.batchItems.length > 1 ? (
        <Text style={styles.batchLabel}>Recibo multi-factura</Text>
      ) : null}
      <View style={styles.rowBetween}>
        <Text style={styles.receiptCode}>{item.receiptCode}</Text>
        {item.cancelledAt ? (
          <View style={styles.cancelledBadge}>
            <RNText style={styles.cancelledBadgeText}>Cancelado</RNText>
          </View>
        ) : null}
      </View>
      <Text style={styles.meta}>Cliente: {item.customerName}</Text>
      <Text style={styles.meta}>Factura: {item.invoiceCode || '-'}</Text>
      <Text style={styles.meta}>Fecha: {formatDateTime(item.createdAt)}</Text>
      <Text style={styles.meta}>Método: {formatPaymentWithBank(item.paymentMethod, item.transferBankName)}</Text>
      {item.batchItems && item.batchItems.length > 1 ? (
        <View style={styles.breakdownWrap}>
          {item.batchItems.map((batchItem) => (
            <View key={batchItem.localId || batchItem.id} style={styles.breakdownRow}>
              <Text style={styles.breakdownInvoice}>{batchItem.invoiceCode || '-'}</Text>
              <Text style={styles.breakdownAmount}>{formatCurrency(batchItem.amountCents)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Monto</Text>
        <Text style={styles.totalValue}>{formatCurrency(item.amountCents)}</Text>
      </View>
      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionButton, styles.shareButton]} onPress={() => handleSharePdf(item.batchItems?.[0] || item)}>
          <Icon source="share-variant" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.printButton]} onPress={() => handleReprint(item.batchItems?.[0] || item)}>
          <Icon source="printer" size={18} color="#fff" />
        </TouchableOpacity>
        {!item.cancelledAt && !(item.batchItems && item.batchItems.length > 1) ? (
          <TouchableOpacity style={[styles.actionButton, styles.cancelButton]} onPress={() => handleCancelReceipt(item.batchItems?.[0] || item)}>
            <Icon source="close" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <Text style={styles.cancelledNote}>
            {item.batchItems && item.batchItems.length > 1 ? 'Cancelar por factura' : 'Cancelado'}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recibos de pago</Text>
        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar por recibo, cliente o factura..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>
        <View style={styles.dateFilters}>
          <TextInput
            label="Desde (YYYY-MM-DD)"
            value={startDate}
            onChangeText={setStartDate}
            mode="outlined"
            style={styles.dateInput}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
            placeholder="2026-03-17"
          />
          <TextInput
            label="Hasta (YYYY-MM-DD)"
            value={endDate}
            onChangeText={setEndDate}
            mode="outlined"
            style={styles.dateInput}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
            placeholder="2026-03-17"
          />
        </View>
      </View>

      <FlatList
        data={groupedReceipts}
        renderItem={renderReceipt}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando recibos...' : 'No hay recibos de pago'}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  header: {
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomLeftRadius: ui.radius.xl,
    borderBottomRightRadius: ui.radius.xl,
  },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 8 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: ui.radius.md,
    paddingLeft: 2,
    marginBottom: 10,
  },
  searchbar: { flex: 1, elevation: 0, backgroundColor: 'transparent' },
  searchInput: { minHeight: 40 },
  dateFilters: {
    marginTop: 8,
    gap: 8,
  },
  dateInput: {
    backgroundColor: '#fff',
  },
  list: { padding: 12, paddingBottom: 76 },
  card: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  receiptCode: { fontSize: 15, fontWeight: '700', color: ui.colors.text, flex: 1, marginRight: 8 },
  cancelledBadge: {
    backgroundColor: '#FEE2E2',
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelledBadgeText: {
    color: '#DC2626',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  meta: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  totalRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: ui.colors.textMuted, fontSize: 12, fontWeight: '700' },
  totalValue: { color: ui.colors.text, fontSize: 16, fontWeight: '800' },
  batchLabel: {
    alignSelf: 'flex-start',
    backgroundColor: '#DCFCE7',
    color: '#166534',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 6,
  },
  breakdownWrap: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    paddingTop: 6,
    gap: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownInvoice: {
    fontSize: 12,
    color: ui.colors.textMuted,
    fontWeight: '700',
  },
  breakdownAmount: {
    fontSize: 12,
    color: ui.colors.text,
    fontWeight: '700',
  },
  actionsRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: { backgroundColor: '#10B981' },
  printButton: { backgroundColor: '#2563EB' },
  cancelButton: { backgroundColor: '#EF4444' },
  cancelledNote: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
});
