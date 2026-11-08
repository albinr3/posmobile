import { createCartStore, createProductCartItem, type BaseCartState } from './createCartStore';
import type { CartState } from './cartStore';
import { PRACTICE_CATALOG } from '../services/onboarding/practiceCatalog';
import { PRACTICE_PRODUCTS, practiceQuantity, type PracticeQuantities } from '../services/onboarding/onboardingModel';

type Extra = Omit<CartState, keyof BaseCartState>;
const defaults = {
  notes: '', paymentMethod: 'EFECTIVO', transferBankName: null, treasuryAccountId: null,
  paymentSplits: [], shippingCents: 0, applyLegalTip: false,
  editingSaleLocalId: null, editingInvoiceCode: null,
};

// El mismo modelo de carrito que usa la caja, aislado de inventario, caja y facturas.
export const useTutorialCartStore = createCartStore<Extra>(set => ({
  ...defaults,
  setNotes: notes => set({ notes }),
  setPaymentMethod: paymentMethod => set({ paymentMethod }),
  setTransferBankName: transferBankName => set({ transferBankName }),
  setTreasuryAccountId: treasuryAccountId => set({ treasuryAccountId }),
  setPaymentSplits: paymentSplits => set({ paymentSplits }),
  setShippingCents: shippingCents => set({ shippingCents }),
  setApplyLegalTip: applyLegalTip => set({ applyLegalTip }),
  loadInvoiceForEdit: () => {},
  clearEditContext: () => set({ editingSaleLocalId: null, editingInvoiceCode: null }),
  clear: () => set({ ...defaults, items: [], customerId: null, customerName: null, customerVisualId: null,
    customerSaleDiscountPercentBp: null, discountPercentBp: null, discountWasManual: false }),
}), {
  initialQuantity: (_product, _items, requested) => requested ?? 1,
  validateItems: items => items.every(item => PRACTICE_CATALOG.some(product => product.localId === item.productId)
    && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 10),
});

export function restorePracticeCart(quantities: PracticeQuantities) {
  useTutorialCartStore.getState().clear();
  useTutorialCartStore.getState().setItems(PRACTICE_CATALOG.flatMap((product, index) => {
    const quantity = practiceQuantity(quantities[PRACTICE_PRODUCTS[index].id]);
    return quantity ? [createProductCartItem(product, quantity)] : [];
  }));
}
