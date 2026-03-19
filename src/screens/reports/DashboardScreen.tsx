import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import { db } from '../../database/Database';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useSyncStore } from '../../store/syncStore';

interface DashboardScreenProps {
  navigation: any;
}

interface ChartSlice {
  key: 'cash' | 'credit';
  label: string;
  value: number;
  color: string;
}

interface DashboardStats {
  salesTodayCents: number;
  salesTodayCount: number;
  salesCashCents: number;
  salesCashCount: number;
  salesCreditCents: number;
  salesCreditCount: number;
  paymentsTodayCents: number;
  paymentsTodayCount: number;
  operatingExpensesTodayCents: number;
  operatingExpensesTodayCount: number;
  arOpenCents: number;
  arOpenCount: number;
  lowStockCount: number;
}

const EMPTY_STATS: DashboardStats = {
  salesTodayCents: 0,
  salesTodayCount: 0,
  salesCashCents: 0,
  salesCashCount: 0,
  salesCreditCents: 0,
  salesCreditCount: 0,
  paymentsTodayCents: 0,
  paymentsTodayCount: 0,
  operatingExpensesTodayCents: 0,
  operatingExpensesTodayCount: 0,
  arOpenCents: 0,
  arOpenCount: 0,
  lowStockCount: 0,
};

function parseJson(value: any): any | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isCancelledStatus(status: any): boolean {
  const raw = String(status || '').trim().toUpperCase();
  return raw === 'CANCELLED' || raw === 'CANCELADO';
}

function getSaleType(rawData: any): 'CASH' | 'CREDIT' {
  const type = String(rawData?.type || '').toUpperCase();
  if (type === 'CREDITO') return 'CREDIT';

  const paymentMethod = String(rawData?.paymentMethod || rawData?.payment_method || '').toUpperCase();
  if (paymentMethod === 'CREDITO') return 'CREDIT';
  return 'CASH';
}

function toTimestamp(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function getProductMinStock(productData: any): number | null {
  const candidate =
    productData?.minStock ??
    productData?.min_stock ??
    productData?.minimumStock ??
    productData?.stockMin ??
    null;
  const minStock = Number(candidate);
  if (!Number.isFinite(minStock)) return null;
  return minStock;
}

export function DashboardScreen({ navigation }: DashboardScreenProps) {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [refreshing, setRefreshing] = useState(false);
  const [chartBreakdown, setChartBreakdown] = useState<ChartSlice[]>([
    { key: 'cash', label: 'Contado', value: 0, color: '#16A34A' },
    { key: 'credit', label: 'Crédito', value: 0, color: 'rgb(253, 186, 116)' },
  ]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [])
  );

  // Recargar stats automáticamente cuando se completa un sync
  const lastSyncTime = useSyncStore((s) => s.lastSyncTime);
  useEffect(() => {
    if (lastSyncTime) {
      loadStats();
    }
  }, [lastSyncTime]);

  const loadStats = async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartTs = todayStart.getTime();
      const todayEndTs = todayStartTs + DAY_MS - 1;
      const sevenDaysStartTs = todayStartTs - 6 * DAY_MS;

      const [salesRows, paymentsRows, arResult, operatingExpensesToday, productsRows] = await Promise.all([
        db.query<any>(
          `SELECT total_cents, status, created_at, data
           FROM sales
           WHERE created_at >= ? AND created_at <= ?`,
          [sevenDaysStartTs, todayEndTs]
        ),
        db.query<any>('SELECT amount_cents, data FROM payments'),
        db.queryFirst<any>(
          `SELECT COUNT(*) as count, COALESCE(SUM(balance_cents), 0) as total
           FROM accounts_receivable
           WHERE status IN ('PENDIENTE', 'PARCIAL')`
        ),
        db.queryFirst<any>(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total
           FROM operating_expenses
           WHERE expense_date >= ? AND expense_date <= ?`,
          [todayStartTs, todayEndTs]
        ),
        db.query<any>('SELECT stock, data FROM products'),
      ]);

      const nextStats: DashboardStats = {
        ...EMPTY_STATS,
        arOpenCents: Number(arResult?.total || 0),
        arOpenCount: Number(arResult?.count || 0),
        operatingExpensesTodayCents: Number(operatingExpensesToday?.total || 0),
        operatingExpensesTodayCount: Number(operatingExpensesToday?.count || 0),
      };

      let chartCash = 0;
      let chartCredit = 0;

      for (const sale of salesRows) {
        if (isCancelledStatus(sale?.status)) continue;

        const parsed = parseJson(sale?.data);
        if (parsed?.cancelledAt) continue;

        const amount = Number(sale?.total_cents || 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const createdAt = Number(sale?.created_at || parsed?.createdAt || parsed?.soldAt || 0);
        const isToday = createdAt >= todayStartTs && createdAt <= todayEndTs;
        const saleType = getSaleType(parsed);

        if (saleType === 'CREDIT') {
          chartCredit += amount;
          if (isToday) {
            nextStats.salesCreditCents += amount;
            nextStats.salesCreditCount += 1;
          }
        } else {
          chartCash += amount;
          if (isToday) {
            nextStats.salesCashCents += amount;
            nextStats.salesCashCount += 1;
          }
        }

        if (isToday) {
          nextStats.salesTodayCents += amount;
          nextStats.salesTodayCount += 1;
        }
      }

      for (const payment of paymentsRows) {
        const parsed = parseJson(payment?.data);
        if (parsed?.cancelledAt) continue;

        const paidAt = toTimestamp(parsed?.paidAt ?? parsed?.createdAt ?? parsed?.date ?? null);
        if (!Number.isFinite(paidAt)) continue;
        if (paidAt < todayStartTs || paidAt > todayEndTs) continue;

        nextStats.paymentsTodayCents += Number(payment?.amount_cents || 0);
        nextStats.paymentsTodayCount += 1;
      }

      let lowStockCount = 0;
      for (const product of productsRows) {
        const stock = Number(product?.stock || 0);
        const productData = parseJson(product?.data);
        const minStock = getProductMinStock(productData);
        const threshold = minStock !== null && minStock > 0 ? minStock : 10;
        if (stock <= threshold) lowStockCount += 1;
      }
      nextStats.lowStockCount = lowStockCount;

      setStats(nextStats);
      setChartBreakdown([
        { key: 'cash', label: 'Contado', value: chartCash, color: '#16A34A' },
        { key: 'credit', label: 'Crédito', value: chartCredit, color: 'rgb(253, 186, 116)' },
      ]);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadStats();
  };

  const totalPie = chartBreakdown.reduce((sum, item) => sum + item.value, 0);
  const radius = 62;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;
  let currentOffset = 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        <View style={styles.pageHeader}>
          <View style={styles.pageHeaderTextWrap}>
            <Text style={styles.pageHeaderTitle}>Dashboard</Text>
            <Text style={styles.pageHeaderSubtitle}>Resumen de ventas, inventario y cuentas por cobrar.</Text>
          </View>
          <Button mode="outlined" textColor={ui.colors.primary} onPress={() => navigation.navigate('DailyClose')}>
            Ver cuadre diario
          </Button>
        </View>

        <View style={styles.cardsWrap}>
          <View style={[styles.metricCard, styles.metricCardWide, { borderLeftColor: ui.colors.primary }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Venta total</Text>
              <Icon source="cash" size={18} color={ui.colors.primary} />
            </View>
            <Text style={[styles.metricValue, { color: ui.colors.primary }]}>{formatCurrency(stats.salesTodayCents)}</Text>
            <Text style={styles.metricSub}>{stats.salesTodayCount} facturas</Text>
          </View>

          <View style={[styles.metricCard, { borderLeftColor: '#16A34A' }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Venta al contado</Text>
              <Icon source="receipt-text-outline" size={18} color="#16A34A" />
            </View>
            <Text style={[styles.metricValue, { color: '#16A34A' }]}>{formatCurrency(stats.salesCashCents)}</Text>
            <Text style={styles.metricSub}>{stats.salesCashCount} facturas</Text>
          </View>

          <View style={[styles.metricCard, { borderLeftColor: 'rgb(253, 186, 116)' }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Venta a crédito</Text>
              <Icon source="credit-card-outline" size={18} color="rgb(253, 186, 116)" />
            </View>
            <Text style={[styles.metricValue, { color: 'rgb(253, 186, 116)' }]}>{formatCurrency(stats.salesCreditCents)}</Text>
            <Text style={styles.metricSub}>{stats.salesCreditCount} facturas</Text>
          </View>

          <View style={[styles.metricCard, { borderLeftColor: '#3B82F6' }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Cobros hoy</Text>
              <Icon source="trending-up" size={18} color="#3B82F6" />
            </View>
            <Text style={[styles.metricValue, { color: '#3B82F6' }]}>{formatCurrency(stats.paymentsTodayCents)}</Text>
            <Text style={styles.metricSub}>{stats.paymentsTodayCount} pagos</Text>
          </View>

          <View style={[styles.metricCard, { borderLeftColor: '#F97316' }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Gastos operativos</Text>
              <Icon source="cash-minus" size={18} color="#F97316" />
            </View>
            <Text style={[styles.metricValue, { color: '#F97316' }]}>
              {stats.operatingExpensesTodayCents > 0
                ? `-${formatCurrency(stats.operatingExpensesTodayCents)}`
                : formatCurrency(stats.operatingExpensesTodayCents)}
            </Text>
            <Text style={styles.metricSub}>{stats.operatingExpensesTodayCount} gastos hoy</Text>
          </View>

          <View style={[styles.metricCard, { borderLeftColor: '#DC2626' }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Cuentas por cobrar</Text>
              <Icon source="wallet-outline" size={18} color="#DC2626" />
            </View>
            <Text style={[styles.metricValue, { color: '#DC2626' }]}>{formatCurrency(stats.arOpenCents)}</Text>
            <Text style={styles.metricSub}>{stats.arOpenCount} facturas</Text>
          </View>

          <View style={[styles.metricCard, { borderLeftColor: stats.lowStockCount > 0 ? '#EF4444' : '#9CA3AF' }]}>
            <View style={styles.metricTopRow}>
              <Text style={styles.metricLabel}>Stock bajo</Text>
              <Icon source="alert-outline" size={18} color={stats.lowStockCount > 0 ? '#EF4444' : '#9CA3AF'} />
            </View>
            <Text style={[styles.metricValue, { color: stats.lowStockCount > 0 ? '#EF4444' : ui.colors.textMuted }]}>
              {stats.lowStockCount}
            </Text>
            <Text style={styles.metricSub}>productos</Text>
          </View>
        </View>

        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Icon source="chart-pie" size={18} color={ui.colors.primary} />
            <Text style={styles.chartTitle}>Ventas de los últimos 7 días</Text>
          </View>
          {totalPie > 0 ? (
            <>
              <View style={styles.chartWrap}>
                <Svg width={160} height={160} viewBox="0 0 160 160">
                  <Circle cx={80} cy={80} r={radius} stroke="#EFEAF8" strokeWidth={strokeWidth} fill="none" />
                  {chartBreakdown.map((slice) => {
                    const progress = slice.value / totalPie;
                    const dash = progress * circumference;
                    const offset = circumference - currentOffset;
                    currentOffset += dash;
                    return (
                      <Circle
                        key={slice.label}
                        cx={80}
                        cy={80}
                        r={radius}
                        stroke={slice.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${dash} ${circumference - dash}`}
                        strokeDashoffset={offset}
                        strokeLinecap="butt"
                        rotation={-90}
                        originX={80}
                        originY={80}
                        fill="none"
                      />
                    );
                  })}
                </Svg>
                <View style={styles.chartCenter}>
                  <Text style={styles.chartCenterLabel}>Total</Text>
                  <Text style={styles.chartCenterValue}>{formatCurrency(totalPie)}</Text>
                </View>
              </View>
              <View style={styles.legendList}>
                {chartBreakdown.map((slice) => {
                  const percentage = Math.round((slice.value / totalPie) * 100);
                  return (
                    <View key={slice.label} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
                      <View style={styles.legendTextWrap}>
                        <Text style={styles.legendLabel}>{slice.label}</Text>
                        <Text style={styles.legendValue}>
                          {formatCurrency(slice.value)} ({percentage}%)
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.emptyChartText}>No hay datos de ventas en los últimos 7 días.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingTop: 12, paddingBottom: 8, gap: 10 },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pageHeaderTextWrap: { flex: 1 },
  pageHeaderTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: ui.colors.text,
  },
  pageHeaderSubtitle: {
    fontSize: 13,
    color: ui.colors.textMuted,
    marginTop: 2,
  },
  cardsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '48%',
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderLeftWidth: 4,
    padding: 14,
  },
  metricCardWide: { width: '100%' },
  metricTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  metricValue: { fontSize: 24, fontWeight: '800', color: ui.colors.text },
  metricLabel: { fontSize: 13, color: ui.colors.textMuted },
  metricSub: { marginTop: 1, fontSize: 11, color: ui.colors.textMuted },
  chartCard: {
    marginTop: 2,
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
  },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  chartTitle: { color: ui.colors.text, fontWeight: '700', fontSize: 16 },
  chartWrap: { alignItems: 'center', justifyContent: 'center' },
  chartCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  chartCenterLabel: { color: ui.colors.textMuted, fontSize: 11 },
  chartCenterValue: { color: ui.colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  legendList: { marginTop: 10, gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendTextWrap: { flexDirection: 'row', justifyContent: 'space-between', flex: 1 },
  legendLabel: { color: ui.colors.text, fontSize: 12, fontWeight: '600' },
  legendValue: { color: ui.colors.textMuted, fontSize: 12 },
  emptyChartText: {
    color: ui.colors.textMuted,
    textAlign: 'center',
    paddingVertical: 28,
  },
});

