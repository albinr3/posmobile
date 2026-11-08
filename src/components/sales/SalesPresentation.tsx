import React from 'react';
import { type StyleProp, type TextStyle, View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';

// Piezas de presentación compartidas: no conocen SQLite, stock, caja ni sincronización.
export function SalePrice({ cents, style }: { cents: number; style?: StyleProp<TextStyle> }) {
  return <Text style={style}>{formatCurrency(cents)}</Text>;
}
export function SaleSummaryRow({ label, cents, total = false }: { label: string; cents: number; total?: boolean }) {
  return <View style={styles.row}><Text style={[styles.label, total && styles.total]}>{label}</Text><SalePrice cents={cents} style={[styles.label, total && styles.total]} /></View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 }, label: { fontSize: 14, color: ui.colors.textMuted }, total: { fontSize: 22, fontWeight: '800', color: ui.colors.text } });
