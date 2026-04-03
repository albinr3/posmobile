import { SaleItem, SalePaymentSplit } from '../types';
import { BaseCartState, createCartStore } from './createCartStore';

interface CartExtraState {
  paymentMethod: string;
  transferBankName: string | null;
  paymentSplits: SalePaymentSplit[];
  shippingCents: number;
  editingSaleLocalId: string | null;
  editingInvoiceCode: string | null;
  setPaymentMethod: (method: string) => void;
  setTransferBankName: (bankName: string | null) => void;
  setPaymentSplits: (splits: SalePaymentSplit[]) => void;
  setShippingCents: (shippingCents: number) => void;
  loadInvoiceForEdit: (params: {
    items: SaleItem[];
    customerId: string | null;
    customerName: string | null;
    customerVisualId?: number | null;
    paymentMethod: string;
    transferBankName?: string | null;
    paymentSplits?: SalePaymentSplit[];
    shippingCents?: number;
    customerSaleDiscountPercentBp?: number | null;
    discountPercentBp?: number | null;
    discountWasManual?: boolean;
    saleLocalId: string;
    invoiceCode: string;
  }) => void;
  clearEditContext: () => void;
}

type CartState = BaseCartState & CartExtraState;

export const useCartStore = createCartStore<CartExtraState>((set) => ({
  paymentMethod: 'EFECTIVO',
  transferBankName: null,
  paymentSplits: [],
  shippingCents: 0,
  editingSaleLocalId: null,
  editingInvoiceCode: null,

  setPaymentMethod: (method: string) => {
    set({ paymentMethod: method });
  },

  setTransferBankName: (bankName: string | null) => {
    set({ transferBankName: bankName });
  },

  setPaymentSplits: (splits: SalePaymentSplit[]) => {
    set({ paymentSplits: splits });
  },

  setShippingCents: (shippingCents: number) => {
    const nextShippingCents = Number.isFinite(shippingCents) ? Math.max(0, Math.round(shippingCents)) : 0;
    set({ shippingCents: nextShippingCents });
  },

  loadInvoiceForEdit: ({
    items,
    customerId,
    customerName,
    customerVisualId,
    paymentMethod,
    transferBankName,
    paymentSplits,
    shippingCents,
    customerSaleDiscountPercentBp,
    discountPercentBp,
    discountWasManual,
    saleLocalId,
    invoiceCode,
  }) => {
    set({
      items,
      customerId,
      customerName,
      customerVisualId: customerVisualId ?? null,
      paymentMethod: paymentMethod || 'EFECTIVO',
      transferBankName: transferBankName || null,
      paymentSplits: Array.isArray(paymentSplits) ? paymentSplits : [],
      shippingCents: Number.isFinite(shippingCents) ? Math.max(0, Math.round(shippingCents || 0)) : 0,
      customerSaleDiscountPercentBp: Number.isFinite(Number(customerSaleDiscountPercentBp))
        ? Math.max(0, Math.min(10000, Math.round(Number(customerSaleDiscountPercentBp))))
        : null,
      discountPercentBp: Number.isFinite(Number(discountPercentBp))
        ? Math.max(0, Math.min(10000, Math.round(Number(discountPercentBp))))
        : null,
      discountWasManual: discountWasManual === true,
      editingSaleLocalId: saleLocalId,
      editingInvoiceCode: invoiceCode,
    });
  },

  clearEditContext: () => {
    set({
      editingSaleLocalId: null,
      editingInvoiceCode: null,
    });
  },

  clear: () => {
    set({
      items: [],
      customerId: null,
      customerName: null,
      customerVisualId: null,
      paymentMethod: 'EFECTIVO',
      transferBankName: null,
      paymentSplits: [],
      shippingCents: 0,
      customerSaleDiscountPercentBp: null,
      discountPercentBp: null,
      discountWasManual: false,
      editingSaleLocalId: null,
      editingInvoiceCode: null,
    });
  },
}));

export type { CartState };
