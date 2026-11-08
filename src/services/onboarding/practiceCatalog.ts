import type { Product } from '../../types';
import { PRACTICE_PRODUCTS, practiceQuantity, type PracticeQuantities } from './onboardingModel';

// Solo existen en la sesión del tutorial: nunca se insertan en products ni sync_queue.
export const PRACTICE_CATALOG = PRACTICE_PRODUCTS.map(product => {
  const parsedData = { productKind: 'BASIC', unit: 'UNIDAD', itbisRateBp: 1800, isOnboardingDemo: true };
  return {
    localId: `tutorial-demo:${product.id}`, name: product.name, priceCents: product.priceCents,
    costCents: product.priceCents / 2, stock: 10, unit: 'UNIDAD', productKind: 'BASIC',
    isActive: true, synced: true, data: JSON.stringify(parsedData), parsedData,
  } satisfies Product & { parsedData: typeof parsedData };
});

export function practiceCartQuantities(items: { productId: string; quantity: number }[]): PracticeQuantities {
  return Object.fromEntries(PRACTICE_PRODUCTS.map(product => [product.id,
    practiceQuantity(items.filter(item => item.productId === `tutorial-demo:${product.id}`).reduce((sum, item) => sum + item.quantity, 0)),
  ]));
}
