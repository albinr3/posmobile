import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { db, type DatabaseTransaction } from '../../database/Database';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { API_URL } from '../sync/syncShared';
import { generateLocalId } from '../../utils/helpers';

export type CashOperation = { accountId: string; userId: string; cashShiftId: string | null; clientOperationId: string; clientSequence: number | null };
export type CashContext = {
  protocolVersion: number; accountId: string; userId: string; userName: string; isOwner: boolean;
  enabled: boolean; treasuryAccountId: string | null; canOperate: boolean; canViewAll: boolean;
  canManage: boolean; canTransfer: boolean; canRecordMovements: boolean;
  canCorrect?: Record<string, boolean>;
  expectedOpeningCents: number | null;
  breakdown: Array<{ accountName: string; method: string | null; totalCents: number }>;
  collectionsByMethod: Array<{ method: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'OTRO'; totalCents: number }> | null;
  activeShift: null | { id: string; status: 'OPEN' | 'CLOSING'; cashierName: string; isMine: boolean;
    isDevice: boolean; openedAt: string; lastSequence: number | null; finalSequence: number | null;
    openingCountedCents: number | null; expectedCashCents: number | null };
};
export type CashHistoryRow = { id: string; cashierName: string; openedAt: string; closedAt: string | null;
  status: string; openingCountedCents: number; openingDifferenceCents: number; openingNote: string | null;
  expectedClosingCents: number | null; countedClosingCents: number | null; closingDifferenceCents: number | null;
  closingNote: string | null; closingSnapshot: { movements: any[]; documents: any[]; emergency: boolean } | null };
export type CashQueueRow = { id: number; entity_type: string; entity_local_id: string; action: string;
  status: string; data: string; account_id: string | null; user_id: string | null; cash_shift_id: string | null;
  client_operation_id: string | null; client_sequence: number | null; last_error_code: string | null };

type Device = { token: string; deviceId: string };
const DEVICE_KEY = 'movopos_cash_device_v1';
let clerkTokenGetter: (() => Promise<string | null>) | null = null;
let devicePromise: Promise<Device> | null = null;
export function setCashClerkTokenGetter(getter: () => Promise<string | null>) { clerkTokenGetter = getter; }

function actor() {
  const state = useAuthStore.getState();
  if (!state.accountId || !state.subUser?.id || !state.subUserToken) throw new Error('Selecciona el empleado para consultar la caja.');
  return { accountId: state.accountId, userId: state.subUser.id, subUserToken: state.subUserToken };
}
function contextKey(accountId: string, userId: string) { return `context:${accountId}:${userId}`; }
function isOnline() { return useSyncStore.getState().isOnline; }
class CashHttpError extends Error { constructor(message: string, public status?: number) { super(message); } }
function failure(error: unknown): Error {
  if (axios.isAxiosError(error)) return new CashHttpError(String(error.response?.data?.error || error.message || 'No se pudo consultar la caja'), error.response?.status);
  return error instanceof Error ? error : new Error('No se pudo consultar la caja');
}
async function authHeaders() {
  const identity = actor();
  const clerkToken = await clerkTokenGetter?.();
  if (!clerkToken) throw new Error('Inicia sesión para operar la caja.');
  return { Authorization: `Bearer ${clerkToken}`, 'X-Clerk-Authorization': `Bearer ${clerkToken}`,
    'X-SubUser-Token': identity.subUserToken, 'X-Account-Id': identity.accountId };
}
async function loadDevice(): Promise<Device> {
  const saved = await SecureStore.getItemAsync(DEVICE_KEY);
  if (saved) {
    try { const parsed = JSON.parse(saved) as Device; if (parsed.token && parsed.deviceId) return parsed; } catch { /* crear otro token */ }
  }
  if (!isOnline()) throw new Error('Conéctate una vez para identificar este dispositivo de caja.');
  const response = await axios.get<Device>(`${API_URL}/api/cash-shifts?view=device`, { headers: await authHeaders(), timeout: 20000 });
  const next = response.data;
  if (!next.token || !next.deviceId) throw new Error('El servidor no identificó este dispositivo.');
  await SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(next));
  return next;
}
function device(): Promise<Device> {
  if (!devicePromise) devicePromise = loadDevice().catch(error => { devicePromise = null; throw error; });
  return devicePromise;
}
export async function cashHeaders() { return { ...(await authHeaders()), 'X-Cash-Device-Token': (await device()).token }; }
export async function cashDeviceToken() { return (await device()).token; }
export async function cashApiGet<T>(view: string): Promise<T> {
  try { return (await axios.get<T>(`${API_URL}/api/cash-shifts?view=${view}`, { headers: await cashHeaders(), timeout: 20000 })).data; }
  catch (error) { throw failure(error); }
}
export async function cashApiPost<T = unknown>(body: Record<string, unknown>): Promise<T> {
  try { return (await axios.post<{ data: T }>(`${API_URL}/api/cash-shifts`, body, { headers: await cashHeaders(), timeout: 25000 })).data.data; }
  catch (error) { throw failure(error); }
}
export async function getCashContext(force = false): Promise<CashContext> {
  const identity = actor(), key = contextKey(identity.accountId, identity.userId);
  const cached = await db.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
  if (!force && !isOnline()) {
    if (!cached) throw new Error('Conéctate para comprobar la caja antes de operar.');
    return JSON.parse(cached.value) as CashContext;
  }
  try {
    const context = await cashApiGet<CashContext>('context');
    if (context.accountId !== identity.accountId || context.userId !== identity.userId || context.protocolVersion !== 1) throw new Error('La sesión o el protocolo de caja cambió. Actualiza la app.');
    await db.runAsync('INSERT OR REPLACE INTO cash_state (key, value) VALUES (?, ?)', [key, JSON.stringify(context)]);
    await useAuthStore.getState().updateCashPermissions(context.userId, {
      canOperateCashShifts: context.canOperate, canViewAllCashShifts: context.canViewAll,
      canManageCashShifts: context.canManage, canRecordCashMovements: context.canRecordMovements,
    }).catch(() => { /* El contexto de caja ya se guardó; el permiso se recupera al volver a consultar. */ });
    return context;
  } catch (error) {
    // Solo una falla de transporte/servidor admite la última copia. Un cambio de
    // cuenta o versión del protocolo debe bloquear operaciones, aunque exista caché.
    if (!force && cached && error instanceof CashHttpError && (error.status === undefined || error.status >= 500)) return JSON.parse(cached.value) as CashContext;
    throw failure(error);
  }
}
export function assertOwnOpenShift(context: CashContext) {
  if (!context.canOperate) throw new Error('No tienes permiso para abrir y cerrar turnos.');
  if (!context.activeShift) throw new Error('Cuenta el efectivo y abre tu turno en Cuadre diario antes de vender o cobrar.');
  if (!context.activeShift.isMine || !context.activeShift.isDevice) throw new Error(`El turno pertenece a ${context.activeShift.cashierName} o a otro dispositivo.`);
  if (context.activeShift.status !== 'OPEN') throw new Error('El turno se está cerrando. Reanúdalo antes de operar.');
}
const financial = new Set(['sale', 'payment', 'payment_batch', 'purchase', 'credit_purchase', 'supplier_payment', 'operating_expense', 'return', 'treasury_transfer']);
export async function cashContextForQueue(entityType: string, action: string, data: any): Promise<CashContext | null> {
  if (!financial.has(entityType)) return null;
  const context = await getCashContext();
  if (!context.enabled) return null;
  if (action !== 'create') throw new Error('Una operación del control por turnos se corrige desde el historial de caja.');
  const pos = entityType === 'sale' || entityType === 'payment' || entityType === 'payment_batch';
  if (!isOnline() && !pos) throw new Error('Necesitas conexión para registrar esta operación durante un turno.');
  let transferUsesDrawer = false;
  if (entityType === 'treasury_transfer' && context.treasuryAccountId) {
    const ids = [data?.fromTreasuryAccountId, data?.toTreasuryAccountId].filter(Boolean);
    const rows = await db.query<{ server_id: string }>(`SELECT server_id FROM treasury_accounts WHERE local_id IN (${ids.map(() => '?').join(',') || "''"}) OR server_id IN (${ids.map(() => '?').join(',') || "''"})`, [...ids, ...ids]);
    transferUsesDrawer = ids.includes(context.treasuryAccountId) || rows.some(row => row.server_id === context.treasuryAccountId);
  }
  const usesDrawer = transferUsesDrawer || data?.paymentMethod === 'EFECTIVO' || data?.method === 'EFECTIVO' || data?.refundMethod === 'EFECTIVO' ||
    data?.treasuryAccountId === context.treasuryAccountId || data?.refundTreasuryAccountId === context.treasuryAccountId;
  if (pos || usesDrawer) assertOwnOpenShift(context);
  if (context.activeShift?.isMine && context.activeShift.isDevice && context.activeShift.status !== 'OPEN') throw new Error('Termina o reanuda el cierre antes de registrar operaciones.');
  return context;
}
export async function cashOperationForInsert(tx: DatabaseTransaction, context: CashContext, localId: string): Promise<CashOperation> {
  const identity = actor(), shift = context.activeShift;
  const bound = Boolean(shift?.isMine && shift.isDevice && shift.status === 'OPEN');
  const deviceId = (await device()).deviceId;
  const clientOperationId = `${deviceId}:${localId}`;
  if (!bound) return { accountId: identity.accountId, userId: identity.userId, cashShiftId: null, clientSequence: null, clientOperationId };
  const key = `sequence:${shift!.id}`;
  const saved = await tx.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
  const previous = saved ? JSON.parse(saved.value) as { sequence: number; frozen: boolean } : { sequence: 0, frozen: false };
  if (previous.frozen) throw new Error('El turno se está cerrando. Reanúdalo antes de operar.');
  const queued = await tx.queryFirst<{ sequence: number | null }>('SELECT MAX(client_sequence) AS sequence FROM sync_queue WHERE cash_shift_id = ?', [shift!.id]);
  const sequence = Math.max(previous.sequence, shift!.lastSequence ?? 0, queued?.sequence ?? 0) + 1;
  await tx.runAsync('INSERT OR REPLACE INTO cash_state (key, value) VALUES (?, ?)', [key, JSON.stringify({ sequence, frozen: false })]);
  return { accountId: identity.accountId, userId: identity.userId, cashShiftId: shift!.id, clientSequence: sequence, clientOperationId };
}
export async function cashPending(shiftId?: string): Promise<CashQueueRow[]> {
  return db.query<CashQueueRow>(`SELECT * FROM sync_queue WHERE entity_type IN ('sale','payment','payment_batch','purchase','credit_purchase','supplier_payment','operating_expense','return','treasury_transfer') AND status != 'synced' ${shiftId ? 'AND cash_shift_id = ?' : ''} ORDER BY created_at, id`, shiftId ? [shiftId] : []);
}
export async function legacyCashPending(): Promise<CashQueueRow[]> {
  return db.query<CashQueueRow>("SELECT * FROM sync_queue WHERE entity_type IN ('sale','payment','payment_batch','purchase','credit_purchase','supplier_payment','operating_expense','return','treasury_transfer') AND status != 'synced' AND client_operation_id IS NULL ORDER BY created_at, id");
}
export async function freezeCashShift(context: CashContext): Promise<number> {
  const shift = context.activeShift;
  if (!shift) throw new Error('No hay turno abierto.');
  if (await pendingCashMovement(shift.id)) throw new Error('Reintenta el movimiento de caja pendiente antes de preparar el cierre.');
  return db.transaction(async tx => {
    const key = `sequence:${shift.id}`;
    const saved = await tx.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
    const current = saved ? JSON.parse(saved.value) as { sequence: number } : { sequence: 0 };
    const queued = await tx.queryFirst<{ sequence: number | null }>('SELECT MAX(client_sequence) AS sequence FROM sync_queue WHERE cash_shift_id = ?', [shift.id]);
    // El journal durable es otra fuente de verdad si se perdió el contador local.
    const sequence = Math.max(current.sequence, shift.lastSequence ?? 0, queued?.sequence ?? 0);
    await tx.runAsync('INSERT OR REPLACE INTO cash_state (key, value) VALUES (?, ?)', [key, JSON.stringify({ sequence, frozen: true })]);
    return sequence;
  });
}
export async function unfreezeCashShift(shiftId: string) {
  await db.transaction(async tx => {
    const key = `sequence:${shiftId}`, saved = await tx.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
    const current = saved ? JSON.parse(saved.value) : { sequence: 0 };
    await tx.runAsync('INSERT OR REPLACE INTO cash_state (key, value) VALUES (?, ?)', [key, JSON.stringify({ ...current, frozen: false })]);
  });
}
export async function isCashShiftFrozen(shiftId: string): Promise<boolean> {
  const saved = await db.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [`sequence:${shiftId}`]);
  return saved ? Boolean(JSON.parse(saved.value).frozen) : false;
}
export async function openCashShift(countedCents: number, note: string) {
  if (!isOnline()) throw new Error('Necesitas conexión para abrir el turno.');
  const before = await getCashContext(true);
  if (before.activeShift) throw new Error('Ya hay un turno abierto. Actualiza la caja.');
  if ((await legacyCashPending()).length || (await cashPending()).some(row => row.cash_shift_id)) throw new Error('Resuelve los pendientes antes de abrir el turno.');
  try { await cashApiPost({ action: 'open', countedCents, note }); }
  catch (error) {
    const recovered = await getCashContext(true).catch(() => null);
    if (!recovered?.activeShift?.isMine || !recovered.activeShift.isDevice) throw error;
  }
  return getCashContext(true);
}

export async function getCashReport(context: CashContext) {
  const shift = context.activeShift;
  if (!shift?.isMine || !shift.isDevice) throw new Error('El detalle solo está disponible para el responsable en este dispositivo.');
  const key = `report:${context.accountId}:${context.userId}:${shift.id}`;
  if (isOnline()) {
    try {
      const report = await cashApiGet<any>(`report&shiftId=${encodeURIComponent(shift.id)}`);
      if (report.accountId !== context.accountId || report.userId !== context.userId || report.shiftId !== shift.id) throw new Error('El detalle pertenece a otro turno.');
      await db.runAsync('INSERT OR REPLACE INTO cash_state (key, value) VALUES (?, ?)', [key, JSON.stringify(report)]);
      return { report, provisional: false };
    } catch (error) {
      if (!(error instanceof CashHttpError) || (error.status !== undefined && error.status < 500)) throw error;
    }
  }
  const saved = await db.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
  if (!saved) return { report: null, provisional: true };
  const report = JSON.parse(saved.value);
  if (report.accountId !== context.accountId || report.userId !== context.userId || report.shiftId !== shift.id) throw new Error('El detalle guardado pertenece a otro turno.');
  return { report, provisional: true };
}

export async function sendCashMovement(input: { shiftId: string; kind: string; amountCents: number; otherAccountId?: string; note: string }) {
  if (!isOnline()) throw new Error('Necesitas conexión para registrar movimientos de caja.');
  const identity = actor(), key = `manual:${input.shiftId}`;
  const saved = await db.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
  const previous = saved ? JSON.parse(saved.value) : null;
  if (previous && (previous.accountId !== identity.accountId || previous.userId !== identity.userId || JSON.stringify(previous.input) !== JSON.stringify(input))) {
    throw new Error('Reintenta el movimiento pendiente con el empleado original antes de registrar otro.');
  }
  if (!previous) {
    const context = await getCashContext(true);
    assertOwnOpenShift(context);
    if (context.activeShift?.id !== input.shiftId) throw new Error('El turno cambió. Actualiza la caja.');
  }
  const body = previous?.body ?? { action: 'movement', ...input, operationId: generateLocalId() };
  if (!previous) await db.runAsync('INSERT OR REPLACE INTO cash_state (key, value) VALUES (?, ?)', [key, JSON.stringify({ accountId: identity.accountId, userId: identity.userId, input, body })]);
  await cashApiPost(body);
  await db.runAsync('DELETE FROM cash_state WHERE key = ?', [key]);
  return getCashContext(true);
}

export async function pendingCashMovement(shiftId: string) {
  const saved = await db.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [`manual:${shiftId}`]);
  return saved ? JSON.parse(saved.value) as { accountId: string; userId: string; body: { operationId: string }; input: { shiftId: string; kind: string; amountCents: number; otherAccountId?: string; note: string } } : null;
}

export async function oldestPendingCashMovement(accountId: string, preferredShiftId?: string) {
  const rows = await db.query<{ value: string }>("SELECT value FROM cash_state WHERE key LIKE 'manual:%' ORDER BY key");
  const pending = rows.map(row => JSON.parse(row.value) as NonNullable<Awaited<ReturnType<typeof pendingCashMovement>>>).filter(row => row.accountId === accountId);
  return pending.find(row => row.input.shiftId === preferredShiftId) ?? pending[0] ?? null;
}

export async function cancelPendingCashMovement(shiftId: string, reason: string): Promise<'cancelled' | 'committed'> {
  if (!reason.trim()) throw new Error('Explica por qué anulas este movimiento.');
  const key = `manual:${shiftId}`;
  const saved = await db.queryFirst<{ value: string }>('SELECT value FROM cash_state WHERE key = ?', [key]);
  if (!saved) throw new Error('No hay un movimiento pendiente en este dispositivo.');
  const pending = JSON.parse(saved.value);
  const identity = actor();
  if (pending.accountId !== identity.accountId || pending.userId !== identity.userId) throw new Error('Vuelve al empleado que registró este movimiento.');
  const result = await cashApiPost<{ cancelled: boolean; committed: boolean }>({ action: 'cancelMovement', shiftId,
    operationId: pending.body.operationId, reason: reason.trim() });
  if (!result.cancelled && !result.committed) throw new Error('El servidor no resolvió el movimiento pendiente.');
  await db.runAsync('DELETE FROM cash_state WHERE key = ?', [key]);
  return result.committed ? 'committed' : 'cancelled';
}

export async function discardCashPending(row: CashQueueRow, reason: string) {
  if (!reason.trim()) throw new Error('Explica por qué anulas el pendiente.');
  if (!row.client_operation_id || !row.account_id || !row.user_id) throw new Error('Este pendiente antiguo requiere revisión antes de activar turnos.');
  const identity = actor();
  if (identity.accountId !== row.account_id || identity.userId !== row.user_id) throw new Error('Vuelve al empleado que registró este pendiente.');
  const cashOperation: CashOperation = { accountId: row.account_id, userId: row.user_id, cashShiftId: row.cash_shift_id,
    clientOperationId: row.client_operation_id, clientSequence: row.client_sequence };
  const payload = { reason: reason.trim(), originalKind: row.entity_type, originalPayload: JSON.parse(row.data) };
  const response = await axios.post(`${API_URL}/api/cash-shifts/operations`, { kind: 'discard', cashOperation, payload }, { headers: await cashHeaders(), timeout: 25000 });
  if (!response.data?.result?.discarded) throw new Error('No se confirmó la anulación del pendiente.');
  await db.transaction(async tx => {
    const latest = await tx.queryFirst<CashQueueRow>('SELECT * FROM sync_queue WHERE id = ?', [row.id]);
    if (!latest || latest.status === 'synced') return;
    const original = JSON.parse(row.data || '{}');
    if (row.entity_type === 'sale') {
      const sale = await tx.queryFirst<{ data: string; status: string }>('SELECT data, status FROM sales WHERE local_id = ?', [row.entity_local_id]);
      if (sale && sale.status !== 'cancelled') {
        const parsed = JSON.parse(sale.data || '{}');
        for (const item of parsed.stockConsumptions ?? []) await tx.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [item.qty, item.ingredientId]);
        await tx.runAsync("UPDATE sales SET status = 'cancelled', synced = 1, data = ? WHERE local_id = ?", [JSON.stringify({ ...parsed, status: 'cancelled', cancellationReason: reason }), row.entity_local_id]);
      }
    }
    if (row.entity_type === 'payment' || row.entity_type === 'payment_batch') {
      const ids = row.entity_type === 'payment' ? [row.entity_local_id] : (Array.isArray(original.localPaymentIds) ? original.localPaymentIds : []);
      for (const id of ids) {
        const payment = await tx.queryFirst<{ ar_id: string; amount_cents: number }>('SELECT ar_id, amount_cents FROM payments WHERE local_id = ?', [id]);
        if (payment) {
          await tx.runAsync('DELETE FROM payments WHERE local_id = ?', [id]);
          await tx.runAsync("UPDATE accounts_receivable SET paid_cents = MAX(0, paid_cents - ?), balance_cents = balance_cents + ?, status = CASE WHEN paid_cents - ? <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END WHERE local_id = ?", [payment.amount_cents, payment.amount_cents, payment.amount_cents, payment.ar_id]);
        }
      }
    }
    if (row.entity_type === 'purchase') {
      for (const item of original.items ?? []) await tx.runAsync('UPDATE products SET stock = stock - ? WHERE local_id = ?', [item.qty, item.productId]);
      await tx.runAsync('DELETE FROM purchases WHERE local_id = ?', [row.entity_local_id]);
      // El precio anterior no está en la compra local: la próxima descarga restaura el catálogo del servidor.
      await tx.runAsync("INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES ('cash_catalog_refresh_required', '1', ?)", [Date.now()]);
    }
    if (row.entity_type === 'operating_expense') await tx.runAsync('DELETE FROM operating_expenses WHERE local_id = ?', [row.entity_local_id]);
    if (row.entity_type === 'treasury_transfer') await tx.runAsync('DELETE FROM treasury_transfers WHERE local_id = ?', [row.entity_local_id]);
    if (row.entity_type === 'return') {
      const returned = await tx.queryFirst<{ total_cents: number }>('SELECT total_cents FROM returns WHERE local_id = ?', [row.entity_local_id]);
      if (original.arLocalId && returned) await tx.runAsync("UPDATE accounts_receivable SET balance_cents = balance_cents + ?, paid_cents = MAX(0, paid_cents - ?), status = CASE WHEN paid_cents - ? <= 0 THEN 'PENDIENTE' ELSE 'PARCIAL' END WHERE local_id = ?", [returned.total_cents, returned.total_cents, returned.total_cents, original.arLocalId]);
      await tx.runAsync('DELETE FROM return_items WHERE return_local_id = ?', [row.entity_local_id]);
      await tx.runAsync('DELETE FROM returns WHERE local_id = ?', [row.entity_local_id]);
    }
    await tx.runAsync("UPDATE sync_queue SET status = 'synced', synced_at = ?, last_error_code = 'DISCARDED' WHERE id = ?", [Date.now(), row.id]);
  });
}
