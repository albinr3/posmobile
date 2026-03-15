import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Text, TextInput } from 'react-native-paper';

import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';
import { formatCurrency } from '../../utils/helpers';
import { parseJsonObject, rangeToTimestamps, toTimestamp, toYmd } from './reportUtils';

interface OperatingExpenseReportRow {
  localId: string;
  description: string;
  category: string | null;
  amountCents: number;
  expenseDate: number;
  registeredBy: string;
}

function resolveRegisteredBy(parsed: Record<string, unknown> | null): string {
  const user = parsed?.user && typeof parsed.user === 'object' ? (parsed.user as Record<string, unknown>) : null;
  const byName = user?.name;
  const byUsername = user?.username;
  const createdByName = parsed?.createdByName;
  const createdByUsername = parsed?.createdByUsername;

  if (typeof byName === 'string' && byName.trim()) return byName.trim();
  if (typeof byUsername === 'string' && byUsername.trim()) return byUsername.trim();
  if (typeof createdByName === 'string' && createdByName.trim()) return createdByName.trim();
  if (typeof createdByUsername === 'string' && createdByUsername.trim()) return createdByUsername.trim();
  return '—';
}

function formatExpenseDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return date.toLocaleDateString('es-DO');
}

export function OperatingExpensesReportScreen() {
  const today = useMemo(() => toYmd(new Date()), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OperatingExpenseReportRow[]>([]);

  const loadReport = useCallback(async (fromYmd: string, toYmd: string) => {
    const { fromTs, toTs } = rangeToTimestamps(fromYmd, toYmd);
    setLoading(true);

    try {
      const expenseRows = await db.query<any>(
        `SELECT local_id, description, amount_cents, expense_date, category, data
         FROM operating_expenses
         ORDER BY expense_date DESC, rowid DESC`
      );

      const mapped: OperatingExpenseReportRow[] = [];

      for (const row of expenseRows) {
        const parsed = parseJsonObject(row.data);
        const expenseDate =
          toTimestamp(row.expense_date) ??
          toTimestamp(parsed?.expenseDate) ??
          Date.now();

        if (expenseDate < fromTs || expenseDate > toTs) continue;

        mapped.push({
          localId: String(row.local_id || ''),
          description: String(row.description || parsed?.description || '-'),
          category:
            (typeof row.category === 'string' && row.category.trim()) ||
            (typeof parsed?.category === 'string' && parsed.category.trim())
              ? String(row.category || parsed?.category).trim()
              : null,
          amountCents: Number(row.amount_cents || parsed?.amountCents || 0),
          expenseDate,
          registeredBy: resolveRegisteredBy(parsed),
        });
      }

      setRows(mapped);
    } catch (error) {
      console.error('Error cargando reporte de gastos operativos:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReport(from, to);
    }, [from, to, loadReport])
  );

  const totalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Reporte de gastos operativos</Text>
          <Text style={styles.subtitle}>Listado y total por rango.</Text>
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
            <Button mode="contained" style={styles.halfBtn} buttonColor={ui.colors.primary} onPress={() => loadReport(from, to)}>
              Aplicar
            </Button>
            <Button
              mode="outlined"
              style={styles.halfBtn}
              textColor={ui.colors.primary}
              onPress={() => {
                const now = toYmd(new Date());
                setFrom(now);
                setTo(now);
                loadReport(now, now);
              }}
            >
              Hoy
            </Button>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{formatCurrency(totalCents)}</Text>
          <Text style={styles.summaryHint}>{rows.length} gastos</Text>
        </View>

        <View style={styles.listCard}>
          <Text style={styles.listTitle}>Gastos</Text>

          {loading ? <Text style={styles.emptyText}>Cargando...</Text> : null}
          {!loading && rows.length === 0 ? <Text style={styles.emptyText}>Sin gastos operativos en el rango.</Text> : null}

          {!loading
            ? rows.map((row) => (
                <View key={row.localId} style={styles.itemRow}>
                  <View style={styles.itemLeft}>
                    <Text style={styles.itemDescription}>{row.description}</Text>
                    <Text style={styles.itemMeta}>Fecha: {formatExpenseDate(row.expenseDate)}</Text>
                    <Text style={styles.itemMeta}>Categoría: {row.category || '—'}</Text>
                    <Text style={styles.itemMeta}>Registrado por: {row.registeredBy}</Text>
                  </View>
                  <View style={styles.itemRight}>
                    <Text style={styles.itemAmount}>{formatCurrency(row.amountCents)}</Text>
                  </View>
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
  filtersCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  halfBtn: { flex: 1 },
  summaryCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
  },
  summaryLabel: { color: ui.colors.textMuted, fontSize: 13 },
  summaryValue: { color: ui.colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
  summaryHint: { color: ui.colors.textMuted, marginTop: 2 },
  listCard: {
    marginTop: 10,
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
  },
  listTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  itemRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  itemLeft: { flex: 1 },
  itemRight: { alignItems: 'flex-end' },
  itemDescription: { color: ui.colors.text, fontWeight: '800' },
  itemMeta: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  itemAmount: { color: ui.colors.text, fontSize: 16, fontWeight: '800' },
  emptyText: { color: ui.colors.textMuted, paddingVertical: 8, textAlign: 'center' },
});
