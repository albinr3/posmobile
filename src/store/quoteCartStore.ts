import { create } from 'zustand';
import { SaleItem, Product } from '../types';

interface QuoteCartState {
  items: SaleItem[];
  customerId: string | null;
  customerName: string | null;
  editingQuoteLocalId: string | null;
  editingQuoteServerId: string | null;
  editingQuoteCode: string | null;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setCustomer: (customerId: string | null, customerName: string | null) => void;
  loadDraft: (draft: {
    items: SaleItem[];
    customerId: string | null;
    customerName: string | null;
    editingQuoteLocalId: string;
    editingQuoteServerId: string | null;
    editingQuoteCode: string | null;
  }) => void;
  clearEditing: () => void;
  clear: () => void;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useQuoteCartStore = create<QuoteCartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  editingQuoteLocalId: null,
  editingQuoteServerId: null,
  editingQuoteCode: null,

  addItem: (product: Product, quantity: number = 1) => {
    set((state) => {
      const existingItem = state.items.find((item) => item.productId === product.localId);

      if (existingItem) {
        return {
          items: state.items.map((item) =>
            item.productId === product.localId
              ? {
                  ...item,
                  quantity: item.quantity + quantity,
                  totalCents: (item.quantity + quantity) * item.priceCents,
                }
              : item
          ),
        };
      }

      return {
        items: [
          ...state.items,
          {
            productId: product.localId,
            productName: product.name,
            quantity,
            priceCents: product.priceCents,
            totalCents: quantity * product.priceCents,
          },
        ],
      };
    });
  },

  removeItem: (productId: string) => {
    set((state) => ({
      items: state.items.filter((item) => item.productId !== productId),
    }));
  },

  updateQuantity: (productId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }

    set((state) => ({
      items: state.items.map((item) =>
        item.productId === productId
          ? {
              ...item,
              quantity,
              totalCents: quantity * item.priceCents,
            }
          : item
      ),
    }));
  },

  setCustomer: (customerId: string | null, customerName: string | null) => {
    set({ customerId, customerName });
  },

  loadDraft: (draft) => {
    set({
      items: draft.items,
      customerId: draft.customerId,
      customerName: draft.customerName,
      editingQuoteLocalId: draft.editingQuoteLocalId,
      editingQuoteServerId: draft.editingQuoteServerId,
      editingQuoteCode: draft.editingQuoteCode,
    });
  },

  clearEditing: () => {
    set({
      editingQuoteLocalId: null,
      editingQuoteServerId: null,
      editingQuoteCode: null,
    });
  },

  clear: () => {
    set({
      items: [],
      customerId: null,
      customerName: null,
      editingQuoteLocalId: null,
      editingQuoteServerId: null,
      editingQuoteCode: null,
    });
  },

  getTotal: () => {
    return get().items.reduce((sum, item) => sum + item.totalCents, 0);
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));

