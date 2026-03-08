import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { getPaymentMethodLabel } from '../../utils/paymentMethods';

interface CashSalesSummaryBank {
  bankName: string;
  totalCents: number;
}

interface CashSalesSummaryItem {
  method: string;
  label: string;
  totalCents: number;
  banks: CashSalesSummaryBank[];
}

interface DailyCloseMetrics {
  soldTotal: number;
  soldCash: number;
  soldCredit: number;
  cashReturnsTotalCents: number;
  soldCashNetCents: number;
  soldTotalNetCents: number;
  collectedTotal: number;
  paymentsCount: number;
  salesCount: number;
  collectedByMethod: Record<string, number>;
  cashSalesSummary: {
    totalCents: number;
    salesCount: number;
    byMethod: CashSalesSummaryItem[];
  };
}

const EMPTY_METRICS: DailyCloseMetrics = {
  soldTotal: 0,
  soldCash: 0,
  soldCredit: 0,
  cashReturnsTotalCents: 0,
  soldCashNetCents: 0,
  soldTotalNetCents: 0,
  collectedTotal: 0,
  paymentsCount: 0,
  salesCount: 0,
  collectedByMethod: {},
  cashSalesSummary: {
    totalCents: 0,
    salesCount: 0,
    byMethod: [],
  },
};

function toYmd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

export function DailyCloseScreen() {
  const today = useMemo(() => toYmd(new Date()), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(true);
  const [showCashSalesSummary, setShowCashSalesSummary] = useState(false);
  const [metrics, setMetrics] = useState<DailyCloseMetrics>(EMPTY_METRICS);

  const loadMetrics = useCallback(async (fromYmd: string, toYmdValue: string) => {
    const fromDate = parseYmd(fromYmd) || new Date();
    const toDate = parseYmd(toYmdValue) || fromDate;
    const fromTs = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0).getTime();
    const toTs = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999).getTime();

    setLoading(true);
    try {
      const [salesRows, paymentRows, returnRows] = await Promise.all([
        db.query<any>('SELECT total_cents, status, data, created_at FROM sales WHERE created_at >= ? AND created_at <= ?', [fromTs, toTs]),
        db.query<any>('SELECT amount_cents, data FROM payments'),
        db.query<any>(
          `SELECT total_cents, returned_at, cancelled_at, data
           FROM returns
           WHERE returned_at >= ? AND returned_at <= ?`,
          [fromTs, toTs]
        ),
      ]);

      let soldTotal = 0;
      let soldCash = 0;
      let soldCredit = 0;
      let salesCount = 0;
      let cashSalesCount = 0;
      const cashSalesSummaryMap = new Map<string, { method: string; label: string; totalCents: number; banks: Map<string, number> }>();

      for (const row of salesRows) {
        const statusRaw = String(row.status || '').toUpperCase();
        if (statusRaw === 'CANCELLED' || statusRaw === 'CANCELADO') continue;
        let parsed: any = null;
        try {
          parsed = row.data ? JSON.parse(row.data) : null;
        } catch {
          parsed = null;
        }
        if (parsed?.cancelledAt) continue;

        const cents = Number(row.total_cents || 0);
        const type = String(parsed?.type || '').toUpperCase();
        soldTotal += cents;
        salesCount += 1;
        if (type === 'CREDITO') soldCredit += cents;
        else {
          soldCash += cents;
          cashSalesCount += 1;

          const paymentSplits = Array.isArray(parsed?.paymentSplits) ? parsed.paymentSplits : [];
          if (paymentSplits.length > 0) {
            for (const split of paymentSplits) {
              const method = String(split?.method || 'OTRO').toUpperCase();
              const amountCents = Number(split?.amountCents || 0);
              if (!Number.isFinite(amountCents) || amountCents <= 0) continue;

              const current = cashSalesSummaryMap.get(method) || {
                method,
                label: getPaymentMethodLabel(method),
                totalCents: 0,
                banks: new Map<string, number>(),
              };

              current.totalCents += amountCents;
              if (method === 'TRANSFERENCIA' && split?.transferBankName) {
                const bankName = String(split.transferBankName);
                current.banks.set(bankName, (current.banks.get(bankName) || 0) + amountCents);
              }

              cashSalesSummaryMap.set(method, current);
            }
            continue;
          }

          const method = String(parsed?.paymentMethod || 'OTRO').toUpperCase();
          const current = cashSalesSummaryMap.get(method) || {
            method,
            label: getPaymentMethodLabel(method),
            totalCents: 0,
            banks: new Map<string, number>(),
          };

          current.totalCents += cents;
          if (method === 'TRANSFERENCIA' && parsed?.transferBankName) {
            const bankName = String(parsed.transferBankName);
            current.banks.set(bankName, (current.banks.get(bankName) || 0) + cents);
          }

          cashSalesSummaryMap.set(method, current);
        }
      }

      let cashReturnsTotalCents = 0;
      for (const row of returnRows) {
        let parsed: any = null;
        try {
          parsed = row.data ? JSON.parse(row.data) : null;
        } catch {
          parsed = null;
        }
        if (row.cancelled_at || parsed?.cancelledAt) continue;

        const saleType = String(parsed?.sale?.type || parsed?.type || '').toUpperCase();
        if (saleType !== 'CONTADO') continue;

        const cents = Number(row.total_cents || parsed?.totalCents || 0);
        if (!Number.isFinite(cents) || cents <= 0) continue;
        cashReturnsTotalCents += cents;
      }

      const soldCashNetCents = soldCash - cashReturnsTotalCents;
      const soldTotalNetCents = soldTotal - cashReturnsTotalCents;

      let collectedTotal = 0;
      let paymentsCount = 0;
      const byMethod: Record<string, number> = {};

      for (const row of paymentRows) {
        let parsed: any = null;
        try {
          parsed = row.data ? JSON.parse(row.data) : null;
        } catch {
          parsed = null;
        }
        if (parsed?.cancelledAt) continue;
        const paidAtRaw = parsed?.paidAt ?? parsed?.createdAt ?? parsed?.date ?? null;
        const paidAt =
          typeof paidAtRaw === 'number'
            ? paidAtRaw
            : typeof paidAtRaw === 'string'
              ? new Date(paidAtRaw).getTime()
              : NaN;
        if (!Number.isFinite(paidAt) || paidAt < fromTs || paidAt > toTs) continue;

        const cents = Number(row.amount_cents || 0);
        const method = String(parsed?.method || parsed?.paymentMethod || 'OTRO').toUpperCase();
        collectedTotal += cents;
        paymentsCount += 1;
        byMethod[method] = (byMethod[method] || 0) + cents;
      }

      const cashSalesSummaryByMethod: CashSalesSummaryItem[] = Array.from(cashSalesSummaryMap.values())
        .map((item) => ({
          method: item.method,
          label: item.label,
          totalCents: item.totalCents,
          banks: Array.from(item.banks.entries())
            .map(([bankName, totalCents]) => ({ bankName, totalCents }))
            .filter((bank) => bank.totalCents > 0)
            .sort((a, b) => b.totalCents - a.totalCents || a.bankName.localeCompare(b.bankName, 'es')),
        }))
        .sort((a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label, 'es'));

      setMetrics({
        soldTotal,
        soldCash,
        soldCredit,
        cashReturnsTotalCents,
        soldCashNetCents,
        soldTotalNetCents,
        collectedTotal,
        paymentsCount,
        salesCount,
        collectedByMethod: byMethod,
        cashSalesSummary: {
          totalCents: soldCash,
          salesCount: cashSalesCount,
          byMethod: cashSalesSummaryByMethod,
        },
      });
    } catch (error) {
      console.error('Error cargando cuadre diario:', error);
      setMetrics(EMPTY_METRICS);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMetrics(from, to);
    }, [from, to, loadMetrics])
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Cuadre diario</Text>
          <Text style={styles.subtitle}>Resumen de lo vendido y lo cobrado del día o por rango.</Text>
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
            <Button mode="contained" onPress={() => loadMetrics(from, to)} buttonColor={ui.colors.primary} style={styles.halfBtn}>
              Aplicar
            </Button>
            <Button
              mode="outlined"
              onPress={() => {
                const now = toYmd(new Date());
                setFrom(now);
                setTo(now);
                loadMetrics(now, now);
              }}
              textColor={ui.colors.primary}
              style={styles.halfBtn}
            >
              Hoy
            </Button>
          </View>
        </View>

        <View style={styles.cardsGrid}>
          <Card style={styles.metricCard}>
            <Card.Content>
              <Text style={styles.metricLabel}>Vendido hoy</Text>
              <Text style={styles.metricValue}>{formatCurrency(metrics.soldTotalNetCents)}</Text>
              <Text style={styles.metricHint}>{metrics.salesCount} facturas</Text>
              <Text style={styles.metricHint}>Bruto: {formatCurrency(metrics.soldTotal)}</Text>
            </Card.Content>
          </Card>
          <Card style={styles.metricCard}>
            <Card.Content>
              <Text style={styles.metricLabel}>Vendido contado</Text>
              <Text style={styles.metricValue}>{formatCurrency(metrics.soldCashNetCents)}</Text>
              <Text style={styles.metricHint}>Bruto: {formatCurrency(metrics.soldCash)}</Text>
            </Card.Content>
          </Card>
          <Card style={styles.metricCard}>
            <Card.Content>
              <Text style={styles.metricLabel}>Vendido crédito</Text>
              <Text style={styles.metricValue}>{formatCurrency(metrics.soldCredit)}</Text>
            </Card.Content>
          </Card>
          <Card style={styles.metricCard}>
            <Card.Content>
              <Text style={styles.metricLabel}>Cobrado (abonos)</Text>
              <Text style={styles.metricValue}>{formatCurrency(metrics.collectedTotal)}</Text>
              <Text style={styles.metricHint}>{metrics.paymentsCount} pagos</Text>
            </Card.Content>
          </Card>
          <Card style={styles.metricCard}>
            <Card.Content>
              <Text style={styles.metricLabel}>Devoluciones contado</Text>
              <Text style={styles.metricDanger}>-{formatCurrency(metrics.cashReturnsTotalCents)}</Text>
              <Text style={styles.metricHint}>Descontadas por fecha de devolucion</Text>
            </Card.Content>
          </Card>
        </View>

        <Card style={styles.detailCard}>
          <Card.Content>
            <Text style={styles.detailTitle}>Detalle de cobros por método</Text>
            {loading ? <Text style={styles.emptyText}>Cargando...</Text> : null}
            {!loading && Object.keys(metrics.collectedByMethod).length === 0 ? <Text style={styles.emptyText}>No hay cobros registrados.</Text> : null}
            {!loading
              ? Object.entries(metrics.collectedByMethod).map(([method, cents]) => (
                  <View key={method} style={styles.methodRow}>
                    <Text style={styles.methodName}>{method}</Text>
                    <Text style={styles.methodValue}>{formatCurrency(cents)}</Text>
                  </View>
                ))
              : null}
          </Card.Content>
        </Card>

        <Card style={styles.detailCard}>
          <Card.Content>
            <View style={styles.summaryHeader}>
              <View style={styles.summaryHeaderText}>
                <Text style={styles.detailTitle}>Ventas al contado por método</Text>
                <Text style={styles.metricHint}>
                  {formatCurrency(metrics.cashSalesSummary.totalCents)} · {metrics.cashSalesSummary.salesCount} ventas
                </Text>
              </View>
              <Button mode="outlined" onPress={() => setShowCashSalesSummary((value) => !value)} textColor={ui.colors.primary}>
                {showCashSalesSummary ? 'Ocultar' : 'Ver resumen'}
              </Button>
            </View>

            {showCashSalesSummary ? (
              loading ? (
                <Text style={styles.emptyText}>Cargando...</Text>
              ) : metrics.cashSalesSummary.byMethod.length === 0 ? (
                <Text style={styles.emptyText}>No hay ventas al contado en el rango seleccionado.</Text>
              ) : (
                metrics.cashSalesSummary.byMethod.map((item) => (
                  <View key={item.method} style={styles.summaryMethodCard}>
                    <View style={styles.methodRowCompact}>
                      <Text style={styles.methodName}>{item.label}</Text>
                      <Text style={styles.methodValue}>{formatCurrency(item.totalCents)}</Text>
                    </View>

                    {item.method === 'TRANSFERENCIA' && item.banks.length > 0 ? (
                      <View style={styles.bankList}>
                        {item.banks.map((bank) => (
                          <View key={bank.bankName} style={styles.bankRow}>
                            <Text style={styles.bankName}>{bank.bankName}</Text>
                            <Text style={styles.bankValue}>{formatCurrency(bank.totalCents)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))
              )
            ) : null}
          </Card.Content>
        </Card>
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
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 12,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  halfBtn: { flex: 1 },
  cardsGrid: { gap: 10 },
  metricCard: { borderRadius: ui.radius.lg, borderWidth: 1, borderColor: ui.colors.border, backgroundColor: ui.colors.surface },
  metricLabel: { color: ui.colors.textMuted, fontSize: 13 },
  metricValue: { color: ui.colors.text, fontSize: 23, fontWeight: '800', marginTop: 4 },
  metricDanger: { color: '#B91C1C', fontSize: 23, fontWeight: '800', marginTop: 4 },
  metricHint: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  detailCard: { marginTop: 10, borderRadius: ui.radius.lg, borderWidth: 1, borderColor: ui.colors.border, backgroundColor: ui.colors.surface },
  detailTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  summaryHeaderText: { flex: 1 },
  summaryMethodCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  methodRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  methodRowCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  methodName: { color: ui.colors.text, fontWeight: '700' },
  methodValue: { color: ui.colors.text, fontWeight: '800' },
  bankList: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    paddingTop: 10,
    gap: 8,
  },
  bankRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  bankName: { color: ui.colors.textMuted },
  bankValue: { color: ui.colors.text, fontWeight: '700' },
  emptyText: { color: ui.colors.textMuted, paddingVertical: 8 },
});
