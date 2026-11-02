import axios from 'axios';
import { cashHeaders } from '../cash/cashShiftService';
import { syncService } from '../sync/SyncService';
import { API_URL } from '../sync/syncShared';

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';
export type PayableStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADA';
export type Payable = {
  id: string; purchaseId: string; supplierId: string; totalCents: number; balanceCents: number;
  paidCents: number; dueDate: string; status: PayableStatus; overdue: boolean; overdueDays: number;
  supplier: { id: string; name: string; isActive: boolean };
  purchase: { id: string; supplierName: string | null; notes: string | null; cancelledAt: string | null };
};
export type SupplierPayment = {
  id: string; amountCents: number; method: PaymentMethod; note: string | null; reference: string;
  paidAt: string; cancelledAt: string | null; cancellationReason: string | null;
  user: { name: string }; treasuryAccount: { id: string; name: string };
};
export type PayableDetail = Payable & { payments: SupplierPayment[] };
export type PayablesPage = {
  data: Payable[]; nextSkip: number | null;
  summary: { count: number; totalCents: number; balanceCents: number; overdueCents: number };
  providers: Array<{ supplierId: string; name: string; totalCents: number; balanceCents: number; count: number }>;
};
export type PaymentOptions = {
  methods: PaymentMethod[];
  accounts: Array<{ id: string; name: string; type: 'CAJA' | 'BANCO'; currency: string; cashControlEnabled: boolean; cashControlled: boolean }>;
};
export type CreditPurchaseInput = {
  type: 'CREDITO'; supplierId: string; supplierName: string; dueDate: string; initialPaymentCents: number;
  paymentMethod?: PaymentMethod; treasuryAccountId?: string; notes: string | null;
  updateProductCost: boolean; updateProductPrice: boolean;
  items: Array<{ productId: string; qty: number; unitCostCents: number; discountPercentBp?: number;
    saleMarginBp?: number; salePriceCents?: number; purchaseIncludesItbis?: boolean }>;
};

export function businessDate(): string {
  return new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
}
export function proposeDueDate(days: number): string {
  const safeDays = Number.isSafeInteger(days) && days >= 0 && days <= 3650 ? days : 0;
  return new Date(Date.parse(`${businessDate()}T00:00:00Z`) + safeDays * 86400000).toISOString().slice(0, 10);
}
export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseAmountCents(value: string): number {
  const raw = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return NaN;
  const result = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(result) ? result : NaN;
}
export function paymentAccounts(options: PaymentOptions, method: PaymentMethod) {
  const accounts = options.accounts.filter(account => account.currency === 'DOP' && account.type === (method === 'EFECTIVO' ? 'CAJA' : 'BANCO'));
  return method === 'EFECTIVO' && accounts.some(account => account.cashControlEnabled)
    ? accounts.filter(account => account.cashControlled)
    : accounts;
}

export class FinancialApiError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}
function message(error: unknown): Error {
  if (axios.isAxiosError(error)) return new FinancialApiError(String(error.response?.data?.error || error.message || 'No se pudo completar la operación.'), String(error.response?.data?.code || ''));
  return error instanceof Error ? error : new Error('No se pudo completar la operación.');
}
async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, data?: unknown): Promise<T> {
  try {
    await syncService.ensureSessionForFinancialRequest();
    const headers = { ...(await cashHeaders()), 'Content-Type': 'application/json' };
    // El middleware de compras lee esta cookie, mientras que caja lee X-Cash-Device-Token.
    const device = headers['X-Cash-Device-Token'];
    const response = await axios<T>({ method, url: `${API_URL}/api/${path}`, data, headers: { ...headers, Cookie: `movopos-cash-device=${device}` }, timeout: 25000 });
    return response.data;
  } catch (error) { throw message(error); }
}

export const purchaseCreditService = {
  listPayables: (filters: Record<string, string>, skip = 0) => request<PayablesPage>('GET', `accounts-payable?${Object.entries({ ...filters, skip: String(skip), take: '50' }).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`),
  getPayable: (id: string) => request<PayableDetail>('GET', `accounts-payable/${encodeURIComponent(id)}`),
  paymentOptions: () => request<PaymentOptions>('GET', 'supplier-payments/options'),
  getPurchase: (id: string) => request<any>('GET', `purchases/${encodeURIComponent(id)}`),
  patchPurchase: (id: string, body: { notes?: string | null; dueDate?: string }) => request<any>('PATCH', `purchases/${encodeURIComponent(id)}`, body),
  updatePurchase: (id: string, body: Record<string, unknown>) => request<any>('PUT', `purchases/${encodeURIComponent(id)}`, body),
  cancelPurchase: (id: string) => request<{ success: boolean }>('POST', `purchases/${encodeURIComponent(id)}/cancel`, {}),
  cancelPayment: (id: string, reason: string) => request<any>('POST', `supplier-payments/${encodeURIComponent(id)}/cancel`, { reason }),
  createCreditPurchase: (input: CreditPurchaseInput) => syncService.submitOnlineFinancial('credit_purchase', input),
  createSupplierPayment: (input: { apId: string; amountCents: number; method: PaymentMethod; treasuryAccountId: string; note?: string }) => syncService.submitOnlineFinancial('supplier_payment', input),
};
