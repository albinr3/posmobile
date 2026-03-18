import { create } from 'zustand';
import { Product, SaleItem } from '../types';

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
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  updatePrice: (lineId: string, priceCents: number) => void;
  setCustomer: (customerId: string | null, customerName: string | null) => void;
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
              quantity,
              priceCents: product.priceCents,
              totalCents: quantity * product.priceCents,
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

    setCustomer: (customerId: string | null, customerName: string | null) => {
      set({ customerId, customerName } as Partial<TState>);
    },

    clear: () => {
      set({
        items: [] as SaleItem[],
        customerId: null,
        customerName: null,
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
