import React, { useCallback, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from './SafeAreaView';
import { assertOwnOpenShift, getCashContext, isCashShiftFrozen, openCashShift, type CashContext } from '../services/cash/cashShiftService';
import { formatCurrency } from '../utils/helpers';
import { ui } from '../theme/ui';

export function CashShiftGate() {
  const navigation = useNavigation<any>();
  const [focused, setFocused] = useState(false);
  const [context, setContext] = useState<CashContext | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setAllowed(false);
    try {
      const next = await getCashContext();
      setContext(next);
      if (!next.enabled) { setAllowed(true); setError(''); return; }
      assertOwnOpenShift(next);
      if (next.activeShift && await isCashShiftFrozen(next.activeShift.id)) throw new Error('El cierre está en preparación. Reanuda el turno desde Cuadre diario.');
      setAllowed(true); setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprobar el turno de caja.');
    }
  }, []);
  useFocusEffect(useCallback(() => { setFocused(true); void refresh(); return () => setFocused(false); }, [refresh]));
  const expected = context?.expectedOpeningCents;
  const normalized = counted.replace(',', '.').trim();
  const amount = /^\d+(?:\.\d{0,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : NaN;
  const difference = expected != null && Number.isFinite(amount) ? amount - expected : null;
  const canOpen = context?.enabled && context.canOperate && !context.activeShift && Number.isSafeInteger(amount) && amount >= 0 && amount <= 2147483647 && (difference === 0 || !!note.trim());
  return <Modal visible={focused && !allowed} animationType="fade" onRequestClose={() => {}}>
    <SafeAreaView style={styles.root} edges={['bottom']}><ScrollView contentContainerStyle={styles.content}>
      <Text variant="headlineSmall">Turno de caja</Text>
      <Text>Antes de facturar o cobrar, confirma la caja desde este dispositivo.</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {context?.enabled && !context.activeShift && context.canOperate && <View style={styles.form}>
        <Text>Efectivo esperado: {expected == null ? 'No disponible' : formatCurrency(expected)}</Text>
        <TextInput mode="outlined" label="Efectivo que recibes" keyboardType="decimal-pad" value={counted} onChangeText={setCounted} />
        {difference != null && <Text style={difference === 0 ? styles.good : styles.error}>{difference === 0 ? 'El conteo coincide.' : `${difference > 0 ? 'Sobrante' : 'Faltante'}: ${formatCurrency(Math.abs(difference))}`}</Text>}
        <TextInput mode="outlined" label="Motivo de diferencia" value={note} onChangeText={setNote} />
        <Button mode="contained" disabled={busy || !canOpen} onPress={() => { setBusy(true); void openCashShift(amount, note).then(() => { setCounted(''); setNote(''); return refresh(); }).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo abrir el turno.')).finally(() => setBusy(false)); }}>Abrir mi turno</Button>
      </View>}
      <Button mode="outlined" disabled={busy} onPress={() => void refresh()}>Actualizar caja</Button>
      {context?.enabled && <Button mode="text" onPress={() => navigation.navigate('DailyCloseMenu', { screen: 'DailyClose' })}>Ir a Cuadre diario</Button>}
    </ScrollView></SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.colors.background }, content: { padding: 22, gap: 15 },
  form: { gap: 12, paddingVertical: 12 }, error: { color: '#B91C1C' }, good: { color: '#15803D' },
});
