// Tipos principales de la aplicación

export interface Product {
  localId: string;
  serverId?: string;
  name: string;
  sku?: string;
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
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimit?: number;
  synced: boolean;
  data: string;
}

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
  createdAt: number;
  synced: boolean;
  data: string;
}

export interface SaleItem {
  lineId: string;
  productId: string;
  productName: string;
  quantity: number;
  priceCents: number;
  totalCents: number;
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
  synced: boolean;
  data: string;
}

export interface SalePaymentSplit {
  method: string;
  amountCents: number;
  transferBankName?: string | null;
}

export interface AccountReceivable {
  localId: string;
  serverId?: string;
  customerId: string;
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
