import { SaleItem, SalePaymentSplit } from '../types';
import { BaseCartState, createCartStore } from './createCartStore';

interface CartExtraState {
  paymentMethod: string;
  transferBankName: string | null;
  paymentSplits: SalePaymentSplit[];
  editingSaleLocalId: string | null;
  editingInvoiceCode: string | null;
  setPaymentMethod: (method: string) => void;
  setTransferBankName: (bankName: string | null) => void;
  setPaymentSplits: (splits: SalePaymentSplit[]) => void;
  loadInvoiceForEdit: (params: {
    items: SaleItem[];
    customerId: string | null;
    customerName: string | null;
    paymentMethod: string;
    transferBankName?: string | null;
    paymentSplits?: SalePaymentSplit[];
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

  loadInvoiceForEdit: ({ items, customerId, customerName, paymentMethod, transferBankName, paymentSplits, saleLocalId, invoiceCode }) => {
    set({
      items,
      customerId,
      customerName,
      paymentMethod: paymentMethod || 'EFECTIVO',
      transferBankName: transferBankName || null,
      paymentSplits: Array.isArray(paymentSplits) ? paymentSplits : [],
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
      paymentMethod: 'EFECTIVO',
      transferBankName: null,
      paymentSplits: [],
      editingSaleLocalId: null,
      editingInvoiceCode: null,
    });
  },
}));

export type { CartState };

