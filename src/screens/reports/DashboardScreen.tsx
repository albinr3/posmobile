import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Svg, { Circle } from 'react-native-svg';
import { db } from '../../database/Database';
import { formatCurrency } from '../../utils/helpers';
import { useSyncStore } from '../../store/syncStore';
import { ui } from '../../theme/ui';

interface DashboardScreenProps {
  navigation: any;
}

interface PaymentSlice {
  label: string;
  value: number;
  color: string;
}

export function DashboardScreen({ navigation }: DashboardScreenProps) {
  const [stats, setStats] = useState({
    salesToday: 0,
    salesCount: 0,
    pendingAR: 0,
    pendingARCount: 0,
    lowStockCount: 0,
    totalProducts: 0,
    totalCustomers: 0,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentSlice[]>([]);
  const { isOnline, pendingCount, syncBlockedReason } = useSyncStore();
  const tabBarHeight = useBottomTabBarHeight();

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [])
  );

  const loadStats = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const salesResult = await db.queryFirst<any>(
        `SELECT COUNT(*) as count, COALESCE(SUM(total_cents), 0) as total
         FROM sales
         WHERE created_at >= ?
           AND LOWER(COALESCE(status, '')) != 'cancelled'`,
        [todayTimestamp]
      );
      const salesRows = await db.query<any>(
        `SELECT total_cents, status, data
         FROM sales
         WHERE created_at >= ?
           AND LOWER(COALESCE(status, '')) != 'cancelled'`,
        [todayTimestamp]
      );
      const arResult = await db.queryFirst<any>(
        `SELECT COUNT(*) as count, COALESCE(SUM(balance_cents), 0) as total
         FROM accounts_receivable WHERE status IN ('PENDIENTE', 'PARCIAL')`
      );
      const lowStockResult = await db.queryFirst<any>(`SELECT COUNT(*) as count FROM products WHERE stock <= 10`);
      const productsResult = await db.queryFirst<any>('SELECT COUNT(*) as count FROM products');
      const customersResult = await db.queryFirst<any>('SELECT COUNT(*) as count FROM customers');

      setStats({
        salesToday: salesResult?.total || 0,
        salesCount: salesResult?.count || 0,
        pendingAR: arResult?.total || 0,
        pendingARCount: arResult?.count || 0,
        lowStockCount: lowStockResult?.count || 0,
        totalProducts: productsResult?.count || 0,
        totalCustomers: customersResult?.count || 0,
      });

      let cashSalesCents = 0;
      let creditSalesCents = 0;

      for (const sale of salesRows) {
        const statusRaw = String(sale?.status || '').toUpperCase();
        if (statusRaw === 'CANCELLED' || statusRaw === 'CANCELADO') continue;
        let method = 'EFECTIVO';
        try {
          const parsed = sale?.data ? JSON.parse(sale.data) : null;
          if (parsed?.cancelledAt) continue;
          method = parsed?.paymentMethod || parsed?.payment_method || 'EFECTIVO';
        } catch {
          method = 'EFECTIVO';
        }
        const normalizedMethod = String(method).toUpperCase();
        const amount = sale.total_cents || 0;
        if (normalizedMethod === 'CREDITO') {
          creditSalesCents += amount;
        } else {
          cashSalesCents += amount;
        }
      }

      const paymentsRows = await db.query<any>('SELECT amount_cents, data FROM payments');
      let collectedTodayCents = 0;
      for (const payment of paymentsRows) {
        let createdAt = 0;
        try {
          const parsed = payment?.data ? JSON.parse(payment.data) : null;
          createdAt = Number(parsed?.createdAt || 0);
        } catch {
          createdAt = 0;
        }

        if (createdAt >= todayTimestamp && createdAt < todayTimestamp + 24 * 60 * 60 * 1000) {
          collectedTodayCents += payment.amount_cents || 0;
        }
      }

      const slices: PaymentSlice[] = [
        { label: 'Ventas al contado', value: cashSalesCents, color: '#1FA464' },
        { label: 'Ventas a crédito', value: creditSalesCents, color: '#7F13EC' },
        { label: 'Cobros realizados hoy', value: collectedTodayCents, color: '#E27C1B' },
      ];
      setPaymentBreakdown(slices);
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

  const totalPie = paymentBreakdown.reduce((sum, item) => sum + item.value, 0);
  const radius = 62;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;
  let currentOffset = 0;

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageHeaderTitle}>Dashboard</Text>
          <Text style={styles.pageHeaderSubtitle}>Resumen de ventas, inventario y cuentas por cobrar.</Text>
        </View>

        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Resumen del negocio</Text>
          <Text style={styles.headerSubtitle}>Controla ventas, inventario y cobros en tiempo real</Text>
          <View style={styles.connectionPill}>
            <Text style={styles.connectionText}>{isOnline ? 'En linea' : 'Sin conexion'}</Text>
            <Text style={styles.pendingText}>Pendientes: {pendingCount}</Text>
          </View>
          {syncBlockedReason ? (
            <View style={styles.syncAlertBox}>
              <Text style={styles.syncAlertTitle}>Sincronizacion pausada</Text>
              <Text style={styles.syncAlertText}>{syncBlockedReason}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.highlightCard}>
          <Text style={styles.highlightLabel}>Ventas de hoy</Text>
          <Text style={styles.highlightValue}>{formatCurrency(stats.salesToday)}</Text>
          <Text style={styles.highlightCaption}>{stats.salesCount} transacciones</Text>
        </View>

        <View style={styles.gridRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{formatCurrency(stats.pendingAR)}</Text>
            <Text style={styles.metricLabel}>Por cobrar</Text>
            <Text style={styles.metricSub}>{stats.pendingARCount} cuentas</Text>
          </View>
          <View style={[styles.metricCard, stats.lowStockCount > 0 && styles.warningCard]}>
            <Text style={[styles.metricValue, stats.lowStockCount > 0 && styles.warningText]}>{stats.lowStockCount}</Text>
            <Text style={styles.metricLabel}>Stock bajo</Text>
            <Text style={styles.metricSub}>productos</Text>
          </View>
        </View>

        <View style={styles.gridRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{stats.totalProducts}</Text>
            <Text style={styles.metricLabel}>Productos</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{stats.totalCustomers}</Text>
            <Text style={styles.metricLabel}>Clientes</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Resumen de hoy</Text>
        <View style={styles.chartCard}>
          {totalPie > 0 ? (
            <>
              <View style={styles.chartWrap}>
                <Svg width={160} height={160} viewBox="0 0 160 160">
                  <Circle cx={80} cy={80} r={radius} stroke="#EFEAF8" strokeWidth={strokeWidth} fill="none" />
                  {paymentBreakdown.map((slice) => {
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
                {paymentBreakdown.map((slice) => {
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
            <Text style={styles.emptyChartText}>No hay ventas hoy para graficar.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  pageHeader: {
    marginBottom: 6,
  },
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
  content: { padding: 14, paddingTop: 12 },
  headerCard: {
    backgroundColor: ui.colors.primary,
    borderRadius: ui.radius.xl,
    padding: 18,
  },
  headerTitle: { color: '#fff', fontWeight: '800', fontSize: 24 },
  headerSubtitle: { marginTop: 4, color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  connectionPill: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  connectionText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  pendingText: { color: '#fff', fontSize: 12 },
  syncAlertBox: {
    marginTop: 10,
    backgroundColor: 'rgba(255, 205, 107, 0.25)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 222, 156, 0.75)',
  },
  syncAlertTitle: { color: '#FFF8E6', fontWeight: '800', fontSize: 12 },
  syncAlertText: { color: '#FFF8E6', fontSize: 11, marginTop: 2 },
  highlightCard: {
    marginTop: 12,
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 16,
  },
  highlightLabel: { color: ui.colors.textMuted, fontSize: 13 },
  highlightValue: { fontSize: 34, color: ui.colors.primary, fontWeight: '800', marginTop: 4 },
  highlightCaption: { color: ui.colors.textMuted, fontSize: 12 },
  gridRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  metricCard: {
    flex: 1,
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
  },
  warningCard: { borderColor: '#FFDFB7', backgroundColor: '#FFF6EA' },
  metricValue: { fontSize: 24, fontWeight: '800', color: ui.colors.text },
  warningText: { color: ui.colors.warning },
  metricLabel: { marginTop: 2, fontSize: 13, color: ui.colors.text },
  metricSub: { marginTop: 1, fontSize: 11, color: ui.colors.textMuted },
  sectionTitle: { marginTop: 16, marginBottom: 10, color: ui.colors.text, fontWeight: '700', fontSize: 17 },
  chartCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
  },
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

