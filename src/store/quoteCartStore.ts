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
}));

export type { QuoteCartState };

