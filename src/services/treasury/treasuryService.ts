import { db } from '../../database/Database';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../sync/SyncService';
import {
  TreasuryAccount,
  TreasuryAccountType,
  TreasuryMovement,
  TreasuryTransfer,
  TreasuryTransferStatus,
} from '../../types';
import { generateLocalId } from '../../utils/helpers';

const DEFAULT_CASH_ACCOUNT_NAME = 'Caja Efectivo';

type DateRangeInput = {
  fromMs?: number;
  toMs?: number;
};

type TreasuryPermissions = {
  canView: boolean;
  canManageAccounts: boolean;
  canCreateTransfers: boolean;
  canReverseTransfers: boolean;
};

type TreasuryDashboardAccount = {
  id: string;
  name: string;
  type: TreasuryAccountType;
  currency: string;
  bankName: string | null;
  accountNumber: string | null;
  isActive: boolean;
  inCents: number;
  outCents: number;
  balanceCents: number;
};

type TreasuryDashboardResult = {
  fromMs: number;
  toMs: number;
  accounts: TreasuryDashboardAccount[];
  movements: TreasuryMovement[];
  totals: {
    inCents: number;
    outCents: number;
    balanceCents: number;
  };
};

function parseJsonSafe<T = any>(raw: any): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

function normalizeAccountName(name: string): string {
  return String(name || '').trim().toLocaleLowerCase('es');
}

function normalizeMethod(method: unknown): string {
  return String(method || '').trim().toUpperCase();
}

function normalizeDateMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function isSaleCancelled(rawSale: any): boolean {
  return (
    rawSale?.cancel === true ||
    Boolean(rawSale?.cancelledAt) ||
    String(rawSale?.status || '').toLowerCase() === 'cancelled' ||
    String(rawSale?.status || '').toLowerCase() === 'cancelada'
  );
}

function isCashAccountByNameAndType(name: string, type: string): boolean {
  return normalizeAccountName(name) === normalizeAccountName(DEFAULT_CASH_ACCOUNT_NAME) && type === 'CAJA';
}

function pickCanonicalCashAccount(accounts: TreasuryAccount[]): TreasuryAccount | null {
  const cashAccounts = accounts.filter((account) => isCashAccountByNameAndType(account.name, account.type));
  if (cashAccounts.length === 0) return null;
  const sorted = [...cashAccounts].sort((a, b) => {
    const aServer = a.serverId ? 0 : 1;
    const bServer = b.serverId ? 0 : 1;
    if (aServer !== bServer) return aServer - bServer;
    const aActive = a.isActive ? 0 : 1;
    const bActive = b.isActive ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.createdAt - b.createdAt;
  });
  return sorted[0] || null;
}

function formatTransferReference(transferId: string): string {
  return `TR-${String(transferId || '').slice(-8).toUpperCase()}`;
}

function movementTimeInRange(occurredAt: number, fromMs: number, toMs: number): boolean {
  return occurredAt >= fromMs && occurredAt <= toMs;
}

export function getTreasuryPermissions(): TreasuryPermissions {
  const subUser = useAuthStore.getState().subUser as any;
  if (!subUser) {
    return {
      canView: false,
      canManageAccounts: false,
      canCreateTransfers: false,
      canReverseTransfers: false,
    };
  }

  if (subUser.isOwner) {
    return {
      canView: true,
      canManageAccounts: true,
      canCreateTransfers: true,
      canReverseTransfers: true,
    };
  }

  return {
    canView: subUser.canViewTreasury === true,
    canManageAccounts: subUser.canManageTreasuryAccounts === true,
    canCreateTransfers: subUser.canCreateTreasuryTransfers === true,
    canReverseTransfers: subUser.canReverseTreasuryTransfers === true,
  };
}

export function canUseAccountForPaymentMethod(
  account: Pick<TreasuryAccount, 'type' | 'name' | 'isActive'>,
  paymentMethod: string
): boolean {
  if (!account.isActive) return false;
  const method = normalizeMethod(paymentMethod);
  if (method === 'EFECTIVO') {
    return isCashAccountByNameAndType(account.name, account.type);
  }
  if (method === 'TRANSFERENCIA') {
    return account.type === 'BANCO';
  }
  return true;
}

export function getAccountTransferBankName(account: Pick<TreasuryAccount, 'name' | 'bankName'>): string {
  const bankName = String(account.bankName || '').trim();
  return bankName || String(account.name || '').trim();
}

function mapTreasuryAccountRow(row: any): TreasuryAccount {
  const parsed = parseJsonSafe<any>(row?.data);
  return {
    localId: String(row.local_id),
    serverId: row.server_id ? String(row.server_id) : null,
    name: String(row.name || parsed?.name || ''),
    type: (String(row.type || parsed?.type || 'CAJA').toUpperCase() as TreasuryAccountType) === 'BANCO' ? 'BANCO' : 'CAJA',
    currency: String(row.currency || parsed?.currency || 'DOP'),
    bankName: row.bank_name ? String(row.bank_name) : parsed?.bankName ? String(parsed.bankName) : null,
    accountNumber: row.account_number ? String(row.account_number) : parsed?.accountNumber ? String(parsed.accountNumber) : null,
    isActive: Number(row.is_active ?? 1) === 1,
    createdAt: Number(row.created_at || parsed?.createdAt || Date.now()),
    updatedAt: Number(row.updated_at || parsed?.updatedAt || row.created_at || Date.now()),
    synced: Number(row.synced ?? 0) === 1,
    data: String(row.data || '{}'),
  };
}

export async function ensureDefaultCashTreasuryAccount(): Promise<TreasuryAccount> {
  const existingCash = await db.queryFirst<any>(
    `SELECT *
     FROM treasury_accounts
     WHERE type = 'CAJA'
     ORDER BY is_active DESC, created_at ASC
     LIMIT 1`
  );

  if (existingCash?.local_id) {
    const account = mapTreasuryAccountRow(existingCash);
    if (!isCashAccountByNameAndType(account.name, account.type)) {
      const updatedAt = Date.now();
      await db.update('treasury_accounts', String(account.localId), {
        name: DEFAULT_CASH_ACCOUNT_NAME,
        updated_at: updatedAt,
        synced: 0,
        data: JSON.stringify({
          ...(parseJsonSafe<any>(account.data) || {}),
          name: DEFAULT_CASH_ACCOUNT_NAME,
          updatedAt,
        }),
      });
      const refreshed = await db.queryFirst<any>('SELECT * FROM treasury_accounts WHERE local_id = ? LIMIT 1', [account.localId]);
      return mapTreasuryAccountRow(refreshed);
    }
    return account;
  }

  const now = Date.now();
  const localId = generateLocalId();
  const payload = {
    localId,
    name: DEFAULT_CASH_ACCOUNT_NAME,
    type: 'CAJA' as TreasuryAccountType,
    currency: 'DOP',
    bankName: null,
    accountNumber: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert('treasury_accounts', {
    local_id: localId,
    server_id: null,
    name: payload.name,
    type: payload.type,
    currency: payload.currency,
    bank_name: payload.bankName,
    account_number: payload.accountNumber,
    is_active: 1,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    synced: 0,
    data: JSON.stringify(payload),
  });

  await db.insert('treasury_opening_balances', {
    local_id: generateLocalId(),
    server_id: null,
    treasury_account_id: localId,
    amount_cents: 0,
    effective_at: now,
    note: 'Saldo inicial por defecto',
    created_by_user_id: useAuthStore.getState().subUser?.id || null,
    created_at: now,
    synced: 0,
    data: JSON.stringify({
      localId,
      treasuryAccountId: localId,
      amountCents: 0,
      effectiveAt: now,
      note: 'Saldo inicial por defecto',
      createdAt: now,
    }),
  });

  const created = await db.queryFirst<any>('SELECT * FROM treasury_accounts WHERE local_id = ? LIMIT 1', [localId]);
  return mapTreasuryAccountRow(created);
}

export async function listTreasuryAccounts(includeInactive = true): Promise<TreasuryAccount[]> {
  await ensureDefaultCashTreasuryAccount();
  const rows = await db.query<any>(
    `SELECT *
     FROM treasury_accounts
     ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY is_active DESC, name COLLATE NOCASE ASC`
  );
  const accounts = rows.map(mapTreasuryAccountRow);
  const canonicalCash = pickCanonicalCashAccount(accounts);
  if (!canonicalCash) return accounts;

  // Mostrar solo la caja efectiva canónica para evitar duplicados visuales.
  return accounts.filter(
    (account) =>
      !isCashAccountByNameAndType(account.name, account.type) || account.localId === canonicalCash.localId
  );
}

export async function createTreasuryAccount(input: {
  name: string;
  type: TreasuryAccountType;
  currency?: string;
  bankName?: string | null;
  accountNumber?: string | null;
  openingBalanceCents?: number;
  openingBalanceDateMs?: number | null;
}): Promise<TreasuryAccount> {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('El nombre de la cuenta es requerido');

  const duplicate = await db.queryFirst<{ local_id?: string }>(
    `SELECT local_id
     FROM treasury_accounts
     WHERE lower(name) = lower(?)
     LIMIT 1`,
    [name]
  );
  if (duplicate?.local_id) {
    throw new Error('Ya existe una cuenta con ese nombre');
  }

  const type: TreasuryAccountType = input.type === 'BANCO' ? 'BANCO' : 'CAJA';
  const openingBalanceCents = Math.max(0, Math.round(Number(input.openingBalanceCents || 0)));
  if (openingBalanceCents > 0 && !isCashAccountByNameAndType(name, type)) {
    throw new Error('El saldo inicial manual solo está permitido para la cuenta Caja Efectivo');
  }

  const now = Date.now();
  const localId = generateLocalId();
  const payload = {
    localId,
    name,
    type,
    currency: String(input.currency || 'DOP'),
    bankName: input.bankName ? String(input.bankName).trim() : null,
    accountNumber: input.accountNumber ? String(input.accountNumber).trim() : null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert('treasury_accounts', {
    local_id: localId,
    server_id: null,
    name: payload.name,
    type: payload.type,
    currency: payload.currency,
    bank_name: payload.bankName,
    account_number: payload.accountNumber,
    is_active: 1,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    synced: 0,
    data: JSON.stringify(payload),
  });

  await syncService.queueOperation(
    'treasury_account',
    'create',
    {
      ...payload,
      id: null,
    },
    localId
  );

  if (openingBalanceCents > 0) {
    const openingLocalId = generateLocalId();
    const openingPayload = {
      localId: openingLocalId,
      treasuryAccountId: localId,
      amountCents: openingBalanceCents,
      effectiveAt: Number(input.openingBalanceDateMs || now),
      note: 'Saldo inicial al crear cuenta',
      createdAt: now,
    };
    await db.insert('treasury_opening_balances', {
      local_id: openingLocalId,
      server_id: null,
      treasury_account_id: localId,
      amount_cents: openingBalanceCents,
      effective_at: Number(input.openingBalanceDateMs || now),
      note: 'Saldo inicial al crear cuenta',
      created_by_user_id: useAuthStore.getState().subUser?.id || null,
      created_at: now,
      synced: 0,
      data: JSON.stringify(openingPayload),
    });
    await syncService.queueOperation(
      'treasury_opening_balance',
      'create',
      openingPayload,
      openingLocalId
    );
  }

  const created = await db.queryFirst<any>('SELECT * FROM treasury_accounts WHERE local_id = ? LIMIT 1', [localId]);
  return mapTreasuryAccountRow(created);
}

export async function updateTreasuryAccount(input: {
  id: string;
  name: string;
  type: TreasuryAccountType;
  currency?: string;
  bankName?: string | null;
  accountNumber?: string | null;
  isActive: boolean;
}): Promise<TreasuryAccount> {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('Cuenta inválida');
  const row = await db.queryFirst<any>('SELECT * FROM treasury_accounts WHERE local_id = ? OR server_id = ? LIMIT 1', [id, id]);
  if (!row) throw new Error('Cuenta de tesorería no encontrada');

  const name = String(input.name || '').trim();
  if (!name) throw new Error('El nombre de la cuenta es requerido');

  const duplicate = await db.queryFirst<{ local_id?: string }>(
    `SELECT local_id
     FROM treasury_accounts
     WHERE lower(name) = lower(?) AND local_id != ?
     LIMIT 1`,
    [name, String(row.local_id)]
  );
  if (duplicate?.local_id) throw new Error('Ya existe otra cuenta con ese nombre');

  const now = Date.now();
  const parsed = parseJsonSafe<any>(row.data) || {};
  const nextPayload = {
    ...parsed,
    name,
    type: input.type === 'BANCO' ? 'BANCO' : 'CAJA',
    currency: String(input.currency || parsed.currency || 'DOP'),
    bankName: input.bankName ? String(input.bankName).trim() : null,
    accountNumber: input.accountNumber ? String(input.accountNumber).trim() : null,
    isActive: input.isActive === true,
    updatedAt: now,
  };

  await db.update('treasury_accounts', String(row.local_id), {
    name: nextPayload.name,
    type: nextPayload.type,
    currency: nextPayload.currency,
    bank_name: nextPayload.bankName,
    account_number: nextPayload.accountNumber,
    is_active: nextPayload.isActive ? 1 : 0,
    updated_at: now,
    synced: 0,
    data: JSON.stringify(nextPayload),
  });

  if (row.server_id) {
    await syncService.queueOperation(
      'treasury_account',
      'update',
      {
        ...nextPayload,
        id: String(row.server_id),
      },
      String(row.local_id)
    );
  } else {
    const pendingCreate = await db.queryFirst<{ id?: number }>(
      `SELECT id
       FROM sync_queue
       WHERE entity_type = 'treasury_account'
         AND entity_local_id = ?
         AND action = 'create'
         AND status IN ('pending', 'syncing')
       LIMIT 1`,
      [String(row.local_id)]
    );
    if (pendingCreate?.id) {
      await db.update(
        'sync_queue',
        String(pendingCreate.id),
        {
          data: JSON.stringify({
            ...nextPayload,
            id: null,
          }),
        },
        'id'
      );
    } else {
      await syncService.queueOperation(
        'treasury_account',
        'create',
        {
          ...nextPayload,
          id: null,
        },
        String(row.local_id)
      );
    }
  }

  const updated = await db.queryFirst<any>('SELECT * FROM treasury_accounts WHERE local_id = ? LIMIT 1', [String(row.local_id)]);
  return mapTreasuryAccountRow(updated);
}

export async function setCashOpeningBalance(input: {
  treasuryAccountId: string;
  amountCents: number;
  effectiveAtMs?: number;
  note?: string | null;
}) {
  const account = await db.queryFirst<any>(
    'SELECT * FROM treasury_accounts WHERE local_id = ? OR server_id = ? LIMIT 1',
    [input.treasuryAccountId, input.treasuryAccountId]
  );
  if (!account) throw new Error('Cuenta de tesorería no encontrada');
  if (!isCashAccountByNameAndType(String(account.name || ''), String(account.type || ''))) {
    throw new Error('El saldo inicial manual solo está permitido para Caja Efectivo');
  }

  if (!Number.isInteger(input.amountCents)) {
    throw new Error('El saldo inicial debe estar en centavos');
  }

  const now = Date.now();
  const openingLocalId = generateLocalId();
  const openingPayload = {
    localId: openingLocalId,
    treasuryAccountId: String(account.local_id),
    amountCents: Math.round(input.amountCents),
    effectiveAt: Number(input.effectiveAtMs || now),
    note: input.note ? String(input.note).trim() : null,
    createdAt: now,
  };
  await db.insert('treasury_opening_balances', {
    local_id: openingLocalId,
    server_id: null,
    treasury_account_id: String(account.local_id),
    amount_cents: Math.round(input.amountCents),
    effective_at: Number(input.effectiveAtMs || now),
    note: input.note ? String(input.note).trim() : null,
    created_by_user_id: useAuthStore.getState().subUser?.id || null,
    created_at: now,
    synced: 0,
    data: JSON.stringify(openingPayload),
  });
  await syncService.queueOperation(
    'treasury_opening_balance',
    'create',
    openingPayload,
    openingLocalId
  );
}

type BalanceByAccountMap = Map<string, { inCents: number; outCents: number }>;

function addMovementBalance(map: BalanceByAccountMap, movement: TreasuryMovement) {
  const current = map.get(movement.treasuryAccountId) || { inCents: 0, outCents: 0 };
  if (movement.direction === 'IN') current.inCents += movement.amountCents;
  else current.outCents += movement.amountCents;
  map.set(movement.treasuryAccountId, current);
}

async function buildAllTreasuryMovementsUntil(toMs: number, canReverseTransfers: boolean): Promise<{
  accountById: Map<string, TreasuryAccount>;
  movements: TreasuryMovement[];
}> {
  await ensureDefaultCashTreasuryAccount();
  const accounts = await listTreasuryAccounts(true);
  const accountById = new Map(accounts.map((account) => [account.localId, account]));
  const accountByLookupId = new Map<string, TreasuryAccount>();
  for (const account of accounts) {
    accountByLookupId.set(account.localId, account);
    if (account.serverId) accountByLookupId.set(account.serverId, account);
  }

  const allCashRows = await db.query<any>(
    `SELECT local_id, server_id, name, type, is_active, created_at, updated_at, synced, data
     FROM treasury_accounts
     WHERE type = 'CAJA'
       AND lower(name) = lower(?)
     ORDER BY is_active DESC, created_at ASC`,
    [DEFAULT_CASH_ACCOUNT_NAME]
  );
  const allCashAccounts = allCashRows.map(mapTreasuryAccountRow);
  const canonicalCash = pickCanonicalCashAccount(allCashAccounts);
  const cashAliasToCanonicalLocalId = new Map<string, string>();
  if (canonicalCash) {
    for (const account of allCashAccounts) {
      if (account.localId === canonicalCash.localId) continue;
      cashAliasToCanonicalLocalId.set(account.localId, canonicalCash.localId);
      if (account.serverId) {
        cashAliasToCanonicalLocalId.set(account.serverId, canonicalCash.localId);
      }
    }
  }

  const resolveAccountByAnyId = (rawId: string): TreasuryAccount | null => {
    const lookup = String(rawId || '').trim();
    if (!lookup) return null;
    const direct = accountByLookupId.get(lookup);
    if (direct) return direct;
    const canonicalLocalId = cashAliasToCanonicalLocalId.get(lookup);
    if (!canonicalLocalId) return null;
    return accountByLookupId.get(canonicalLocalId) || null;
  };
  const movements: TreasuryMovement[] = [];

  const openingRows = await db.query<any>(
    `SELECT *
     FROM treasury_opening_balances
     WHERE effective_at <= ?
     ORDER BY effective_at ASC`,
    [toMs]
  );
  for (const row of openingRows) {
    const accountId = String(row.treasury_account_id || '');
    const account = resolveAccountByAnyId(accountId);
    if (!account) continue;
    const amountCents = Number(row.amount_cents || 0);
    const occurredAt = Number(row.effective_at || row.created_at || Date.now());
    movements.push({
      id: `opening:${row.local_id}`,
      source: 'OPENING_BALANCE',
      direction: amountCents >= 0 ? 'IN' : 'OUT',
      amountCents: Math.abs(amountCents),
      occurredAt,
      method: null,
      treasuryAccountId: account.localId,
      treasuryAccountName: account.name,
      reference: 'Saldo inicial',
      note: row.note ? String(row.note) : null,
    });
  }

  const saleRows = await db.query<any>('SELECT local_id, invoice_code, total_cents, data FROM sales');
  for (const row of saleRows) {
    const parsed = parseJsonSafe<any>(row.data) || {};
    if (isSaleCancelled(parsed)) continue;
    const saleType = String(parsed.type || '').toUpperCase();
    if (saleType === 'CREDITO') continue;
    const occurredAt = normalizeDateMs(parsed.soldAt ?? parsed.createdAt ?? parsed.date);
    if (occurredAt > toMs) continue;
    const paymentSplits = Array.isArray(parsed.paymentSplits) ? parsed.paymentSplits : [];
    if (paymentSplits.length > 0) {
      for (const split of paymentSplits) {
        const accountId = String(split?.treasuryAccountId || '').trim();
        if (!accountId) continue;
        const account = resolveAccountByAnyId(accountId);
        if (!account) continue;
        const amountCents = Math.round(Number(split?.amountCents || 0));
        if (amountCents <= 0) continue;
        const method = normalizeMethod(split?.method || parsed.paymentMethod);
        const transferBankName =
          method === 'TRANSFERENCIA'
            ? getAccountTransferBankName(account)
            : split?.transferBankName
              ? String(split.transferBankName)
              : null;
        movements.push({
          id: `sale-split:${row.local_id}:${accountId}:${amountCents}`,
          source: 'SALE_CASH',
          direction: 'IN',
          amountCents,
          occurredAt,
          method: method || null,
          treasuryAccountId: account.localId,
          treasuryAccountName: account.name,
          reference: String(parsed.invoiceCode || row.invoice_code || 'Venta'),
          note: transferBankName,
        });
      }
      continue;
    }

    const accountId = String(parsed.treasuryAccountId || '').trim();
    if (!accountId) continue;
    const account = resolveAccountByAnyId(accountId);
    if (!account) continue;
    const amountCents = Math.round(Number(parsed.totalCents || row.total_cents || 0));
    if (amountCents <= 0) continue;
    const method = normalizeMethod(parsed.paymentMethod);
    const transferBankName =
      method === 'TRANSFERENCIA'
        ? getAccountTransferBankName(account)
        : parsed.transferBankName
          ? String(parsed.transferBankName)
          : null;
    movements.push({
      id: `sale:${row.local_id}`,
      source: 'SALE_CASH',
      direction: 'IN',
      amountCents,
      occurredAt,
      method: method || null,
      treasuryAccountId: account.localId,
      treasuryAccountName: account.name,
      reference: String(parsed.invoiceCode || row.invoice_code || 'Venta'),
      note: transferBankName,
    });
  }

  const paymentRows = await db.query<any>('SELECT local_id, receipt_code, amount_cents, data FROM payments');
  for (const row of paymentRows) {
    const parsed = parseJsonSafe<any>(row.data) || {};
    if (parsed.cancel === true || parsed.cancelledAt) continue;
    const accountId = String(parsed.treasuryAccountId || '').trim();
    if (!accountId) continue;
    const account = resolveAccountByAnyId(accountId);
    if (!account) continue;
    const occurredAt = normalizeDateMs(parsed.paidAt ?? parsed.createdAt);
    if (occurredAt > toMs) continue;
    const amountCents = Math.round(Number(parsed.amountCents || row.amount_cents || 0));
    if (amountCents <= 0) continue;
    const method = normalizeMethod(parsed.method || parsed.paymentMethod);
    const transferBankName =
      method === 'TRANSFERENCIA'
        ? getAccountTransferBankName(account)
        : parsed.transferBankName
          ? String(parsed.transferBankName)
          : null;
    movements.push({
      id: `payment:${row.local_id}`,
      source: 'AR_PAYMENT',
      direction: 'IN',
      amountCents,
      occurredAt,
      method: method || null,
      treasuryAccountId: account.localId,
      treasuryAccountName: account.name,
      reference: String(parsed.receiptCode || row.receipt_code || 'Recibo'),
      note: transferBankName,
    });
  }

  const purchaseRows = await db.query<any>('SELECT local_id, total_cents, purchased_at, data FROM purchases');
  for (const row of purchaseRows) {
    const parsed = parseJsonSafe<any>(row.data) || {};
    if (parsed.cancelledAt) continue;
    const accountId = String(parsed.treasuryAccountId || '').trim();
    if (!accountId) continue;
    const account = resolveAccountByAnyId(accountId);
    if (!account) continue;
    const occurredAt = normalizeDateMs(parsed.purchasedAt ?? row.purchased_at);
    if (occurredAt > toMs) continue;
    const amountCents = Math.round(Number(parsed.totalCents || row.total_cents || 0));
    if (amountCents <= 0) continue;
    movements.push({
      id: `purchase:${row.local_id}`,
      source: 'PURCHASE',
      direction: 'OUT',
      amountCents,
      occurredAt,
      method: normalizeMethod(parsed.paymentMethod) || null,
      treasuryAccountId: account.localId,
      treasuryAccountName: account.name,
      reference: 'Compra',
      note: parsed.supplierName ? String(parsed.supplierName) : null,
    });
  }

  const expenseRows = await db.query<any>('SELECT local_id, amount_cents, expense_date, description, data FROM operating_expenses');
  for (const row of expenseRows) {
    const parsed = parseJsonSafe<any>(row.data) || {};
    const accountId = String(parsed.treasuryAccountId || '').trim();
    if (!accountId) continue;
    const account = resolveAccountByAnyId(accountId);
    if (!account) continue;
    const occurredAt = normalizeDateMs(parsed.expenseDate ?? row.expense_date);
    if (occurredAt > toMs) continue;
    const amountCents = Math.round(Number(parsed.amountCents || row.amount_cents || 0));
    if (amountCents <= 0) continue;
    movements.push({
      id: `expense:${row.local_id}`,
      source: 'OPERATING_EXPENSE',
      direction: 'OUT',
      amountCents,
      occurredAt,
      method: normalizeMethod(parsed.paymentMethod) || null,
      treasuryAccountId: account.localId,
      treasuryAccountName: account.name,
      reference: 'Gasto',
      note: parsed.description ? String(parsed.description) : row.description ? String(row.description) : null,
    });
  }

  const returnRows = await db.query<any>('SELECT local_id, total_cents, returned_at, return_code, data FROM returns');
  for (const row of returnRows) {
    const parsed = parseJsonSafe<any>(row.data) || {};
    if (parsed.cancelledAt) continue;
    const accountId = String(parsed.refundTreasuryAccountId || '').trim();
    if (!accountId) continue;
    const account = resolveAccountByAnyId(accountId);
    if (!account) continue;
    const occurredAt = normalizeDateMs(parsed.returnedAt ?? row.returned_at);
    if (occurredAt > toMs) continue;
    const amountCents = Math.round(Number(parsed.totalCents || row.total_cents || 0));
    if (amountCents <= 0) continue;
    movements.push({
      id: `return:${row.local_id}`,
      source: 'CASH_RETURN',
      direction: 'OUT',
      amountCents,
      occurredAt,
      method: normalizeMethod(parsed.refundMethod) || null,
      treasuryAccountId: account.localId,
      treasuryAccountName: account.name,
      reference: String(parsed.returnCode || row.return_code || 'Devolución'),
      note: null,
    });
  }

  const transferRows = await db.query<any>(
    `SELECT *
     FROM treasury_transfers
     WHERE transferred_at <= ?
     ORDER BY transferred_at ASC, created_at ASC`,
    [toMs]
  );

  const reversedByMap = new Map<string, string>();
  for (const row of transferRows) {
    const reversesId = String(row.reverses_transfer_id || '').trim();
    if (reversesId) {
      reversedByMap.set(reversesId, String(row.local_id));
    }
  }

  for (const row of transferRows) {
    const fromAccountId = String(row.from_treasury_account_id || '');
    const toAccountId = String(row.to_treasury_account_id || '');
    const fromAccount = resolveAccountByAnyId(fromAccountId);
    const toAccount = resolveAccountByAnyId(toAccountId);
    if (!fromAccount || !toAccount) continue;

    const amountCents = Math.max(0, Math.round(Number(row.amount_cents || 0)));
    if (amountCents <= 0) continue;
    const transferredAt = normalizeDateMs(row.transferred_at || row.created_at);
    const transferId = String(row.local_id);
    const reference = formatTransferReference(transferId);
    const reversesTransferId = String(row.reverses_transfer_id || '').trim() || null;
    const reversedByTransferId = reversedByMap.get(transferId) || null;
    const reversalTrace = reversesTransferId
      ? `Revierte ${formatTransferReference(reversesTransferId)}`
      : reversedByTransferId
        ? `Revertida por ${formatTransferReference(reversedByTransferId)}`
        : null;
    const transferStatus = (String(row.status || 'ACTIVE').toUpperCase() as TreasuryTransferStatus) === 'REVERSED' ? 'REVERSED' : 'ACTIVE';
    const canReverseTransfer =
      canReverseTransfers &&
      transferStatus === 'ACTIVE' &&
      !reversesTransferId &&
      !reversedByTransferId;

    movements.push({
      id: `transfer-out:${transferId}`,
      source: 'TREASURY_TRANSFER',
      direction: 'OUT',
      amountCents,
      occurredAt: transferredAt,
      method: null,
      treasuryAccountId: fromAccount.localId,
      treasuryAccountName: fromAccount.name,
      reference,
      note: row.note ? String(row.note) : null,
      transferId,
      transferStatus,
      transferTrace: reversalTrace ? `Hacia ${toAccount.name} · ${reversalTrace}` : `Hacia ${toAccount.name}`,
      canReverseTransfer,
    });

    movements.push({
      id: `transfer-in:${transferId}`,
      source: 'TREASURY_TRANSFER',
      direction: 'IN',
      amountCents,
      occurredAt: transferredAt,
      method: null,
      treasuryAccountId: toAccount.localId,
      treasuryAccountName: toAccount.name,
      reference,
      note: row.note ? String(row.note) : null,
      transferId,
      transferStatus,
      transferTrace: reversalTrace ? `Desde ${fromAccount.name} · ${reversalTrace}` : `Desde ${fromAccount.name}`,
      canReverseTransfer: false,
    });
  }

  return { accountById, movements };
}

async function getTreasuryAccountBalanceUntil(input: { treasuryAccountId: string; atMs: number }): Promise<number> {
  const permissions = getTreasuryPermissions();
  const { movements } = await buildAllTreasuryMovementsUntil(input.atMs, permissions.canReverseTransfers);
  return movements
    .filter((movement) => movement.treasuryAccountId === input.treasuryAccountId)
    .reduce((sum, movement) => sum + (movement.direction === 'IN' ? movement.amountCents : -movement.amountCents), 0);
}

export async function previewTreasuryTransfer(input: {
  fromTreasuryAccountId: string;
  toTreasuryAccountId: string;
  amountCents: number;
  transferredAtMs?: number;
}) {
  const amountCents = Math.round(Number(input.amountCents || 0));
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('El monto debe ser mayor que cero');
  }
  if (input.fromTreasuryAccountId === input.toTreasuryAccountId) {
    throw new Error('La cuenta de origen y destino deben ser diferentes');
  }

  const accounts = await listTreasuryAccounts(true);
  const fromAccount = accounts.find(
    (account) => account.localId === input.fromTreasuryAccountId || account.serverId === input.fromTreasuryAccountId
  );
  const toAccount = accounts.find(
    (account) => account.localId === input.toTreasuryAccountId || account.serverId === input.toTreasuryAccountId
  );
  if (!fromAccount || !fromAccount.isActive) throw new Error('Cuenta de origen no encontrada o inactiva');
  if (!toAccount || !toAccount.isActive) throw new Error('Cuenta de destino no encontrada o inactiva');

  const transferredAtMs = normalizeDateMs(input.transferredAtMs || Date.now());
  const sourceBalanceCents = await getTreasuryAccountBalanceUntil({
    treasuryAccountId: fromAccount.localId,
    atMs: transferredAtMs,
  });
  const projectedSourceBalanceCents = sourceBalanceCents - amountCents;

  return {
    fromTreasuryAccountId: fromAccount.localId,
    fromTreasuryAccountName: fromAccount.name,
    toTreasuryAccountId: toAccount.localId,
    toTreasuryAccountName: toAccount.name,
    amountCents,
    transferredAtMs,
    sourceBalanceCents,
    projectedSourceBalanceCents,
    willBeNegative: projectedSourceBalanceCents < 0,
  };
}

export async function createTreasuryTransfer(input: {
  fromTreasuryAccountId: string;
  toTreasuryAccountId: string;
  amountCents: number;
  transferredAtMs?: number;
  note?: string | null;
}): Promise<TreasuryTransfer> {
  const preview = await previewTreasuryTransfer(input);
  const now = Date.now();
  const localId = generateLocalId();
  const payload = {
    localId,
    fromTreasuryAccountId: preview.fromTreasuryAccountId,
    toTreasuryAccountId: preview.toTreasuryAccountId,
    amountCents: preview.amountCents,
    transferredAt: preview.transferredAtMs,
    note: input.note ? String(input.note).trim() : null,
    createdByUserId: useAuthStore.getState().subUser?.id || null,
    status: 'ACTIVE' as TreasuryTransferStatus,
    reversesTransferId: null,
    reversedByUserId: null,
    reversedAt: null,
    reverseReason: null,
    createdAt: now,
  };

  await db.insert('treasury_transfers', {
    local_id: payload.localId,
    server_id: null,
    account_id: useAuthStore.getState().accountId || null,
    from_treasury_account_id: payload.fromTreasuryAccountId,
    to_treasury_account_id: payload.toTreasuryAccountId,
    amount_cents: payload.amountCents,
    transferred_at: payload.transferredAt,
    note: payload.note,
    created_by_user_id: payload.createdByUserId,
    status: payload.status,
    reverses_transfer_id: payload.reversesTransferId,
    reversed_by_user_id: payload.reversedByUserId,
    reversed_at: payload.reversedAt,
    reverse_reason: payload.reverseReason,
    created_at: payload.createdAt,
    synced: 0,
    data: JSON.stringify(payload),
  });

  await syncService.queueOperation(
    'treasury_transfer',
    'create',
    {
      ...payload,
      id: null,
    },
    localId
  );

  const row = await db.queryFirst<any>('SELECT * FROM treasury_transfers WHERE local_id = ? LIMIT 1', [localId]);
  return mapTreasuryTransferRow(row);
}

function mapTreasuryTransferRow(row: any): TreasuryTransfer {
  const parsed = parseJsonSafe<any>(row?.data);
  return {
    localId: String(row.local_id),
    serverId: row.server_id ? String(row.server_id) : null,
    accountId: row.account_id ? String(row.account_id) : parsed?.accountId ? String(parsed.accountId) : null,
    fromTreasuryAccountId: String(row.from_treasury_account_id || parsed?.fromTreasuryAccountId || ''),
    toTreasuryAccountId: String(row.to_treasury_account_id || parsed?.toTreasuryAccountId || ''),
    amountCents: Number(row.amount_cents || parsed?.amountCents || 0),
    transferredAt: Number(row.transferred_at || parsed?.transferredAt || 0),
    note: row.note ? String(row.note) : parsed?.note ? String(parsed.note) : null,
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : parsed?.createdByUserId ? String(parsed.createdByUserId) : null,
    status: (String(row.status || parsed?.status || 'ACTIVE').toUpperCase() as TreasuryTransferStatus) === 'REVERSED' ? 'REVERSED' : 'ACTIVE',
    reversesTransferId: row.reverses_transfer_id ? String(row.reverses_transfer_id) : parsed?.reversesTransferId ? String(parsed.reversesTransferId) : null,
    reversedByUserId: row.reversed_by_user_id ? String(row.reversed_by_user_id) : parsed?.reversedByUserId ? String(parsed.reversedByUserId) : null,
    reversedAt: row.reversed_at ? Number(row.reversed_at) : parsed?.reversedAt ? Number(parsed.reversedAt) : null,
    reverseReason: row.reverse_reason ? String(row.reverse_reason) : parsed?.reverseReason ? String(parsed.reverseReason) : null,
    createdAt: Number(row.created_at || parsed?.createdAt || Date.now()),
    synced: Number(row.synced ?? 0) === 1,
    data: String(row.data || '{}'),
  };
}

export async function reverseTreasuryTransfer(input: {
  transferId: string;
  reason: string;
  reversedAtMs?: number;
}) {
  const transferId = String(input.transferId || '').trim();
  const reason = String(input.reason || '').trim();
  if (!transferId) throw new Error('Transferencia no encontrada');
  if (!reason) throw new Error('Debes indicar el motivo del reverso');

  const originalRow = await db.queryFirst<any>(
    'SELECT * FROM treasury_transfers WHERE local_id = ? OR server_id = ? LIMIT 1',
    [transferId, transferId]
  );
  if (!originalRow) throw new Error('Transferencia no encontrada');

  const original = mapTreasuryTransferRow(originalRow);
  if (original.reversesTransferId) {
    throw new Error('No se puede reversar una transferencia que ya es reverso');
  }
  if (original.status !== 'ACTIVE') {
    throw new Error('La transferencia ya fue reversada');
  }

  const existingReverse = await db.queryFirst<{ local_id?: string }>(
    'SELECT local_id FROM treasury_transfers WHERE reverses_transfer_id = ? LIMIT 1',
    [original.localId]
  );
  if (existingReverse?.local_id) {
    throw new Error('La transferencia ya fue reversada');
  }

  const now = Date.now();
  const reverseAt = normalizeDateMs(input.reversedAtMs || now);
  const reverseLocalId = generateLocalId();
  const reversePayload = {
    localId: reverseLocalId,
    fromTreasuryAccountId: original.toTreasuryAccountId,
    toTreasuryAccountId: original.fromTreasuryAccountId,
    amountCents: original.amountCents,
    transferredAt: reverseAt,
    note: `Reverso de ${formatTransferReference(original.localId)}. Motivo: ${reason}`,
    createdByUserId: useAuthStore.getState().subUser?.id || null,
    status: 'ACTIVE' as TreasuryTransferStatus,
    reversesTransferId: original.localId,
    reversedByUserId: null,
    reversedAt: null,
    reverseReason: null,
    createdAt: now,
  };

  await db.insert('treasury_transfers', {
    local_id: reversePayload.localId,
    server_id: null,
    account_id: useAuthStore.getState().accountId || null,
    from_treasury_account_id: reversePayload.fromTreasuryAccountId,
    to_treasury_account_id: reversePayload.toTreasuryAccountId,
    amount_cents: reversePayload.amountCents,
    transferred_at: reversePayload.transferredAt,
    note: reversePayload.note,
    created_by_user_id: reversePayload.createdByUserId,
    status: reversePayload.status,
    reverses_transfer_id: reversePayload.reversesTransferId,
    reversed_by_user_id: reversePayload.reversedByUserId,
    reversed_at: reversePayload.reversedAt,
    reverse_reason: reversePayload.reverseReason,
    created_at: reversePayload.createdAt,
    synced: 0,
    data: JSON.stringify(reversePayload),
  });

  const nextOriginalPayload = {
    ...(parseJsonSafe<any>(original.data) || {}),
    status: 'REVERSED',
    reversedByUserId: useAuthStore.getState().subUser?.id || null,
    reversedAt: reverseAt,
    reverseReason: reason,
  };

  await db.update('treasury_transfers', original.localId, {
    status: 'REVERSED',
    reversed_by_user_id: useAuthStore.getState().subUser?.id || null,
    reversed_at: reverseAt,
    reverse_reason: reason,
    synced: 0,
    data: JSON.stringify(nextOriginalPayload),
  });

  await syncService.queueOperation(
    'treasury_transfer_reverse',
    'create',
    {
      transferId: original.localId,
      reason,
      reversedAt: reverseAt,
      reverseLocalId,
    },
    original.localId
  );

  return {
    originalId: original.localId,
    reverseId: reverseLocalId,
    originalReference: formatTransferReference(original.localId),
    reverseReference: formatTransferReference(reverseLocalId),
  };
}

export async function getTreasuryDashboard(input?: DateRangeInput): Promise<TreasuryDashboardResult> {
  const now = Date.now();
  const fromMs = Number(input?.fromMs || startOfDayMs(now));
  const toMs = Number(input?.toMs || endOfDayMs(now));
  const permissions = getTreasuryPermissions();
  const { movements, accountById } = await buildAllTreasuryMovementsUntil(toMs, permissions.canReverseTransfers);

  const balancesByAccount: BalanceByAccountMap = new Map();
  for (const movement of movements) {
    addMovementBalance(balancesByAccount, movement);
  }

  const accounts: TreasuryDashboardAccount[] = Array.from(accountById.values()).map((account) => {
    const totals = balancesByAccount.get(account.localId) || { inCents: 0, outCents: 0 };
    return {
      id: account.localId,
      name: account.name,
      type: account.type,
      currency: account.currency,
      bankName: account.bankName || null,
      accountNumber: account.accountNumber || null,
      isActive: account.isActive,
      inCents: totals.inCents,
      outCents: totals.outCents,
      balanceCents: totals.inCents - totals.outCents,
    };
  });

  const periodMovements = movements
    .filter((movement) => movementTimeInRange(movement.occurredAt, fromMs, toMs))
    .sort((a, b) => b.occurredAt - a.occurredAt);

  const totals = {
    inCents: periodMovements
      .filter((movement) => movement.direction === 'IN')
      .reduce((sum, movement) => sum + movement.amountCents, 0),
    outCents: periodMovements
      .filter((movement) => movement.direction === 'OUT')
      .reduce((sum, movement) => sum + movement.amountCents, 0),
    balanceCents: accounts.reduce((sum, account) => sum + account.balanceCents, 0),
  };

  return {
    fromMs,
    toMs,
    accounts,
    movements: periodMovements,
    totals,
  };
}

function startOfDayMs(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDayMs(value: number): number {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}
