import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Text, Surface, Card, Button, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../../database/Database';
import { formatCurrency } from '../../utils/helpers';
import { useSyncStore } from '../../store/syncStore';

interface DashboardScreenProps {
  navigation: any;
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
  const { isOnline, pendingCount, lastSyncTime } = useSyncStore();

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

      // Ventas del día
      const salesResult = await db.queryFirst<any>(
        `SELECT COUNT(*) as count, COALESCE(SUM(total_cents), 0) as total 
         FROM sales WHERE created_at >= ?`,
        [todayTimestamp]
      );

      // Cuentas por cobrar
      const arResult = await db.queryFirst<any>(
        `SELECT COUNT(*) as count, COALESCE(SUM(balance_cents), 0) as total 
         FROM accounts_receivable WHERE status IN ('PENDIENTE', 'PARCIAL')`
      );

      // Productos con stock bajo
      const lowStockResult = await db.queryFirst<any>(
        `SELECT COUNT(*) as count FROM products WHERE stock <= 10`
      );

      // Totales
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

  const navigateThroughHome = (tabName: string, stackScreen?: string) => {
    navigation.navigate('Home', {
      screen: tabName,
      ...(stackScreen ? { params: { screen: stackScreen } } : {}),
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Status de conexión */}
        <Surface style={[styles.statusBar, !isOnline && styles.offlineBar]}>
          <Text style={styles.statusText}>
            {isOnline ? '🟢 Conectado' : '🔴 Sin conexión'}
          </Text>
          {pendingCount > 0 && (
            <Text style={styles.pendingText}>{pendingCount} pendientes de sincronizar</Text>
          )}
        </Surface>

        {/* Ventas del día */}
        <Card style={styles.mainCard}>
          <Card.Content>
            <Text style={styles.cardTitle}>Ventas de Hoy</Text>
            <Text style={styles.mainValue}>{formatCurrency(stats.salesToday)}</Text>
            <Text style={styles.cardSubtext}>{stats.salesCount} transacciones</Text>
          </Card.Content>
          <Card.Actions>
            <Button onPress={() => navigateThroughHome('POS', 'POSMain')}>
              Ver Ventas
            </Button>
          </Card.Actions>
        </Card>

        {/* Grid de estadísticas */}
        <View style={styles.statsGrid}>
          <Surface style={styles.statCard}>
            <Text style={styles.statValue}>{formatCurrency(stats.pendingAR)}</Text>
            <Text style={styles.statLabel}>Por Cobrar</Text>
            <Text style={styles.statSubtext}>{stats.pendingARCount} cuentas</Text>
          </Surface>

          <Surface style={[styles.statCard, stats.lowStockCount > 0 && styles.warningCard]}>
            <Text style={[styles.statValue, stats.lowStockCount > 0 && styles.warningText]}>
              {stats.lowStockCount}
            </Text>
            <Text style={styles.statLabel}>Stock Bajo</Text>
            <Text style={styles.statSubtext}>productos</Text>
          </Surface>
        </View>

        <View style={styles.statsGrid}>
          <Surface style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalProducts}</Text>
            <Text style={styles.statLabel}>Productos</Text>
            <Text style={styles.statSubtext}>en inventario</Text>
          </Surface>

          <Surface style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalCustomers}</Text>
            <Text style={styles.statLabel}>Clientes</Text>
            <Text style={styles.statSubtext}>registrados</Text>
          </Surface>
        </View>

        <Divider style={styles.divider} />

        {/* Acciones rápidas */}
        <Text style={styles.sectionTitle}>Acciones Rápidas</Text>
        <View style={styles.actionsGrid}>
          <Button
            mode="contained"
            icon="cash-register"
            onPress={() => navigateThroughHome('POS', 'POSMain')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            Nueva Venta
          </Button>
          <Button
            mode="outlined"
            icon="account-plus"
            onPress={() => navigateThroughHome('CustomersTab', 'AddCustomer')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            Nuevo Cliente
          </Button>
          <Button
            mode="outlined"
            icon="package-variant"
            onPress={() => navigateThroughHome('Inventory', 'AddProduct')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            Nuevo Producto
          </Button>
          <Button
            mode="outlined"
            icon="cash-plus"
            onPress={() => navigateThroughHome('AR', 'ARList')}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            Cobrar
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 12,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#e8f5e9',
  },
  offlineBar: {
    backgroundColor: '#ffebee',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pendingText: {
    fontSize: 12,
    color: '#666',
  },
  mainCard: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    color: '#666',
  },
  mainValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1a73e8',
    marginVertical: 8,
  },
  cardSubtext: {
    fontSize: 14,
    color: '#888',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 1,
  },
  warningCard: {
    backgroundColor: '#fff3e0',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  warningText: {
    color: '#f57c00',
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },
  statSubtext: {
    fontSize: 12,
    color: '#888',
  },
  divider: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    width: '47%',
  },
  actionButtonContent: {
    paddingVertical: 8,
  },
});
