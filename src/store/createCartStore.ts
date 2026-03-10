import { create } from 'zustand';
import { Product, SaleItem } from '../types';

export interface BaseCartState {
  items: SaleItem[];
  customerId: string | null;
  customerName: string | null;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
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
          } as Partial<TState>;
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
              unit: product.unit,
              productKind: product.productKind,
            },
          ],
        } as Partial<TState>;
      });
    },

    removeItem: (productId: string) => {
      set((state) => ({
        items: state.items.filter((item) => item.productId !== productId),
      }) as Partial<TState>);
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
