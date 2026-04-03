import { create } from 'zustand';
import { Product, SaleItem } from '../types';
import { normalizeDiscountPercentBp } from '../utils/tax';

function buildLineId(productId: string, recipeAdjustments: any[] = []): string {
  const adjustmentsKey = [...recipeAdjustments]
    .map((a) => `${a.ingredientId}:${a.adjustmentType}`)
    .sort()
    .join(',');
  return adjustmentsKey ? `${productId}::${adjustmentsKey}` : productId;
}

export interface BaseCartState {
  items: SaleItem[];
  customerId: string | null;
  customerName: string | null;
  customerVisualId: number | null;
  customerSaleDiscountPercentBp: number | null;
  discountPercentBp: number | null;
  discountWasManual: boolean;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (lineId: string) => void;
  removeOneLineByProductId: (productId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  updatePrice: (lineId: string, priceCents: number) => void;
  setCustomer: (
    customerId: string | null,
    customerName: string | null,
    customerVisualId?: number | null,
    customerSaleDiscountPercentBp?: number | null
  ) => void;
  setDiscountPercentBp: (discountPercentBp: number | null, markAsManual?: boolean) => void;
  clear: () => void;
  getTotal: () => number;
  getItemCount: () => number;
}

type SetState<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean
) => void;

function createBaseCartSlice<TState extends BaseCartState>(
  set: SetState<TState>,
  get: () => TState
): BaseCartState {
  return {
    items: [],
    customerId: null,
    customerName: null,
    customerVisualId: null,
    customerSaleDiscountPercentBp: null,
    discountPercentBp: null,
    discountWasManual: false,

    addItem: (product: Product, quantity: number = 1) => {
      set((state) => {
        const lineId = buildLineId(product.localId);
        const existingItem = state.items.find((item) => item.lineId === lineId);

        if (existingItem) {
          return {
            items: state.items.map((item) =>
              item.lineId === lineId
                ? {
                    ...item,
                    quantity: item.quantity + quantity,
                    totalCents: (item.quantity + quantity) * item.priceCents,
                  }
                : item
            ),
          } as Partial<TState>;
        }

        // Extract recipeItems from product parsed data
        let recipeItems: any[] | undefined;
        let productItbisRateBp = 1800;
        try {
          const parsed = product.data ? JSON.parse(product.data) : null;
          if (Array.isArray(parsed?.recipeItems) && parsed.recipeItems.length > 0) {
            recipeItems = parsed.recipeItems.map((ri: any) => ({
              ingredientId: String(ri.ingredientId || ri.id || ''),
              ingredientName: String(ri.ingredientName || ri.name || ''),
              qty: Number(ri.qty || ri.quantity || 0),
              ingredientUnit: String(ri.ingredientUnit || ri.unit || 'UNIDAD'),
            }));
          }
          const rawItbisRateBp = Number(parsed?.itbisRateBp);
          if (Number.isFinite(rawItbisRateBp) && rawItbisRateBp >= 0) {
            productItbisRateBp = Math.round(rawItbisRateBp);
          } else {
            const rawTaxPercent = Number(parsed?.taxRate);
            if (Number.isFinite(rawTaxPercent) && rawTaxPercent >= 0) {
              productItbisRateBp = rawTaxPercent <= 100 ? Math.round(rawTaxPercent * 100) : Math.round(rawTaxPercent);
            }
          }
        } catch {
          // ignore parse errors
        }

        return {
          items: [
            ...state.items,
            {
              lineId,
              productId: product.localId,
              productName: product.name,
              sku: product.sku,
              reference: product.reference,
              quantity,
              priceCents: product.priceCents,
              totalCents: quantity * product.priceCents,
              itbisRateBp: productItbisRateBp,
              unit: product.unit,
              productKind: product.productKind,
              recipeItems,
              recipeAdjustments: [],
            },
          ],
        } as Partial<TState>;
      });
    },

    removeItem: (lineId: string) => {
      set((state) => ({
        items: state.items.filter((item) => item.lineId !== lineId),
      }) as Partial<TState>);
    },

    removeOneLineByProductId: (productId: string) => {
      set((state) => {
        const idx = state.items.map((item) => item.productId).lastIndexOf(productId);
        if (idx < 0) return {} as Partial<TState>;
        const nextItems = [...state.items];
        nextItems.splice(idx, 1);
        return { items: nextItems } as Partial<TState>;
      });
    },

    updateQuantity: (lineId: string, quantity: number) => {
      if (quantity <= 0) {
        get().removeItem(lineId);
        return;
      }

      set((state) => ({
        items: state.items.map((item) =>
          item.lineId === lineId
            ? {
                ...item,
                quantity,
                totalCents: quantity * item.priceCents,
              }
            : item
        ),
      }) as Partial<TState>);
    },

    updatePrice: (lineId: string, priceCents: number) => {
      if (!Number.isFinite(priceCents) || priceCents < 0) return;
      const nextPriceCents = Math.round(priceCents);

      set((state) => ({
        items: state.items.map((item) =>
          item.lineId === lineId
            ? {
                ...item,
                priceCents: nextPriceCents,
                totalCents: item.quantity * nextPriceCents,
                wasPriceOverridden: true,
              }
            : item
        ),
      }) as Partial<TState>);
    },

    setCustomer: (
      customerId: string | null,
      customerName: string | null,
      customerVisualId?: number | null,
      customerSaleDiscountPercentBp?: number | null
    ) => {
      const normalizedCustomerDiscountBp = normalizeDiscountPercentBp(customerSaleDiscountPercentBp ?? 0);
      const resolvedCustomerDiscountBp = normalizedCustomerDiscountBp > 0 ? normalizedCustomerDiscountBp : null;
      set({
        customerId,
        customerName,
        customerVisualId: customerVisualId ?? null,
        customerSaleDiscountPercentBp: resolvedCustomerDiscountBp,
        discountPercentBp: resolvedCustomerDiscountBp,
        discountWasManual: false,
      } as Partial<TState>);
    },

    setDiscountPercentBp: (discountPercentBp: number | null, markAsManual: boolean = true) => {
      const normalizedDiscountBp = normalizeDiscountPercentBp(discountPercentBp ?? 0);
      set({
        discountPercentBp: normalizedDiscountBp > 0 ? normalizedDiscountBp : null,
        discountWasManual: markAsManual,
      } as Partial<TState>);
    },

    clear: () => {
      set({
        items: [] as SaleItem[],
        customerId: null,
        customerName: null,
        customerVisualId: null,
        customerSaleDiscountPercentBp: null,
        discountPercentBp: null,
        discountWasManual: false,
      } as Partial<TState>);
    },

    getTotal: () => get().items.reduce((sum, item) => sum + item.totalCents, 0),

    getItemCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export { buildLineId };

export function createCartStore<TExtra extends Record<string, any>>(
  createExtraSlice: (
    set: SetState<BaseCartState & TExtra>,
    get: () => BaseCartState & TExtra
  ) => TExtra
) {
  type State = BaseCartState & TExtra;
  return create<State>((set, get) => ({
    ...createBaseCartSlice<State>(set as SetState<State>, get as () => State),
    ...createExtraSlice(set as SetState<State>, get as () => State),
  }));
}
