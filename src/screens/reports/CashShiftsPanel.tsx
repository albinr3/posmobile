import React, { useCallback, useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Checkbox, Text, TextInput } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import axios from 'axios';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { printCashShiftTextDirect } from '../../services/printing/thermalPrinterService';
import { API_URL } from '../../services/sync/syncShared';
import {
  cashApiGet, cashApiPost, cashHeaders, cashPending, cancelPendingCashMovement, discardCashPending, freezeCashShift,
  getCashContext, getCashReport, isCashShiftFrozen, legacyCashPending, oldestPendingCashMovement, openCashShift, pendingCashMovement,
  sendCashMovement, unfreezeCashShift, type CashContext, type CashHistoryRow, type CashQueueRow,
} from '../../services/cash/cashShiftService';

type Preview = { previewToken: string; future: number; unclassified: number; accounts: Array<{ id: string; name: string; type: string; currency: string; isActive: boolean; balanceCents: number }> };
type Account = { id: string; name: string; type: string; currency: string; isActive: boolean };
const HISTORY_PAGE_SIZE = 10;
const money = (value: number | null | undefined) => value == null ? 'No disponible' : formatCurrency(value);
const cents = (value: string) => {
  const normalized = value.replace(',', '.').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
};
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString('es-DO') : 'No disponible';
const sourceName = (value: string) => ({ sale: 'Venta', payment: 'Abono', payment_batch: 'Abono múltiple', purchase: 'Compra', credit_purchase: 'Compra a crédito', supplier_payment: 'Pago a proveedor', supplierPayment: 'Pago a proveedor', operatingExpense: 'Gasto', operating_expense: 'Gasto', return: 'Devolución', treasuryTransfer: 'Traspaso', treasury_transfer: 'Traspaso', OWNER_IN: 'Aporte del dueño', OWNER_OUT: 'Retiro del dueño' } as Record<string, string>)[value] || value;

function Action({ children, onPress, disabled = false, secondary = false }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Button mode={secondary ? 'outlined' : 'contained'} disabled={disabled} onPress={onPress} style={styles.action}>{children}</Button>;
}
function Amount({ label, value, onChangeText }: { label: string; value: string; onChangeText: (text: string) => void }) {
  return <TextInput mode="outlined" label={label} keyboardType="decimal-pad" value={value} onChangeText={onChangeText} style={styles.input} />;
}
function Difference({ expected, counted }: { expected: number | null | undefined; counted: string }) {
  const amount = cents(counted);
  if (expected == null || !Number.isFinite(amount)) return null;
  const delta = amount - expected;
  return <Text style={delta === 0 ? styles.good : styles.warning}>{delta === 0 ? 'El conteo coincide.' : `${delta > 0 ? 'Sobrante' : 'Faltante'}: ${money(Math.abs(delta))}`}</Text>;
}
function Rows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return <>{rows.map((row, index) => <View key={`${row.label}:${index}`} style={styles.row}><Text style={styles.rowLabel}>{row.label}</Text><Text style={styles.rowValue}>{row.value}</Text></View>)}</>;
}

export function CashShiftsPanel() {
  const [context, setContext] = useState<CashContext | null>(null);
  const [pending, setPending] = useState<CashQueueRow[]>([]);
  const [history, setHistory] = useState<CashHistoryRow[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [selected, setSelected] = useState<CashHistoryRow | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accountId, setAccountId] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [movementKind, setMovementKind] = useState('TRANSFER_OUT');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementAccount, setMovementAccount] = useState('');
  const [movementNote, setMovementNote] = useState('');
  const [manualPending, setManualPending] = useState<Awaited<ReturnType<typeof pendingCashMovement>>>(null);
  const [manualCancelReason, setManualCancelReason] = useState('');
  const [discardRow, setDiscardRow] = useState<CashQueueRow | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [correction, setCorrection] = useState<{ sourceType: string; sourceId: string } | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [moneyMoved, setMoneyMoved] = useState(true);
  const [lastClosedId, setLastClosedId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const next = await getCashContext();
    setContext(next);
    setClosing(Boolean(next.activeShift?.isMine && next.activeShift.isDevice && (next.activeShift.status === 'CLOSING' || await isCashShiftFrozen(next.activeShift.id))));
    setMovementKind(current => !next.canTransfer && current.startsWith('TRANSFER') ? 'OWNER_IN' : !next.canRecordMovements && current.startsWith('OWNER') ? 'TRANSFER_OUT' : current);
    setPending(await cashPending());
    setManualPending(await oldestPendingCashMovement(next.accountId, next.activeShift?.id));
    if ((next.canOperate || next.canViewAll || next.canManage) && useSyncStore.getState().isOnline) {
      const rows = await cashApiGet<CashHistoryRow[]>(`history&limit=${HISTORY_PAGE_SIZE + 1}`);
      setHistory(rows.slice(0, HISTORY_PAGE_SIZE)); setHasMoreHistory(rows.length > HISTORY_PAGE_SIZE);
      setSelected(current => current ? rows.find(row => row.id === current.id) ?? current : null);
    } else if (!next.canOperate && !next.canViewAll && !next.canManage) { setHistory([]); setHasMoreHistory(false); }
    if (next.enabled && next.canTransfer && useSyncStore.getState().isOnline) {
      const headers = await cashHeaders();
      const all: Account[] = [];
      let skip = 0;
      for (;;) {
        const response = await axios.get(`${API_URL}/api/treasury/accounts`, { params: { skip, take: 200 }, headers, timeout: 20000 });
        const page = Array.isArray(response.data) ? response.data : response.data?.data ?? response.data?.accounts ?? [];
        all.push(...page);
        const nextSkip = response.data?.nextSkip;
        if (nextSkip == null) break;
        if (!Number.isSafeInteger(nextSkip) || nextSkip <= skip) throw new Error('La lista de cuentas devolvió una página inválida.');
        skip = nextSkip;
      }
      setAccounts(all);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void refresh().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo consultar la caja.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]));
  async function run(work: () => Promise<void>, refreshAfter = true) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción.'); }
    if (refreshAfter) try { await refresh(); } catch (cause) { setError(current => current || (cause instanceof Error ? cause.message : 'No se pudo actualizar la caja.')); }
    setBusy(false);
  }
  const shift = context?.activeShift;
  const owns = Boolean(shift?.isMine && shift.isDevice);
  const expected = shift ? shift.expectedCashCents : context?.expectedOpeningCents;
  const countedCents = cents(counted);
  const needsReason = Number.isFinite(countedCents) && expected != null && countedCents !== expected;
  const validCount = Number.isSafeInteger(countedCents) && countedCents >= 0 && countedCents <= 2147483647 && (!needsReason || !!note.trim());
  const activationExpected = preview?.accounts.find(account => account.id === accountId)?.balanceCents;
  const validActivationCount = Number.isSafeInteger(countedCents) && countedCents >= 0 && countedCents <= 2147483647 && activationExpected != null && (countedCents === activationExpected || !!note.trim());
  const currentPending = pending.filter(row => row.cash_shift_id === shift?.id && row.status !== 'synced');

  async function activate() {
    if (!preview || !context || !accountId || !validActivationCount) throw new Error('Completa el conteo y explica cualquier diferencia.');
    if ((await legacyCashPending()).length || (await cashPending()).length) throw new Error('Resuelve todas las operaciones pendientes de este dispositivo antes de activar.');
    try { await cashApiPost({ action: 'activate', treasuryAccountId: accountId, countedCents, note, previewToken: preview.previewToken }); }
    catch (cause) { const recovered = await getCashContext(true).catch(() => null); if (!recovered?.enabled) throw cause; }
    setPreview(null); setCounted(''); setNote('');
    await getCashContext(true);
  }
  async function prepare() {
    if (!context || !shift) return;
    const finalSequence = await freezeCashShift(context);
    try { await cashApiPost({ action: 'prepare', shiftId: shift.id, finalSequence }); }
    catch (cause) {
      const recovered = await getCashContext(true).catch(() => null);
      // Si se perdió también la consulta de recuperación, conservar el candado local.
      // El servidor pudo haber fijado finalSequence; reintentar prepare es idempotente.
      if (!recovered) throw new Error('No se pudo confirmar la preparación. Conéctate y vuelve a consultar o preparar el turno.');
      if (recovered.activeShift?.status !== 'CLOSING') { await unfreezeCashShift(shift.id); throw cause; }
    }
    setClosing(true); setCounted(''); setNote('');
    await syncService.flushCashShiftQueue(shift.id);
    await getCashContext(true);
  }
  async function close(emergency = false) {
    if (!shift || !validCount) throw new Error('Escribe el efectivo contado y explica cualquier diferencia.');
    if (emergency && !note.trim()) throw new Error('Indica el motivo del cierre excepcional y qué ocurrió con los pendientes.');
    if (!emergency) {
      await syncService.flushCashShiftQueue(shift.id);
      const actual = await getCashContext(true);
      if (actual.activeShift?.lastSequence !== actual.activeShift?.finalSequence) throw new Error('Faltan operaciones por confirmar antes de cerrar.');
      if (actual.activeShift?.expectedCashCents !== shift.expectedCashCents) throw new Error('El efectivo esperado cambió. Revísalo y vuelve a contar.');
    }
    try { await cashApiPost({ action: emergency ? 'emergency' : 'close', shiftId: shift.id, countedCents, expectedCents: shift.expectedCashCents, note }); }
    catch (cause) {
      const receipt = await cashApiGet<CashHistoryRow>(`receipt&shiftId=${encodeURIComponent(shift.id)}`).catch(() => null);
      if (!receipt || receipt.status !== 'CLOSED') throw cause;
    }
    setLastClosedId(shift.id); setClosing(false); setCounted(''); setNote('');
  }
  async function resume() {
    if (!shift) return;
    const actual = await getCashContext(true);
    if (actual.activeShift?.id !== shift.id || !actual.activeShift.isMine || !actual.activeShift.isDevice) throw new Error('El turno cambió. Actualiza la caja.');
    try { if (actual.activeShift.status === 'CLOSING') await cashApiPost({ action: 'resume', shiftId: shift.id }); }
    catch (cause) {
      const recovered = await getCashContext(true).catch(() => null);
      // Una respuesta perdida puede haber reabierto el turno. Liberar el candado
      // local solo cuando el servidor confirma OPEN.
      if (recovered?.activeShift?.id !== shift.id || recovered.activeShift.status !== 'OPEN') throw cause;
    }
    await unfreezeCashShift(shift.id);
    setClosing(false); setCounted(''); setNote('');
  }
  async function movement(input?: NonNullable<typeof manualPending>['input']) {
    if (!shift || !context) return;
    const body = input ?? { shiftId: shift.id, kind: movementKind, amountCents: cents(movementAmount),
      ...(movementKind.startsWith('TRANSFER') ? { otherAccountId: movementAccount } : {}), note: movementNote.trim() };
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0 || !body.note || (body.kind.startsWith('TRANSFER') && !body.otherAccountId)) throw new Error('Completa el tipo, monto, cuenta y motivo del movimiento.');
    await sendCashMovement(body);
    setMovementAmount(''); setMovementNote('');
  }
  async function printReport(closed?: CashHistoryRow, share = false) {
    if (!context) return;
    const detail = closed ? { report: null, provisional: false } : await getCashReport(context);
    const snapshot = closed?.closingSnapshot;
    const movements: any[] = snapshot?.movements ?? detail.report?.movements ?? [];
    const local = closed ? [] : currentPending;
    const title = closed ? 'Comprobante de cierre' : 'Detalle del turno';
    const header = [title.toUpperCase(), closed?.cashierName ?? detail.report?.cashierName ?? shift?.cashierName ?? '', `Apertura: ${date(closed?.openedAt ?? shift?.openedAt)}`];
    if (detail.provisional || local.length) header.push('PROVISIONAL: PENDIENTES SIN SUMAR');
    const methodOrder = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO', 'Tesorería'];
    const lines: string[] = [];
    for (const method of methodOrder) {
      const group = movements.filter(row => (row.method || 'Tesorería') === method);
      if (!group.length) continue;
      lines.push(`\n${method}`);
      for (const row of group) lines.push(`${sourceName(row.sourceType)} ${row.reference || ''} · ${row.treasuryAccount?.name || ''}: ${money(row.amountCents)}`);
      lines.push(`Total de movimientos: ${money(group.reduce((sum, row) => sum + Number(row.amountCents || 0), 0))}`);
    }
    const sourceIds = new Set(movements.map(row => `${row.sourceType}:${row.sourceId}`));
    const documents: any[] = snapshot?.documents ?? detail.report?.documents ?? [];
    const withoutMoney = documents.filter(row => !sourceIds.has(`${row.sourceType}:${row.id}`));
    if (withoutMoney.length) {
      lines.push('\nOPERACIONES SIN MOVIMIENTO DE DINERO');
      for (const row of withoutMoney) lines.push(`${sourceName(row.sourceType)} ${row.reference || ''}: ${money(row.amountCents ?? row.totalCents)}${row.cancelled ? ' · Anulada' : ''}`);
    }
    const pendingLines = local.map(row => `PENDIENTE ${sourceName(row.entity_type)} ${row.entity_local_id} · ${row.last_error_code || row.status}`);
    const footer = closed ? [`Esperado: ${money(closed.expectedClosingCents)}`, `Contado: ${money(closed.countedClosingCents)}`, `Diferencia: ${money(closed.closingDifferenceCents)}`, `Diferencia al abrir: ${money(closed.openingDifferenceCents)}`, `Cierre: ${date(closed.closedAt)}`, ...(snapshot?.emergency ? ['CIERRE EXCEPCIONAL'] : []), ...(closed.closingNote ? [`Nota: ${closed.closingNote}`] : [])] : [`Fondo inicial: ${money(detail.report?.openingCents ?? shift?.openingCountedCents)}`, `Efectivo esperado: ${money(detail.report?.expectedCashCents ?? shift?.expectedCashCents)}`];
    const text = [...header, '', ...lines, ...pendingLines, '', ...footer].join('\n');
    if (!share) {
      const result = await printCashShiftTextDirect(text);
      if (!result.printed) throw new Error(result.message || 'No se pudo imprimir el turno.');
      return;
    }
    const format = detail.report?.format === '80mm' ? '80mm auto' : 'letter';
    const html = `<html><head><meta charset="utf-8"/><style>@page{size:${format};margin:10mm}body{font:13px Arial;color:#111}h1{font-size:19px}p{border-bottom:1px solid #ddd;padding:6px 0}strong{display:block}</style></head><body><h1>${escapeHtml(title)}</h1>${[...header.slice(1), ...lines, ...pendingLines, ...footer].map(line => `<p>${escapeHtml(line)}</p>`).join('')}</body></html>`;
    const pdf = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(pdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    else await Share.share({ url: pdf.uri, message: title });
  }

  return <View style={styles.root}>
    <Text variant="titleLarge">Turnos de caja</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {loading && <Text>Consultando caja…</Text>}
    {!loading && !context && <Action onPress={() => void run(async () => {})}>Reintentar</Action>}
    {context && !context.enabled && context.canManage && <Card style={styles.card}><Card.Content>
      <Text variant="titleMedium">Prepara tu caja para trabajar por turnos</Text>
      <Text>La activación es permanente. Cada empleado contará el efectivo al abrir y cerrar su propio turno.</Text>
      {!preview ? <Action disabled={busy} onPress={() => void run(async () => {
        if ((await legacyCashPending()).length || (await cashPending()).length) throw new Error('Sincroniza o resuelve los pendientes antes de activar.');
        setPreview(await cashApiGet<Preview>('preview'));
      })}>Revisar saldos</Action> : <>
        {preview.future > 0 && <Text style={styles.error}>Hay {preview.future} operaciones con fecha futura. Revísalas antes de activar.</Text>}
        {preview.unclassified > 0 && <Text style={styles.warning}>{preview.unclassified} operaciones anteriores no tienen cuenta identificada. Revisa los saldos.</Text>}
        {preview.accounts.map(account => <Text key={account.id}>{account.name}: {money(account.balanceCents)}</Text>)}
        <Text>Selecciona la caja que controlarán los empleados:</Text>
        {preview.accounts.filter(account => account.type === 'CAJA' && account.currency === 'DOP' && account.isActive && (!context.treasuryAccountId || account.id === context.treasuryAccountId)).map(account =>
          <Button key={account.id} mode={accountId === account.id ? 'contained' : 'outlined'} onPress={() => setAccountId(account.id)}>{account.name}</Button>)}
        <Amount label="Efectivo contado" value={counted} onChangeText={setCounted} />
        <Difference expected={preview.accounts.find(account => account.id === accountId)?.balanceCents} counted={counted} />
        <TextInput mode="outlined" label="Motivo de la diferencia" value={note} onChangeText={setNote} style={styles.input} />
        <Action disabled={busy || !accountId || !validActivationCount || preview.future > 0} onPress={() => void run(activate)}>Confirmar y activar turnos</Action>
        <Action secondary onPress={() => setPreview(null)}>Cancelar</Action>
      </>}
    </Card.Content></Card>}
    {context?.enabled && <Card style={styles.card}><Card.Content>
      <Text variant="titleMedium">{!shift ? 'Empieza tu turno' : owns ? shift.status === 'OPEN' ? 'Tu caja está abierta' : 'Cierre en curso' : `Caja de ${shift.cashierName}`}</Text>
      {shift && <Text>{shift.cashierName} · Desde {date(shift.openedAt)}</Text>}
      {context.collectionsByMethod && <><Text variant="titleSmall">Cobros del turno</Text><Rows rows={context.collectionsByMethod.map(item => ({ label: item.method, value: money(item.totalCents) }))} /></>}
      {expected != null && <Rows rows={[{ label: shift ? 'Efectivo esperado ahora' : 'Efectivo esperado al abrir', value: money(expected) }, ...(shift?.openingCountedCents != null ? [{ label: 'Fondo recibido', value: money(shift.openingCountedCents) }] : [])]} />}
      {!shift && context.canOperate && <>
        <Text>Cuenta solo billetes y monedas. Escribe 0 si la caja está vacía.</Text>
        <Amount label="Efectivo que recibes" value={counted} onChangeText={setCounted} />
        <Difference expected={expected} counted={counted} />
        <TextInput mode="outlined" label="Motivo de diferencia" value={note} onChangeText={setNote} style={styles.input} />
        <Action disabled={busy || !validCount} onPress={() => void run(async () => { await openCashShift(countedCents, note); setCounted(''); setNote(''); })}>Abrir mi turno</Action>
      </>}
      {shift && owns && <>
        <Action secondary disabled={busy} onPress={() => void run(async () => { await printReport(); })}>Imprimir detalle del turno</Action>
        <Action secondary disabled={busy} onPress={() => void run(async () => { await printReport(undefined, true); })}>Compartir detalle PDF</Action>
        {shift.status === 'OPEN' && !closing && <Action disabled={busy} onPress={() => void run(prepare)}>Cerrar mi turno</Action>}
        {(shift.status === 'CLOSING' || closing) && <>
          <Text>Sincroniza los pendientes, cuenta el efectivo y confirma la entrega. El conteo no se guarda hasta confirmar.</Text>
          {currentPending.length > 0 && <Text style={styles.warning}>{currentPending.length} operaciones por confirmar.</Text>}
          <Action secondary disabled={busy} onPress={() => void run(async () => { await syncService.flushCashShiftQueue(shift.id); await getCashContext(true); })}>Sincronizar pendientes</Action>
          <Amount label="Efectivo que entregas" value={counted} onChangeText={setCounted} />
          <Difference expected={expected} counted={counted} />
          <TextInput mode="outlined" label="Motivo de diferencia" value={note} onChangeText={setNote} style={styles.input} />
          <Action disabled={busy || !validCount || currentPending.length > 0 || shift.status !== 'CLOSING'} onPress={() => void run(() => close())}>Confirmar cierre</Action>
          <Action secondary disabled={busy} onPress={() => void run(resume)}>Reanudar turno</Action>
        </>}
      </>}
      {shift && !owns && context.isOwner && <>
        <Text style={styles.warning}>Cierre excepcional por ausencia o pérdida del dispositivo. Explica el motivo y los pendientes.</Text>
        <Amount label="Efectivo contado" value={counted} onChangeText={setCounted} />
        <TextInput mode="outlined" label="Motivo y situación de pendientes" value={note} onChangeText={setNote} style={styles.input} />
        <Action disabled={busy || !validCount || !note.trim()} onPress={() => void run(() => close(true))}>Cerrar excepcionalmente</Action>
      </>}
    </Card.Content></Card>}
    {context?.enabled && shift && owns && shift.status === 'OPEN' && (context.canRecordMovements || context.canTransfer) && <Card style={styles.card}><Card.Content>
      <Text variant="titleMedium">Dinero que entra o sale</Text>
      {[...(context.canTransfer ? ['TRANSFER_OUT', 'TRANSFER_IN'] : []), ...(context.canRecordMovements ? ['OWNER_IN', 'OWNER_OUT'] : [])].map(kind => <Button key={kind} mode={movementKind === kind ? 'contained' : 'outlined'} onPress={() => setMovementKind(kind)}>{({ TRANSFER_OUT: 'Pasar a otra cuenta', TRANSFER_IN: 'Traer de otra cuenta', OWNER_IN: 'Aporte del dueño', OWNER_OUT: 'Retiro del dueño' } as Record<string, string>)[kind]}</Button>)}
      {movementKind.startsWith('TRANSFER') && accounts.filter(account => account.id !== context.treasuryAccountId && account.isActive && account.currency === 'DOP').map(account => <Button key={account.id} mode={movementAccount === account.id ? 'contained' : 'outlined'} onPress={() => setMovementAccount(account.id)}>{account.name}</Button>)}
      <Amount label="Monto" value={movementAmount} onChangeText={setMovementAmount} />
      <TextInput mode="outlined" label="Motivo" value={movementNote} onChangeText={setMovementNote} style={styles.input} />
      <Action disabled={busy || !!manualPending} onPress={() => void run(() => movement())}>Guardar movimiento</Action>
    </Card.Content></Card>}
    {manualPending && <Card style={styles.card}><Card.Content><Text style={styles.warning}>Movimiento de caja sin confirmación del turno {manualPending.input.shiftId}. Reintenta con el mismo identificador o resuélvelo con motivo.</Text>{manualPending.userId !== context?.userId ? <Text>Debe resolverlo el empleado que lo registró.</Text> : <><Action disabled={busy} onPress={() => void run(() => movement(manualPending.input))}>Reintentar movimiento</Action><TextInput mode="outlined" label="Motivo para anular el pendiente" value={manualCancelReason} onChangeText={setManualCancelReason} style={styles.input} /><Action secondary disabled={busy || !manualCancelReason.trim()} onPress={() => void run(async () => { const result = await cancelPendingCashMovement(manualPending.input.shiftId, manualCancelReason); setManualCancelReason(''); if (result === 'committed') Alert.alert('Movimiento confirmado', 'El servidor ya había registrado este movimiento. Revisa el efectivo esperado.'); })}>Resolver pendiente con motivo</Action></>}</Card.Content></Card>}
    {context && pending.length > 0 && <Card style={styles.card}><Card.Content><Text variant="titleMedium">Operaciones pendientes</Text>
      {pending.map(row => {
        const onlineCredit = row.entity_type === 'credit_purchase' || row.entity_type === 'supplier_payment';
        let rejected = false;
        if (onlineCredit) { try { rejected = Boolean(JSON.parse(row.data || '{}').rejectedAt); } catch { /* conservar pendiente */ } }
        return <View key={row.id} style={styles.pending}><Text>{sourceName(row.entity_type)} · {row.entity_local_id} · {row.last_error_code || row.status}</Text>
          {onlineCredit && row.user_id === context.userId && <Button onPress={() => void run(async () => { await syncService.retryOnlineFinancial(row.id); })}>Reintentar confirmación</Button>}
          {!row.client_operation_id ? <Text style={styles.warning}>Pendiente anterior sin identidad de turno. Comprueba si llegó al servidor y resuélvelo antes de activar o abrir caja.</Text> : row.user_id === context.userId ?
            (!onlineCredit || rejected) && <Button onPress={() => { setDiscardRow(row); setDiscardReason(''); }}>Anular con motivo</Button>
            : <Text>Debe resolverlo el empleado que lo registró.</Text>}
        </View>;
      })}
      {discardRow && <><TextInput mode="outlined" label="Motivo de anulación" value={discardReason} onChangeText={setDiscardReason} style={styles.input} /><Action disabled={busy || !discardReason.trim()} onPress={() => void run(async () => { if (discardRow.entity_type === 'credit_purchase' || discardRow.entity_type === 'supplier_payment') await syncService.discardRejectedOnlineFinancial(discardRow.id, discardReason); else { await discardCashPending(discardRow, discardReason); await syncService.refreshCashDiscardCatalog(); } setDiscardRow(null); setDiscardReason(''); })}>Confirmar anulación</Action></>}
    </Card.Content></Card>}
    {lastClosedId && !shift && <Card style={styles.card}><Card.Content><Text style={styles.good}>El turno quedó cerrado. El siguiente empleado puede abrir el suyo.</Text><Action secondary onPress={() => void run(async () => { const row = await cashApiGet<CashHistoryRow>(`receipt&shiftId=${encodeURIComponent(lastClosedId)}`); await printReport(row); })}>Imprimir comprobante</Action><Action secondary onPress={() => void run(async () => { const row = await cashApiGet<CashHistoryRow>(`receipt&shiftId=${encodeURIComponent(lastClosedId)}`); await printReport(row, true); })}>Compartir comprobante PDF</Action></Card.Content></Card>}
    {(context?.canOperate || context?.canViewAll || context?.canManage) && history.length > 0 && <Card style={styles.card}><Card.Content><Text variant="titleMedium">Historial de turnos</Text>
      {history.map(row => <View key={row.id} style={styles.pending}><Button onPress={() => { setSelected(selected?.id === row.id ? null : row); setCorrection(null); }}>{row.cashierName} · {date(row.openedAt)}</Button>{selected?.id === row.id && <>
        <Rows rows={[{ label: 'Abrió', value: date(row.openedAt) }, { label: 'Cerró', value: date(row.closedAt) }, { label: 'Fondo inicial', value: money(row.openingCountedCents) }, { label: 'Diferencia al abrir', value: money(row.openingDifferenceCents) }, { label: 'Esperado al cerrar', value: money(row.expectedClosingCents) }, { label: 'Contado', value: money(row.countedClosingCents) }, { label: 'Diferencia al cerrar', value: money(row.closingDifferenceCents) }]} />
        {row.openingNote && <Text>Nota de apertura: {row.openingNote}</Text>}{row.closingNote && <Text>Nota de cierre: {row.closingNote}</Text>}
        {row.status === 'CLOSED' && <><Action secondary onPress={() => void run(() => printReport(row))}>Imprimir comprobante</Action><Action secondary onPress={() => void run(() => printReport(row, true))}>Compartir PDF</Action></>}
        {(row.closingSnapshot?.movements ?? []).map((entry: any) => <Text key={entry.id}>{sourceName(entry.sourceType)} · {entry.reference} · {entry.treasuryAccount?.name}: {money(entry.amountCents)}</Text>)}
        {(row.closingSnapshot?.documents ?? []).filter((doc: any) => !doc.cancelled && context.canCorrect?.[doc.sourceType]).map((doc: any) => <Button key={`${doc.sourceType}:${doc.id}`} onPress={() => setCorrection({ sourceType: doc.sourceType, sourceId: doc.id })}>Corregir {sourceName(doc.sourceType)} · {doc.reference}</Button>)}
        {correction && <><Text>El cierre anterior conservará sus importes. Indica si hubo movimiento real de dinero.</Text><TextInput mode="outlined" label="Motivo de corrección" value={correctionReason} onChangeText={setCorrectionReason} style={styles.input} /><Checkbox.Item label="Hubo devolución o recuperación de dinero" status={moneyMoved ? 'checked' : 'unchecked'} onPress={() => setMoneyMoved(!moneyMoved)} /><Action disabled={busy || !correctionReason.trim()} onPress={() => void run(async () => { await cashApiPost({ action: 'correct', ...correction, reason: correctionReason, moneyMoved }); setCorrection(null); setCorrectionReason(''); })}>Confirmar corrección</Action></>}
      </>}</View>)}
      {hasMoreHistory && <Action secondary disabled={busy} onPress={() => void run(async () => {
        const before = history[history.length - 1]?.id;
        if (!before) return;
        const rows = await cashApiGet<CashHistoryRow[]>(`history&before=${encodeURIComponent(before)}&limit=${HISTORY_PAGE_SIZE + 1}`);
        setHistory(current => [...current, ...rows.slice(0, HISTORY_PAGE_SIZE)]);
        setHasMoreHistory(rows.length > HISTORY_PAGE_SIZE);
      }, false)}>Cargar turnos anteriores</Action>}
    </Card.Content></Card>}
    {context?.enabled && <Action secondary disabled={busy} onPress={() => void run(async () => { await getCashContext(true); })}>Actualizar caja</Action>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12, marginBottom: 20 }, card: { backgroundColor: ui.colors.surface }, action: { marginTop: 8 },
  input: { marginTop: 9, backgroundColor: ui.colors.surface }, error: { color: '#B91C1C', padding: 8 },
  warning: { color: '#A16207', paddingVertical: 7 }, good: { color: '#15803D', paddingVertical: 7 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  rowLabel: { flex: 1, color: ui.colors.textMuted }, rowValue: { fontWeight: '700', color: ui.colors.text },
  pending: { borderTopWidth: 1, borderColor: ui.colors.border, paddingVertical: 8 },
});
