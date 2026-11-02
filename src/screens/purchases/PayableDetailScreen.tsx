import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Menu, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { PendingFinancialOperations } from '../../components/PendingFinancialOperations';
import { FinancialApiError, paymentAccounts, parseAmountCents, purchaseCreditService, validDateOnly, type PayableDetail, type PaymentMethod, type PaymentOptions } from '../../services/purchases/purchaseCreditService';
import { syncService } from '../../services/sync/SyncService';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { ui } from '../../theme/ui';

export function PayableDetailScreen({ navigation, route }: { navigation: any; route: any }) {
  const payableId = String(route?.params?.payableId || '');
  const [detail, setDetail] = useState<PayableDetail | null>(null);
  const [options, setOptions] = useState<PaymentOptions>({ methods: [], accounts: [] });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [methodMenu, setMethodMenu] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [pendingVersion, setPendingVersion] = useState(0);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const busyRef = useRef(false);
  const requestVersion = useRef(0);
  const isOnline = useSyncStore(state => state.isOnline);
  const canPay = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canRegisterSupplierPayments === true);
  const canCancel = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canCancelSupplierPayments === true);
  const canEdit = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canManagePurchases === true);
  const canSeeCashHistory = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canOperateCashShifts === true || state.subUser?.canViewAllCashShifts === true || state.subUser?.canManageCashShifts === true);
  const accounts = paymentAccounts(options, method);
  const selectedAccount = accounts.find(account => account.id === accountId) || accounts[0] || null;

  const load = useCallback(async (): Promise<boolean> => {
    const version = ++requestVersion.current;
    if (!isOnline) { setDetail(null); setError('Conéctate para consultar el saldo actual.'); return false; }
    try {
      const [nextDetail, nextOptions] = await Promise.all([purchaseCreditService.getPayable(payableId), purchaseCreditService.paymentOptions()]);
      if (version === requestVersion.current) { setDetail(nextDetail); setOptions(nextOptions); setDueDate(nextDetail.dueDate); setNotes(nextDetail.purchase.notes || ''); setError(''); setErrorCode(''); }
      return version === requestVersion.current;
    } catch (cause) { if (version === requestVersion.current) { setDetail(null); setError(cause instanceof Error ? cause.message : 'No se pudo cargar la cuenta.'); } return false; }
  }, [isOnline, payableId]);
  useFocusEffect(useCallback(() => { void load(); return () => { requestVersion.current += 1; }; }, [load]));

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setErrorCode('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.'); setErrorCode(cause instanceof FinancialApiError ? cause.code || '' : ''); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const reconcile = () => void run(async () => {
    const actor = useAuthStore.getState();
    const pending = await syncService.listOnlineFinancialPending();
    if (pending.some(row => row.account_id === actor.accountId && row.user_id === actor.subUser?.id)) throw new Error('Reintenta o resuelve la operación pendiente antes de registrar otro pago.');
    if (!await load()) throw new Error('No se pudo actualizar el saldo. Reintenta antes de registrar otro pago.');
    setAmount(''); setNote(''); setNeedsReconciliation(false);
  });
  const pay = () => void run(async () => {
    if (!detail || !isOnline) throw new Error('Conéctate para registrar el pago.');
    if (needsReconciliation) throw new Error('Actualiza el saldo y resuelve la confirmación anterior antes de pagar de nuevo.');
    const amountCents = parseAmountCents(amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > detail.balanceCents) throw new Error('Introduce un pago mayor que cero y menor o igual al saldo.');
    if (!selectedAccount) throw new Error('Selecciona una cuenta de pago en DOP.');
    const outcome = await purchaseCreditService.createSupplierPayment({ apId: detail.id, amountCents, method, treasuryAccountId: selectedAccount.id, note: note.trim() });
    setPendingVersion(value => value + 1);
    setNeedsReconciliation(true);
    if (!outcome.confirmed) { Alert.alert(outcome.rejected ? 'Pago rechazado' : 'Confirmación pendiente', outcome.error || 'Reintenta el mismo pago antes de registrar otro.'); return; }
    setDetail(null);
    if (await load()) { setAmount(''); setNote(''); setNeedsReconciliation(false); }
    Alert.alert('Pago registrado', 'El servidor confirmó el pago. Consulta el saldo actualizado antes de registrar otro.');
  });
  const saveMetadata = () => void run(async () => {
    if (!detail || !isOnline) throw new Error('Conéctate para editar la compra.');
    if (!validDateOnly(dueDate)) throw new Error('Introduce un vencimiento válido YYYY-MM-DD.');
    await purchaseCreditService.patchPurchase(detail.purchaseId, { dueDate, notes: notes.trim() || null });
    await load();
    Alert.alert('Guardado', 'Notas y vencimiento actualizados.');
  });
  const cancelPayment = (id: string) => void run(async () => {
    if (!cancelReason.trim()) throw new Error('Escribe el motivo de anulación.');
    await purchaseCreditService.cancelPayment(id, cancelReason);
    setCancelId(null); setCancelReason('');
    await load();
    Alert.alert('Pago anulado', 'El saldo pendiente se restauró.');
  });

  return <SafeAreaView style={{ flex: 1, backgroundColor: ui.colors.background }} edges={['bottom']}>
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 36 }}>
      <Text variant="headlineSmall">Cuenta por pagar</Text>
      <PendingFinancialOperations key={pendingVersion} kind="supplier_payment" onConfirmed={reconcile} />
      {needsReconciliation && <Button mode="outlined" disabled={busy} onPress={reconcile}>Actualizar saldo y confirmación</Button>}
      {!!error && <Text style={{ color: ui.colors.danger }}>{error}</Text>}
      {!detail ? <Button mode="outlined" onPress={() => void load()}>Cargar cuenta</Button> : <>
        <Card style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text variant="titleLarge">{detail.purchase.supplierName || detail.supplier.name}</Text>
          <Text>Compra {detail.purchaseId.slice(-8)} · Vence {detail.dueDate}</Text>
          {detail.overdue && <Text style={{ color: ui.colors.danger }}>{detail.overdueDays} días de atraso</Text>}
          <Text>Estado: {detail.status}{detail.purchase.cancelledAt ? ' · Compra anulada' : ''}</Text>
          <Text>Total: {formatCurrency(detail.totalCents)}</Text>
          <Text>Abonado: {formatCurrency(detail.paidCents)}</Text>
          <Text variant="titleMedium">Pendiente: {formatCurrency(detail.balanceCents)}</Text>
        </Card.Content></Card>
        {canEdit && !detail.purchase.cancelledAt && <Card style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text variant="titleMedium">Notas y vencimiento</Text>
          <TextInput label="Vencimiento YYYY-MM-DD" mode="outlined" value={dueDate} onChangeText={setDueDate} style={{ marginTop: 8 }} />
          <TextInput label="Notas de la compra" mode="outlined" value={notes} onChangeText={setNotes} style={{ marginTop: 8 }} />
          <Button mode="outlined" disabled={busy} onPress={saveMetadata}>Guardar</Button>
        </Card.Content></Card>}
        {canPay && detail.balanceCents > 0 && !detail.purchase.cancelledAt && <Card style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text variant="titleMedium">Registrar pago</Text>
          <TextInput label="Monto RD$" mode="outlined" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} style={{ marginTop: 8 }} />
          <Button compact onPress={() => setAmount((detail.balanceCents / 100).toFixed(2))}>Liquidar saldo</Button>
          <Menu visible={methodMenu} onDismiss={() => setMethodMenu(false)} anchor={<Button mode="outlined" onPress={() => setMethodMenu(true)}>Método: {method}</Button>}>
            {options.methods.map(value => <Menu.Item key={value} title={value} onPress={() => { setMethod(value); setAccountId(''); setMethodMenu(false); }} />)}
          </Menu>
          <Menu visible={accountMenu} onDismiss={() => setAccountMenu(false)} anchor={<Button mode="outlined" onPress={() => setAccountMenu(true)}>Cuenta: {selectedAccount?.name || 'Seleccionar'}</Button>}>
            {accounts.map(account => <Menu.Item key={account.id} title={account.name} onPress={() => { setAccountId(account.id); setAccountMenu(false); }} />)}
          </Menu>
          <TextInput label="Nota del pago (opcional)" mode="outlined" value={note} onChangeText={setNote} style={{ marginTop: 8 }} />
          <Button mode="contained" disabled={busy || needsReconciliation || !selectedAccount} loading={busy} onPress={pay}>Registrar pago</Button>
        </Card.Content></Card>}
        <Text variant="titleMedium">Historial de pagos</Text>
        {!detail.payments.length && <Text>Sin pagos registrados.</Text>}
        {detail.payments.map(payment => <Card key={payment.id} style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text variant="titleMedium">{formatCurrency(payment.amountCents)} · {payment.method}</Text>
          <Text>{payment.treasuryAccount.name} · {payment.user.name}</Text>
          <Text>{formatDateTime(new Date(payment.paidAt).getTime())}</Text>
          <Text>Referencia: {payment.reference}</Text>
          {!!payment.note && <Text>{payment.note}</Text>}
          {!!payment.cancelledAt && <Text style={{ color: ui.colors.danger }}>Anulado: {payment.cancellationReason || 'Sin motivo'}</Text>}
          {canCancel && !payment.cancelledAt && <>
            {cancelId === payment.id && <TextInput mode="outlined" label="Motivo de anulación" value={cancelReason} onChangeText={setCancelReason} style={{ marginTop: 8 }} />}
            <Button mode="outlined" disabled={busy} onPress={() => { if (cancelId !== payment.id) { setCancelId(payment.id); setCancelReason(''); } else cancelPayment(payment.id); }}>Anular pago</Button>
          </>}
        </Card.Content></Card>)}
        {errorCode === 'CASH_DOCUMENT_CLOSED' && (canSeeCashHistory
          ? <Button mode="outlined" onPress={() => navigation.navigate('DailyCloseMenu', { screen: 'DailyClose' })}>Corregir desde Cuadre diario</Button>
          : <Text>Solicita la corrección al responsable de caja.</Text>)}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
