import { create } from 'zustand';
import { SaleItem, Product } from '../types';

interface CartState {
  items: SaleItem[];
  customerId: string | null;
  customerName: string | null;
  paymentMethod: string;
  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  setCustomer: (customerId: string | null, customerName: string | null) => void;
  setPaymentMethod: (method: string) => void;
  clear: () => void;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  paymentMethod: 'EFECTIVO',

  addItem: (product: Product, quantity: number = 1) => {
    set((state) => {
      const existingItem = state.items.find(item => item.productId === product.localId);
      
      if (existingItem) {
        return {
          items: state.items.map(item =>
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
      items: state.items.filter(item => item.productId !== productId),
    }));
  },

  updateQuantity: (productId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    
    set((state) => ({
      items: state.items.map(item =>
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

  setPaymentMethod: (method: string) => {
    set({ paymentMethod: method });
  },

  clear: () => {
    set({
      items: [],
      customerId: null,
      customerName: null,
      paymentMethod: 'EFECTIVO',
    });
  },

  getTotal: () => {
    return get().items.reduce((sum, item) => sum + item.totalCents, 0);
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
