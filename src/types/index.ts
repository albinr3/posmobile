// Tipos principales de la aplicación

export interface Product {
  localId: string;
  serverId?: string;
  name: string;
  sku?: string;
  reference?: string | null;
  priceCents: number;
  costCents?: number;
  stock: number;
  unit?: string;
  productKind?: 'BASIC' | 'MEASURED' | 'RECIPE';
  isActive?: boolean;
  imageUrl?: string;
  categoryId?: string;
  synced: boolean;
  data: string;
}

export interface Customer {
  localId: string;
  serverId?: string;
  visualId?: number | null;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimit?: number;
  saleDiscountPercentBp?: number;
  synced: boolean;
  data: string;
}

export type DocumentDiscountSource = 'NONE' | 'CUSTOMER' | 'MANUAL';

export interface Sale {
  localId: string;
  serverId?: string;
  invoiceCode: string;
  customerId?: string;
  totalCents: number;
  status: 'pending' | 'completed' | 'cancelled';
  items: SaleItem[];
  paymentMethod?: string;
  transferBankName?: string | null;
  paymentSplits?: SalePaymentSplit[];
  salePricesIncludeItbis?: boolean;
  subtotalCents?: number;
  itbisCents?: number;
  shippingCents?: number;
  applyLegalTip?: boolean;
  legalTipApplied?: boolean;
  legalTipPercentBp?: number;
  legalTipBaseCents?: number;
  legalTipCents?: number;
  discountSource?: DocumentDiscountSource;
  discountPercentBp?: number;
  discountSubtotalCents?: number;
  discountTotalCents?: number;
  createdAt: number;
  synced: boolean;
  data: string;
}

export interface SaleItem {
  lineId: string;
  productId: string;
  productName: string;
  sku?: string;
  reference?: string | null;
  quantity: number;
  priceCents: number;
  totalCents: number;
  wasPriceOverridden?: boolean;
  itbisRateBp?: number;
  unit?: string;
  productKind?: 'BASIC' | 'MEASURED' | 'RECIPE';
  recipeItems?: Array<{ ingredientId: string; ingredientName: string; qty: number; ingredientUnit?: string }>;
  recipeAdjustments?: Array<{ ingredientId: string; ingredientName: string; adjustmentType: 'SIN' | 'EXTRA' }>;
}

export interface Payment {
  localId: string;
  serverId?: string;
  receiptCode: string;
  amountCents: number;
  arId?: string;
  customerId?: string;
  method: string;
  transferBankName?: string | null;
  treasuryAccountId?: string | null;
  synced: boolean;
  data: string;
}

export interface SalePaymentSplit {
  method: string;
  amountCents: number;
  transferBankName?: string | null;
  treasuryAccountId?: string | null;
}

export interface AccountReceivable {
  localId: string;
  serverId?: string;
  customerId: string;
  customerVisualId?: number | null;
  customerName: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: 'PENDIENTE' | 'PARCIAL' | 'PAGADO';
  dueDate?: number;
  synced: boolean;
  data: string;
}

export interface SyncQueueItem {
  id: number;
  entityType: string;
  entityLocalId: string;
  action: 'create' | 'update' | 'delete';
  data: string;
  status: 'pending' | 'syncing' | 'synced' | 'error';
  retryCount: number;
  createdAt: number;
  syncedAt?: number;
}

export interface User {
  id: string;
  email?: string;
  phone?: string;
  name: string;
  companyId: string;
  role: string;
}

export type TreasuryAccountType = 'CAJA' | 'BANCO';
export type TreasuryTransferStatus = 'ACTIVE' | 'REVERSED';
export type TreasuryMovementSource =
  | 'OPENING_BALANCE'
  | 'SALE_CASH'
  | 'AR_PAYMENT'
  | 'PURCHASE'
  | 'OPERATING_EXPENSE'
  | 'CASH_RETURN'
  | 'TREASURY_TRANSFER';
export type TreasuryMovementDirection = 'IN' | 'OUT';

export interface TreasuryAccount {
  localId: string;
  serverId?: string | null;
  name: string;
  type: TreasuryAccountType;
  currency: string;
  bankName?: string | null;
  accountNumber?: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  synced: boolean;
  data: string;
}

export interface TreasuryOpeningBalance {
  localId: string;
  serverId?: string | null;
  treasuryAccountId: string;
  amountCents: number;
  effectiveAt: number;
  note?: string | null;
  createdByUserId?: string | null;
  createdAt: number;
  synced: boolean;
  data: string;
}

export interface TreasuryTransfer {
  localId: string;
  serverId?: string | null;
  accountId?: string | null;
  fromTreasuryAccountId: string;
  toTreasuryAccountId: string;
  amountCents: number;
  transferredAt: number;
  note?: string | null;
  createdByUserId?: string | null;
  status: TreasuryTransferStatus;
  reversesTransferId?: string | null;
  reversedByUserId?: string | null;
  reversedAt?: number | null;
  reverseReason?: string | null;
  createdAt: number;
  synced: boolean;
  data: string;
}

export interface TreasuryMovement {
  id: string;
  source: TreasuryMovementSource;
  direction: TreasuryMovementDirection;
  amountCents: number;
  occurredAt: number;
  method: string | null;
  treasuryAccountId: string;
  treasuryAccountName: string;
  reference: string;
  note?: string | null;
  transferId?: string;
  transferStatus?: TreasuryTransferStatus | null;
  transferTrace?: string | null;
  canReverseTransfer?: boolean;
}
