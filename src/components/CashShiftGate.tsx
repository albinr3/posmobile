import React, { useCallback, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Button, Text, TextInput } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SafeAreaView } from './SafeAreaView';
import { assertOwnOpenShift, getCashContext, isCashShiftFrozen, openCashShift, type CashContext } from '../services/cash/cashShiftService';
import { formatCurrency } from '../utils/helpers';
import { ui } from '../theme/ui';

export function CashShiftGate({ showActivationOffer = false }: { showActivationOffer?: boolean }) {
  const navigation = useNavigation<any>();
  const [focused, setFocused] = useState(false);
  const [context, setContext] = useState<CashContext | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [offer, setOffer] = useState(false);
  const refresh = useCallback(async () => {
    setChecking(true);
    setOffer(false);
    setAllowed(false);
    try {
      const next = await getCashContext();
      setContext(next);
      if (!next.enabled) {
        if (showActivationOffer && next.isOwner && next.canManage) {
          const dismissed = await AsyncStorage.getItem(`cash_shift_offer_v1:${next.accountId}`).catch(() => 'unavailable');
          setOffer(!dismissed);
        }
        setAllowed(true); setError(''); return;
      }
      assertOwnOpenShift(next);
      if (next.activeShift && await isCashShiftFrozen(next.activeShift.id)) throw new Error('El cierre está en preparación. Reanuda el turno desde Cuadre diario.');
      setAllowed(true); setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprobar el turno de caja.');
    } finally {
      setChecking(false);
    }
  }, [showActivationOffer]);
  useFocusEffect(useCallback(() => { setFocused(true); void refresh(); return () => setFocused(false); }, [refresh]));
  const expected = context?.expectedOpeningCents;
  const normalized = counted.replace(',', '.').trim();
  const amount = /^\d+(?:\.\d{0,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : NaN;
  const difference = expected != null && Number.isFinite(amount) ? amount - expected : null;
  const canOpen = context?.enabled && context.canOperate && !context.activeShift && Number.isSafeInteger(amount) && amount >= 0 && amount <= 2147483647 && (difference === 0 || !!note.trim());
  const chooseOffer = async (activate: boolean) => {
    if (!context || busy) return;
    setBusy(true); setError('');
    try {
      await AsyncStorage.setItem(`cash_shift_offer_v1:${context.accountId}`, 'seen');
      setOffer(false);
      if (activate) navigation.navigate('DailyCloseMenu', { screen: 'DailyClose' });
    } catch {
      setError('No se pudo guardar tu elección. Inténtalo de nuevo.');
    } finally { setBusy(false); }
  };
  return <>
  <Modal visible={focused && !checking && offer} transparent animationType="fade" onRequestClose={() => {}}>
    <ScrollView contentContainerStyle={styles.overlay}>
      <View style={styles.offerCard}>
        <View style={styles.illustration}>
          <Svg width={150} height={120} viewBox="0 0 150 120" accessibilityLabel="Ilustración de una caja registradora y dinero">
            <Circle cx="75" cy="59" r="55" fill="#EEE5FF" />
            <Rect x="40" y="49" width="70" height="48" rx="9" fill="#7F13EC" />
            <Rect x="51" y="24" width="48" height="33" rx="5" fill="#A56CFF" />
            <Rect x="57" y="30" width="36" height="17" rx="3" fill="#FFF" />
            <Rect x="48" y="68" width="54" height="20" rx="4" fill="#FFF" />
            <Path d="M66 78h18" stroke="#7F13EC" strokeWidth="4" strokeLinecap="round" />
            <Circle cx="111" cy="36" r="15" fill="#1FA464" />
            <Path d="m104 36 5 5 9-10" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx="36" cy="34" r="14" fill="#E9A820" />
            <Path d="M40 29.5c-1-1-2.3-1.5-4-1.5-2.2 0-3.5 1.1-3.5 2.8 0 4.2 7 1.8 7 5.8 0 1.7-1.5 2.9-3.8 2.9-1.7 0-3.3-.6-4.4-1.7M36 25.5v16" fill="none" stroke="#FFF" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
        <Text variant="headlineSmall" style={styles.offerTitle}>¿Tienes empleados y manejas varios turnos de caja?</Text>
        <Text style={styles.offerText}>Activa esta opción para que cada empleado abra y cierre su propio turno. Así podrás llevar un mejor control del efectivo y de los movimientos de cada turno.</Text>
        <Text style={styles.offerHint}>Para activarlo, revisarás los saldos y confirmarás el efectivo inicial en Cuadre diario. La activación es permanente.</Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button mode="contained" disabled={busy} loading={busy} onPress={() => void chooseOffer(true)} style={styles.offerButton}>Activar control por turnos</Button>
        <Button mode="text" disabled={busy} onPress={() => void chooseOffer(false)}>Descartar y no volver a mostrar</Button>
      </View>
    </ScrollView>
  </Modal>
  <Modal visible={focused && !checking && !allowed} animationType="fade" onRequestClose={() => {}}>
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
  </Modal></>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.colors.background }, content: { padding: 22, gap: 15 },
  form: { gap: 12, paddingVertical: 12 }, error: { color: '#B91C1C' }, good: { color: '#15803D' },
  overlay: { flexGrow: 1, backgroundColor: 'rgba(30, 22, 48, 0.55)', justifyContent: 'center', padding: 22 },
  offerCard: { backgroundColor: ui.colors.surface, borderRadius: 24, padding: 24, gap: 12, alignItems: 'stretch', maxWidth: 440, width: '100%', alignSelf: 'center' },
  illustration: { alignItems: 'center' }, offerTitle: { color: ui.colors.text, fontWeight: '700', textAlign: 'center' },
  offerText: { color: ui.colors.text, textAlign: 'center', lineHeight: 21 },
  offerHint: { color: ui.colors.textMuted, textAlign: 'center', lineHeight: 19 }, offerButton: { marginTop: 4 },
});
