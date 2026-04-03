import { SaleItem } from '../types';
import { BaseCartState, createCartStore } from './createCartStore';

interface QuoteCartExtraState {
  editingQuoteLocalId: string | null;
  editingQuoteServerId: string | null;
  editingQuoteCode: string | null;
  loadDraft: (draft: {
    items: SaleItem[];
    customerId: string | null;
    customerName: string | null;
    customerVisualId?: number | null;
    customerSaleDiscountPercentBp?: number | null;
    discountPercentBp?: number | null;
    discountWasManual?: boolean;
    editingQuoteLocalId: string;
    editingQuoteServerId: string | null;
    editingQuoteCode: string | null;
  }) => void;
  clearEditing: () => void;
}

type QuoteCartState = BaseCartState & QuoteCartExtraState;

export const useQuoteCartStore = createCartStore<QuoteCartExtraState>((set) => ({
  editingQuoteLocalId: null,
  editingQuoteServerId: null,
  editingQuoteCode: null,

  loadDraft: (draft) => {
    set({
      items: draft.items,
      customerId: draft.customerId,
      customerName: draft.customerName,
      customerVisualId: draft.customerVisualId ?? null,
      customerSaleDiscountPercentBp: Number.isFinite(Number(draft.customerSaleDiscountPercentBp))
        ? Math.max(0, Math.min(10000, Math.round(Number(draft.customerSaleDiscountPercentBp))))
        : null,
      discountPercentBp: Number.isFinite(Number(draft.discountPercentBp))
        ? Math.max(0, Math.min(10000, Math.round(Number(draft.discountPercentBp))))
        : null,
      discountWasManual: draft.discountWasManual === true,
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
      customerVisualId: null,
      customerSaleDiscountPercentBp: null,
      discountPercentBp: null,
      discountWasManual: false,
      editingQuoteLocalId: null,
      editingQuoteServerId: null,
      editingQuoteCode: null,
    });
  },
}));

export type { QuoteCartState };
