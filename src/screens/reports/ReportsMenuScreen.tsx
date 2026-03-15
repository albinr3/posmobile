import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Icon } from 'react-native-paper';

import { SafeAreaView } from '../../components/SafeAreaView';
import { ui } from '../../theme/ui';

interface ReportsMenuScreenProps {
  navigation: any;
}

interface ReportEntry {
  route: string;
  title: string;
  subtitle: string;
  icon: string;
}

const REPORT_ENTRIES: ReportEntry[] = [
  {
    route: 'SalesReport',
    title: 'Ventas',
    subtitle: 'Listado y total por rango de fecha.',
    icon: 'chart-line',
  },
  {
    route: 'AccountsReceivableReport',
    title: 'Cuentas por cobrar',
    subtitle: 'Pendientes, vencidas y top deudores.',
    icon: 'account-cash-outline',
  },
  {
    route: 'ReceiptsReport',
    title: 'Recibos CxC',
    subtitle: 'Recibos de pago por rango y metodo.',
    icon: 'receipt-text-outline',
  },
  {
    route: 'ProfitReport',
    title: 'Ganancia',
    subtitle: 'Estado de resultados por periodo.',
    icon: 'finance',
  },
  {
    route: 'InventoryReport',
    title: 'Inventario',
    subtitle: 'Stock y costo total de inventario.',
    icon: 'package-variant-closed',
  },
  {
    route: 'OperatingExpensesReport',
    title: 'Gastos operativos',
    subtitle: 'Listado y total por rango.',
    icon: 'cash-minus',
  },
];

export function ReportsMenuScreen({ navigation }: ReportsMenuScreenProps) {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Reportes</Text>
          <Text style={styles.pageSubtitle}>Reportes por rango de fecha y estado.</Text>
        </View>

        {REPORT_ENTRIES.map((entry) => (
          <TouchableOpacity key={entry.route} style={styles.card} onPress={() => navigation.navigate(entry.route)}>
            <View style={styles.iconWrap}>
              <Icon source={entry.icon} size={22} color={ui.colors.primary} />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{entry.title}</Text>
              <Text style={styles.cardSubtitle}>{entry.subtitle}</Text>
            </View>
            <Icon source="chevron-right" size={20} color={ui.colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingBottom: 24 },
  pageHeader: { marginBottom: 12 },
  pageTitle: { color: ui.colors.text, fontSize: 28, fontWeight: '800' },
  pageSubtitle: { color: ui.colors.textMuted, marginTop: 2 },
  card: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFE6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardContent: { flex: 1 },
  cardTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '800' },
  cardSubtitle: { color: ui.colors.textMuted, fontSize: 12, marginTop: 3 },
});
