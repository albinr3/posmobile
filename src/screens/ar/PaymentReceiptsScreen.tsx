import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert, Text as RNText } from 'react-native';
import { Searchbar, Text, Icon } from 'react-native-paper';
import * as Print from 'expo-print';
import { useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useAuthStore } from '../../store/authStore';

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
  customerName: string;
  invoiceCode?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt: number;
  cancelledAt?: number | null;
  arId?: string | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildPaymentReceiptHtml(payment: PaymentReceiptItem): string {
  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
          .wrap { max-width: 280px; margin: 0 auto; }
          .title { text-align: center; font-size: 16px; font-weight: 800; margin: 8px 0 2px; }
          .subtitle { text-align: center; color: #666; margin-bottom: 10px; }
          .row { display: flex; justify-content: space-between; margin: 3px 0; }
          .divider { border-top: 1px dashed #999; margin: 10px 0; }
          .total { font-size: 16px; font-weight: 800; text-align: right; margin-top: 8px; }
          .cancelled { color: #b91c1c; font-weight: 800; text-align: center; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="title">RECIBO DE PAGO</div>
          <div class="subtitle">Cuentas por cobrar</div>
          <div class="divider"></div>
          <div class="row"><span>Recibo:</span><strong>${escapeHtml(payment.receiptCode)}</strong></div>
          <div class="row"><span>Fecha:</span><span>${escapeHtml(formatDateTime(payment.createdAt))}</span></div>
          <div class="row"><span>Cliente:</span><span>${escapeHtml(payment.customerName)}</span></div>
          <div class="row"><span>Factura:</span><span>${escapeHtml(payment.invoiceCode || '-')}</span></div>
          <div class="row"><span>Método:</span><span>${escapeHtml(payment.paymentMethod)}</span></div>
          <div class="row"><span>Referencia:</span><span>${escapeHtml(payment.reference || '-')}</span></div>
          ${payment.notes ? `<div style="margin-top:6px;"><strong>Notas:</strong> ${escapeHtml(payment.notes)}</div>` : ''}
          <div class="divider"></div>
          <div class="total">TOTAL: ${escapeHtml(formatCurrency(payment.amountCents))}</div>
          ${payment.cancelledAt ? `<div class="cancelled">RECIBO CANCELADO</div>` : ''}
        </div>
      </body>
    </html>
  `;
}

export function PaymentReceiptsScreen({ navigation }: PaymentReceiptsScreenProps) {
  const [receipts, setReceipts] = useState<PaymentReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();
  const loadReceiptsRef = useRef<(() => Promise<void>) | null>(null);

  const loadLocalReceipts = useCallback(async () => {
    const rows = await db.query<any>(
      `SELECT local_id, server_id, receipt_code, amount_cents, ar_id, data
       FROM payments
       ORDER BY rowid DESC`
    );
    return rows.map((row) => {
      let parsed: any = null;
      try {
        parsed = row?.data ? JSON.parse(row.data) : null;
      } catch {
        parsed = null;
      }
      return {
        id: String(row.server_id || row.local_id),
        localId: String(row.local_id),
        serverId: row.server_id ? String(row.server_id) : null,
        receiptCode: String(parsed?.receiptCode || row.receipt_code || '-'),
        amountCents: Number(parsed?.amountCents || row.amount_cents || 0),
        paymentMethod: String(parsed?.method || parsed?.paymentMethod || 'EFECTIVO'),
        customerName: String(parsed?.customerName || 'Cliente'),
        invoiceCode: parsed?.invoiceCode ? String(parsed.invoiceCode) : null,
        reference: parsed?.reference ? String(parsed.reference) : null,
        notes: parsed?.note ? String(parsed.note) : parsed?.notes ? String(parsed.notes) : null,
        createdAt: Number(parsed?.paidAt || parsed?.createdAt || Date.now()),
        cancelledAt: parsed?.cancelledAt ? Number(parsed.cancelledAt) : null,
        arId: row.ar_id ? String(row.ar_id) : null,
      } as PaymentReceiptItem;
    });
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
      if (!isOnline) return;
      const clerkToken = await getToken();
      const subUserToken = useAuthStore.getState().subUserToken;
      if (!clerkToken || !subUserToken) return;

      syncService.setGetTokenFunction(() => getToken());
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
      await syncService.fullSync(clerkToken, { ignoreCooldown: true });

      const freshRows = await loadLocalReceipts();
      setReceipts(freshRows);
    } catch (error) {
      console.error('Error sincronizando recibos de pago:', error);
    } finally {
      setRefreshing(false);
    }
  }, [getToken, isOnline, loadLocalReceipts]);

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
    if (!q) return receipts;
    return receipts.filter(
      (item) =>
        item.receiptCode.toLowerCase().includes(q) ||
        (item.customerName || '').toLowerCase().includes(q) ||
        (item.invoiceCode || '').toLowerCase().includes(q)
    );
  }, [receipts, searchQuery]);

  const handleReprint = async (item: PaymentReceiptItem) => {
    try {
      await Print.printAsync({ html: buildPaymentReceiptHtml(item) });
    } catch (error) {
      console.error('Error imprimiendo recibo de pago:', error);
      Alert.alert('Impresión', 'No se pudo imprimir el recibo.');
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
      <Text style={styles.meta}>Método: {item.paymentMethod}</Text>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Monto</Text>
        <Text style={styles.totalValue}>{formatCurrency(item.amountCents)}</Text>
      </View>
      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionButton, styles.printButton]} onPress={() => handleReprint(item)}>
          <Icon source="printer" size={18} color="#fff" />
        </TouchableOpacity>
        {!item.cancelledAt ? (
          <TouchableOpacity style={[styles.actionButton, styles.cancelButton]} onPress={() => handleCancelReceipt(item)}>
            <Icon source="close" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <Text style={styles.cancelledNote}>Cancelado</Text>
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
      </View>

      <FlatList
        data={filteredReceipts}
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
  actionsRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printButton: { backgroundColor: '#2563EB' },
  cancelButton: { backgroundColor: '#EF4444' },
  cancelledNote: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
});
