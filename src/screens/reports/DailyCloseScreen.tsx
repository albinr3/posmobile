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

interface MethodBreakdown {
  method: string;
  label: string;
  totalCents: number;
  banks: CashSalesSummaryBank[];
}

interface DailyCloseMetrics {
  sales: {
    cashEfectivoCents: number;
    cashTarjetaCents: number;
    cashTransferenciaCents: number;
    cashTotalCents: number;
    creditCents: number;
    totalCents: number;
    returnsCents: number;
    netCents: number;
    cashCount: number;
    creditCount: number;
    totalCount: number;
    byMethod: MethodBreakdown[];
  };
  collections: {
    arEfectivoCents: number;
    arTarjetaCents: number;
    arTransferenciaCents: number;
    totalCents: number;
    arPaymentsCount: number;
    arByMethod: MethodBreakdown[];
  };
  cashRegister: {
    cashFromSalesCents: number;
    cashFromArCents: number;
    totalCashInCents: number;
    returnsCents: number;
    expensesCents: number;
    expenses: { description: string; amountCents: number }[];
  };
}

const EMPTY_METRICS: DailyCloseMetrics = {
  sales: {
    cashEfectivoCents: 0, cashTarjetaCents: 0, cashTransferenciaCents: 0,
    cashTotalCents: 0, creditCents: 0, totalCents: 0, returnsCents: 0, netCents: 0,
    cashCount: 0, creditCount: 0, totalCount: 0, byMethod: [],
  },
  collections: {
    arEfectivoCents: 0, arTarjetaCents: 0, arTransferenciaCents: 0,
    totalCents: 0, arPaymentsCount: 0, arByMethod: [],
  },
  cashRegister: {
    cashFromSalesCents: 0, cashFromArCents: 0, totalCashInCents: 0,
    returnsCents: 0, expensesCents: 0, expenses: [],
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
      const [salesRows, paymentRows, returnRows, expenseRows] = await Promise.all([
        db.query<any>('SELECT total_cents, status, data, created_at FROM sales WHERE created_at >= ? AND created_at <= ?', [fromTs, toTs]),
        db.query<any>('SELECT amount_cents, data FROM payments'),
        db.query<any>(
          `SELECT total_cents, returned_at, cancelled_at, data
           FROM returns
           WHERE returned_at >= ? AND returned_at <= ?`,
          [fromTs, toTs]
        ),
        db.query<any>(
          `SELECT amount_cents, description FROM operating_expenses WHERE expense_date >= ? AND expense_date <= ?`,
          [fromTs, toTs]
        ),
      ]);

      let soldTotalCents = 0;
      let soldCashCents = 0;
      let soldCreditCents = 0;
      let salesCount = 0;
      let cashSalesCount = 0;
      let creditSalesCount = 0;
      
      const cashSalesMethodMap = new Map<string, { method: string; label: string; totalCents: number; banks: Map<string, number> }>();

      for (const row of salesRows) {
        const statusRaw = String(row.status || '').toUpperCase();
        if (statusRaw === 'CANCELLED' || statusRaw === 'CANCELADO') continue;
        let parsed: any = null;
        try { parsed = row.data ? JSON.parse(row.data) : null; } catch { parsed = null; }
        if (parsed?.cancelledAt) continue;

        const cents = Number(row.total_cents || 0);
        const type = String(parsed?.type || '').toUpperCase();
        soldTotalCents += cents;
        salesCount += 1;
        
        if (type === 'CREDITO') {
          soldCreditCents += cents;
          creditSalesCount += 1;
        } else {
          soldCashCents += cents;
          cashSalesCount += 1;

          const paymentSplits = Array.isArray(parsed?.paymentSplits) ? parsed.paymentSplits : [];
          if (paymentSplits.length > 0) {
            for (const split of paymentSplits) {
              const method = String(split?.method || 'OTRO').toUpperCase();
              const amountCents = Number(split?.amountCents || 0);
              if (!Number.isFinite(amountCents) || amountCents <= 0) continue;

              const current = cashSalesMethodMap.get(method) || {
                method, label: getPaymentMethodLabel(method), totalCents: 0, banks: new Map<string, number>(),
              };

              current.totalCents += amountCents;
              if (method === 'TRANSFERENCIA' && split?.transferBankName) {
                const bankName = String(split.transferBankName);
                current.banks.set(bankName, (current.banks.get(bankName) || 0) + amountCents);
              }
              cashSalesMethodMap.set(method, current);
            }
            continue;
          }

          const method = String(parsed?.paymentMethod || 'OTRO').toUpperCase();
          const current = cashSalesMethodMap.get(method) || {
            method, label: getPaymentMethodLabel(method), totalCents: 0, banks: new Map<string, number>(),
          };

          current.totalCents += cents;
          if (method === 'TRANSFERENCIA' && parsed?.transferBankName) {
            const bankName = String(parsed.transferBankName);
            current.banks.set(bankName, (current.banks.get(bankName) || 0) + cents);
          }
          cashSalesMethodMap.set(method, current);
        }
      }

      let cashReturnsCents = 0;
      for (const row of returnRows) {
        let parsed: any = null;
        try { parsed = row.data ? JSON.parse(row.data) : null; } catch { parsed = null; }
        if (row.cancelled_at || parsed?.cancelledAt) continue;

        const saleType = String(parsed?.sale?.type || parsed?.type || '').toUpperCase();
        if (saleType !== 'CONTADO') continue;

        const cents = Number(row.total_cents || parsed?.totalCents || 0);
        if (!Number.isFinite(cents) || cents <= 0) continue;
        cashReturnsCents += cents;
      }

      let arCollectedTotal = 0;
      let arPaymentsCount = 0;
      const arByMethodMap = new Map<string, { method: string; label: string; totalCents: number; banks: Map<string, number> }>();

      for (const row of paymentRows) {
        let parsed: any = null;
        try { parsed = row.data ? JSON.parse(row.data) : null; } catch { parsed = null; }
        if (parsed?.cancelledAt) continue;
        const paidAtRaw = parsed?.paidAt ?? parsed?.createdAt ?? parsed?.date ?? null;
        const paidAt = typeof paidAtRaw === 'number' ? paidAtRaw : typeof paidAtRaw === 'string' ? new Date(paidAtRaw).getTime() : NaN;
        if (!Number.isFinite(paidAt) || paidAt < fromTs || paidAt > toTs) continue;

        const cents = Number(row.amount_cents || 0);
        const method = String(parsed?.method || parsed?.paymentMethod || 'OTRO').toUpperCase();
        
        arCollectedTotal += cents;
        arPaymentsCount += 1;
        
        const current = arByMethodMap.get(method) || {
          method, label: getPaymentMethodLabel(method), totalCents: 0, banks: new Map<string, number>(),
        };

        current.totalCents += cents;
        if (method === 'TRANSFERENCIA' && parsed?.transferBankName) {
          const bankName = String(parsed.transferBankName);
          current.banks.set(bankName, (current.banks.get(bankName) || 0) + cents);
        }
        arByMethodMap.set(method, current);
      }

      let expensesTotalCents = 0;
      const expensesList: {description: string, amountCents: number}[] = [];
      for (const row of expenseRows) {
        const cents = Number(row.amount_cents || 0);
        expensesTotalCents += cents;
        expensesList.push({ description: row.description || 'Gasto', amountCents: cents });
      }

      const mapToBreakdown = (map: typeof cashSalesMethodMap) => {
        return Array.from(map.values())
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
      };

      const cashFromSales = cashSalesMethodMap.get('EFECTIVO')?.totalCents || 0;
      const cashFromAr = arByMethodMap.get('EFECTIVO')?.totalCents || 0;

      setMetrics({
        sales: {
          cashEfectivoCents: cashFromSales,
          cashTarjetaCents: cashSalesMethodMap.get('TARJETA')?.totalCents || 0,
          cashTransferenciaCents: cashSalesMethodMap.get('TRANSFERENCIA')?.totalCents || 0,
          cashTotalCents: soldCashCents,
          creditCents: soldCreditCents,
          totalCents: soldTotalCents,
          returnsCents: cashReturnsCents,
          netCents: soldTotalCents - cashReturnsCents,
          cashCount: cashSalesCount,
          creditCount: creditSalesCount,
          totalCount: salesCount,
          byMethod: mapToBreakdown(cashSalesMethodMap),
        },
        collections: {
          arEfectivoCents: cashFromAr,
          arTarjetaCents: arByMethodMap.get('TARJETA')?.totalCents || 0,
          arTransferenciaCents: arByMethodMap.get('TRANSFERENCIA')?.totalCents || 0,
          totalCents: arCollectedTotal,
          arPaymentsCount: arPaymentsCount,
          arByMethod: mapToBreakdown(arByMethodMap),
        },
        cashRegister: {
          cashFromSalesCents: cashFromSales,
          cashFromArCents: cashFromAr,
          totalCashInCents: cashFromSales + cashFromAr,
          returnsCents: cashReturnsCents,
          expensesCents: expensesTotalCents,
          expenses: expensesList,
        }
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
          <Text style={styles.sectionTitle}>🧾 Ventas del día</Text>
          <View style={styles.cardsRow}>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>En efectivo</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.sales.cashEfectivoCents)}</Text>
              </Card.Content>
            </Card>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>Tarjeta / Transf.</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.sales.cashTarjetaCents + metrics.sales.cashTransferenciaCents)}</Text>
              </Card.Content>
            </Card>
          </View>
          <View style={styles.cardsRow}>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>A crédito</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.sales.creditCents)}</Text>
                <Text style={styles.metricHint}>{metrics.sales.creditCount} facturas</Text>
              </Card.Content>
            </Card>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>Total ventas</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.sales.totalCents)}</Text>
                <Text style={styles.metricHint}>{metrics.sales.totalCount} facturas</Text>
              </Card.Content>
            </Card>
          </View>

          {metrics.sales.returnsCents > 0 && (
            <Card style={styles.metricCard}>
              <Card.Content>
                <Text style={styles.metricLabel}>Devoluciones contado</Text>
                <Text style={styles.metricDanger}>-{formatCurrency(metrics.sales.returnsCents)}</Text>
                <Text style={styles.metricHint}>Neto: {formatCurrency(metrics.sales.netCents)}</Text>
              </Card.Content>
            </Card>
          )}

          {metrics.sales.byMethod.length > 0 && (
            <Card style={styles.detailCard}>
              <Card.Content>
                <View style={styles.summaryHeader}>
                  <Text style={styles.detailTitle}>Ventas al contado por método</Text>
                  <Button mode="outlined" onPress={() => setShowCashSalesSummary(!showCashSalesSummary)} textColor={ui.colors.primary} compact>
                    {showCashSalesSummary ? 'Ocultar' : 'Ver'}
                  </Button>
                </View>

                {showCashSalesSummary && metrics.sales.byMethod.map((item) => (
                  <View key={item.method} style={styles.summaryMethodCard}>
                    <View style={styles.methodRowCompact}>
                      <Text style={styles.methodName}>{item.label}</Text>
                      <Text style={styles.methodValue}>{formatCurrency(item.totalCents)}</Text>
                    </View>

                    {item.method === 'TRANSFERENCIA' && item.banks.length > 0 && (
                      <View style={styles.bankList}>
                        {item.banks.map((bank) => (
                          <View key={bank.bankName} style={styles.bankRow}>
                            <Text style={styles.bankName}>{bank.bankName}</Text>
                            <Text style={styles.bankValue}>{formatCurrency(bank.totalCents)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </Card.Content>
            </Card>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>💰 Cobros del día</Text>
          <Text style={styles.sectionSubtitle}>Lo que realmente entra a caja (abonos)</Text>
          <View style={styles.cardsRow}>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>Efectivo recibido</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.collections.arEfectivoCents)}</Text>
              </Card.Content>
            </Card>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>Con tarjeta</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.collections.arTarjetaCents)}</Text>
              </Card.Content>
            </Card>
          </View>
          <View style={styles.cardsRow}>
            <Card style={styles.metricCardHalf}>
              <Card.Content>
                <Text style={styles.metricLabel}>Transferencias</Text>
                <Text style={styles.metricValue}>{formatCurrency(metrics.collections.arTransferenciaCents)}</Text>
              </Card.Content>
            </Card>
            <Card style={[styles.metricCardHalf, { borderColor: ui.colors.primary + '50', backgroundColor: ui.colors.primary + '10' }]}>
              <Card.Content>
                <Text style={[styles.metricLabel, { color: ui.colors.primary, fontWeight: '700' }]}>Total cobrado</Text>
                <Text style={[styles.metricValue, { color: ui.colors.primary }]}>{formatCurrency(metrics.collections.totalCents)}</Text>
                <Text style={styles.metricHint}>{metrics.collections.arPaymentsCount} abonos</Text>
              </Card.Content>
            </Card>
          </View>

          {metrics.collections.arByMethod.length > 0 && (
            <Card style={styles.detailCard}>
              <Card.Content>
                <Text style={styles.detailTitle}>Recibos por método de pago</Text>
                {metrics.collections.arByMethod.map((item) => (
                  <View key={item.method} style={styles.summaryMethodCard}>
                    <View style={styles.methodRowCompact}>
                      <Text style={styles.methodName}>{item.label}</Text>
                      <Text style={styles.methodValue}>{formatCurrency(item.totalCents)}</Text>
                    </View>

                    {item.method === 'TRANSFERENCIA' && item.banks.length > 0 && (
                      <View style={styles.bankList}>
                        {item.banks.map((bank) => (
                          <View key={bank.bankName} style={styles.bankRow}>
                            <Text style={styles.bankName}>{bank.bankName}</Text>
                            <Text style={styles.bankValue}>{formatCurrency(bank.totalCents)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </Card.Content>
            </Card>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>🏦 Efectivo en caja</Text>
          <Text style={styles.sectionSubtitle}>Dinero físico ingresado</Text>
          <Card style={[styles.metricCard, { borderColor: '#16a34a50', backgroundColor: '#16a34a10' }]}>
            <Card.Content>
              <View style={styles.cashRow}>
                <Text style={styles.cashLabel}>Efectivo ventas contado</Text>
                <Text style={styles.cashValue}>{formatCurrency(metrics.cashRegister.cashFromSalesCents)}</Text>
              </View>
              <View style={styles.cashRow}>
                <Text style={styles.cashLabel}>Efectivo abonos (créditos)</Text>
                <Text style={styles.cashValue}>{formatCurrency(metrics.cashRegister.cashFromArCents)}</Text>
              </View>
              <View style={[styles.cashRow, { borderTopWidth: 1, borderTopColor: '#16a34a50', marginTop: 10, paddingTop: 10 }]}>
                <Text style={[styles.cashLabel, { fontWeight: 'bold', color: '#15803d' }]}>Total efectivo ingresado</Text>
                <Text style={[styles.cashValue, { fontWeight: 'bold', color: '#15803d', fontSize: 20 }]}>{formatCurrency(metrics.cashRegister.totalCashInCents)}</Text>
              </View>
            </Card.Content>
          </Card>

          {(metrics.cashRegister.returnsCents > 0 || metrics.cashRegister.expensesCents > 0) && (
            <Card style={[styles.detailCard, { borderStyle: 'dashed' }]}>
              <Card.Content>
                <Text style={styles.detailTitle}>Ref: Salidas del día</Text>
                <Text style={styles.metricHint}>Gastos y dev. no se restan auto. porque podrían ser banco y no físico.</Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {metrics.cashRegister.returnsCents > 0 && (
                    <View style={styles.methodRowCompact}>
                      <Text style={styles.bankName}>Devoluciones totales</Text>
                      <Text style={styles.metricDanger}>-{formatCurrency(metrics.cashRegister.returnsCents)}</Text>
                    </View>
                  )}
                  {metrics.cashRegister.expenses.map((expense, i) => (
                    <View key={i} style={styles.methodRowCompact}>
                      <Text style={styles.bankName}>Gasto: {expense.description}</Text>
                      <Text style={styles.metricDanger}>-{formatCurrency(expense.amountCents)}</Text>
                    </View>
                  ))}
                </View>
              </Card.Content>
            </Card>
          )}
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
  sectionTitle: { color: ui.colors.text, fontSize: 18, fontWeight: '700', marginBottom: 2 },
  sectionSubtitle: { color: ui.colors.textMuted, fontSize: 13, marginBottom: 8 },
  filtersCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 12,
    marginBottom: 16,
  },
  row: { flexDirection: 'row', gap: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  halfBtn: { flex: 1 },
  cardsGrid: { gap: 10 },
  cardsRow: { flexDirection: 'row', gap: 10, flex: 1 },
  metricCard: { borderRadius: ui.radius.lg, borderWidth: 1, borderColor: ui.colors.border, backgroundColor: ui.colors.surface },
  metricCardHalf: { flex: 1, borderRadius: ui.radius.lg, borderWidth: 1, borderColor: ui.colors.border, backgroundColor: ui.colors.surface },
  metricLabel: { color: ui.colors.textMuted, fontSize: 13 },
  metricValue: { color: ui.colors.text, fontSize: 21, fontWeight: '800', marginTop: 4 },
  metricDanger: { color: '#B91C1C', fontSize: 16, fontWeight: '700' },
  metricHint: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  detailCard: { marginTop: 4, borderRadius: ui.radius.lg, borderWidth: 1, borderColor: ui.colors.border, backgroundColor: ui.colors.surface },
  detailTitle: { color: ui.colors.text, fontSize: 15, fontWeight: '700' },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  summaryHeaderText: { flex: 1 },
  summaryMethodCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  cashRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  cashLabel: { color: ui.colors.text, fontSize: 14 },
  cashValue: { color: ui.colors.text, fontSize: 15, fontWeight: '600' },
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
