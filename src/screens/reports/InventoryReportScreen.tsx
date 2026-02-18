import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Searchbar, Text, Button } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { ui } from '../../theme/ui';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { parseJsonObject } from './reportUtils';

interface InventoryItem {
  localId: string;
  name: string;
  sku: string;
  supplierName: string;
  stock: number;
  costCents: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildInventoryReportHtml(items: InventoryItem[], query: string, totalInventoryCostCents: number): string {
  const rowsHtml = items
    .map((item) => {
      const totalCostCents = Math.round(item.costCents * item.stock);
      return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.sku)}</td>
          <td>${escapeHtml(item.supplierName)}</td>
          <td>${escapeHtml(item.stock)}</td>
          <td>${escapeHtml(formatCurrency(item.costCents))}</td>
          <td>${escapeHtml(formatCurrency(totalCostCents))}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #111; font-size: 11px; padding: 16px; }
          .title { font-size: 18px; font-weight: 800; margin-bottom: 3px; }
          .muted { color: #666; margin-bottom: 10px; }
          .summary { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
          .summary-row { display: flex; justify-content: space-between; margin: 4px 0; }
          .summary-label { color: #555; }
          .summary-value { font-weight: 700; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="title">Reporte de inventario</div>
        <div class="muted">Generado: ${escapeHtml(formatDateTime(Date.now()))}</div>
        <div class="summary">
          <div class="summary-row"><span class="summary-label">Busqueda aplicada</span><span class="summary-value">${escapeHtml(query.trim() || 'Sin filtro')}</span></div>
          <div class="summary-row"><span class="summary-label">Productos</span><span class="summary-value">${escapeHtml(items.length)}</span></div>
          <div class="summary-row"><span class="summary-label">Total inventario en costo</span><span class="summary-value">${escapeHtml(formatCurrency(totalInventoryCostCents))}</span></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Proveedor</th>
              <th>Stock</th>
              <th>Costo unitario</th>
              <th>Costo total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body>
    </html>
  `;
}

export function InventoryReportScreen() {
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<InventoryItem[]>([]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const products = await db.query<any>(
        `SELECT local_id, name, sku, stock, cost_cents, data
         FROM products
         ORDER BY name ASC`
      );

      const mapped = products
        .map((row) => {
          const parsed = parseJsonObject(row.data);
          const parsedSupplier = (parsed?.supplier as Record<string, unknown>) || null;
          const isActiveValue = parsed?.isActive ?? parsed?.active;
          const isActive = isActiveValue === undefined ? true : Boolean(isActiveValue);

          if (!isActive) return null;

          const supplierName =
            typeof parsedSupplier?.name === 'string' && parsedSupplier.name.trim()
              ? parsedSupplier.name
              : typeof parsed?.supplierName === 'string' && parsed.supplierName.trim()
                ? String(parsed.supplierName)
                : '-';

          return {
            localId: String(row.local_id),
            name: String(row.name || '-'),
            sku: row.sku ? String(row.sku) : '-',
            supplierName,
            stock: Number(row.stock || 0),
            costCents: Number(row.cost_cents || parsed?.costCents || 0),
          } as InventoryItem;
        })
        .filter((item): item is InventoryItem => Boolean(item));

      setRows(mapped);
    } catch (error) {
      console.error('Error cargando reporte de inventario:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadReport();
    }, [loadReport])
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.supplierName.toLowerCase().includes(q)
    );
  }, [query, rows]);

  const totalInventoryCostCents = filteredRows.reduce(
    (sum, item) => sum + Math.round(item.costCents * item.stock),
    0
  );

  const handleExportPdf = useCallback(async () => {
    if (filteredRows.length === 0) {
      Alert.alert('Exportacion', 'No hay productos para exportar.');
      return;
    }

    setExporting(true);
    try {
      const html = buildInventoryReportHtml(filteredRows, query, totalInventoryCostCents);
      const pdf = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exportar reporte de inventario',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ html });
      }
    } catch (error) {
      console.error('Error exportando reporte de inventario:', error);
      Alert.alert('Exportacion', 'No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  }, [filteredRows, query, totalInventoryCostCents]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Reporte de inventario</Text>
          <Text style={styles.subtitle}>Productos activos con costo y stock actual.</Text>
          <Button
            mode="outlined"
            style={styles.exportButton}
            textColor={ui.colors.primary}
            onPress={handleExportPdf}
            disabled={loading || exporting || filteredRows.length === 0}
            loading={exporting}
          >
            Exportar PDF
          </Button>
        </View>

        <Searchbar
          placeholder="Buscar por producto, SKU o proveedor"
          value={query}
          onChangeText={setQuery}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
          placeholderTextColor="#B8B2C8"
        />

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total inventario en costo</Text>
          <Text style={styles.summaryValue}>{formatCurrency(totalInventoryCostCents)}</Text>
          <Text style={styles.summaryHint}>{filteredRows.length} productos</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Productos</Text>

          {loading ? <Text style={styles.emptyText}>Cargando...</Text> : null}
          {!loading && filteredRows.length === 0 ? <Text style={styles.emptyText}>No hay productos activos.</Text> : null}

          {!loading
            ? filteredRows.map((item) => {
                const totalCostCents = Math.round(item.costCents * item.stock);
                return (
                  <View key={item.localId} style={styles.productRow}>
                    <View style={styles.leftCol}>
                      <Text style={styles.productName}>{item.name}</Text>
                      <Text style={styles.metaText}>SKU: {item.sku}</Text>
                      <Text style={styles.metaText}>Proveedor: {item.supplierName}</Text>
                      <Text style={styles.metaText}>Stock: {item.stock}</Text>
                    </View>
                    <View style={styles.rightCol}>
                      <Text style={styles.costText}>Costo unit.: {formatCurrency(item.costCents)}</Text>
                      <Text style={styles.totalCostText}>{formatCurrency(totalCostCents)}</Text>
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
  exportButton: { marginTop: 10, alignSelf: 'flex-start' },
  searchbar: {
    marginBottom: 10,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    elevation: 0,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  searchInput: { minHeight: 40 },
  summaryCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
    marginBottom: 10,
  },
  summaryLabel: { color: ui.colors.textMuted, fontSize: 13 },
  summaryValue: { color: ui.colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
  summaryHint: { color: ui.colors.textMuted, marginTop: 2 },
  card: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
  },
  cardTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  productRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftCol: { flex: 1, marginRight: 8 },
  rightCol: { alignItems: 'flex-end' },
  productName: { color: ui.colors.text, fontWeight: '800' },
  metaText: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  costText: { color: ui.colors.textMuted, fontSize: 12 },
  totalCostText: { color: ui.colors.text, fontWeight: '800', marginTop: 4 },
  emptyText: { color: ui.colors.textMuted, textAlign: 'center', paddingVertical: 8 },
});
