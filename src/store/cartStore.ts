import { SaleItem } from '../types';
import { BaseCartState, createCartStore } from './createCartStore';

interface CartExtraState {
  paymentMethod: string;
  editingSaleLocalId: string | null;
  editingInvoiceCode: string | null;
  setPaymentMethod: (method: string) => void;
  loadInvoiceForEdit: (params: {
    items: SaleItem[];
    customerId: string | null;
    customerName: string | null;
    paymentMethod: string;
    saleLocalId: string;
    invoiceCode: string;
  }) => void;
  clearEditContext: () => void;
}

type CartState = BaseCartState & CartExtraState;

export const useCartStore = createCartStore<CartExtraState>((set) => ({
  paymentMethod: 'EFECTIVO',
  editingSaleLocalId: null,
  editingInvoiceCode: null,

  setPaymentMethod: (method: string) => {
    set({ paymentMethod: method });
  },

  loadInvoiceForEdit: ({ items, customerId, customerName, paymentMethod, saleLocalId, invoiceCode }) => {
    set({
      items,
      customerId,
      customerName,
      paymentMethod: paymentMethod || 'EFECTIVO',
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
      editingSaleLocalId: null,
      editingInvoiceCode: null,
    });
  },
}));

export type { CartState };

