import { positiveProductCents } from '../products/productAmounts';

export const MOBILE_TUTORIAL_VERSION = 1;
export type TutorialStage = 'welcome' | 'sell' | 'catalog' | 'cart' | 'practiceDone' | 'product' | 'pending' | 'completed';
export type ProductGuideField = 'name' | 'kind' | 'price' | 'cost' | 'stock' | 'available' | 'save';
export type ProductDraft = {
  name: string; price: string; cost: string; stock: string; sku: string; reference: string;
  productKind: 'BASIC' | 'MEASURED' | 'RECIPE'; unit: string; minStock: string;
  taxRate: '18' | '16' | '0'; isAvailableForSale: boolean;
  supplierId: string | null; supplierName: string; categoryId: string | null; categoryName: string;
  imageUri: string | null;
};
export const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  name: '', price: '', cost: '', stock: '', sku: '', reference: '', productKind: 'BASIC', unit: 'UNIDAD',
  minStock: '5', taxRate: '18', isAvailableForSale: true, supplierId: null, supplierName: '',
  categoryId: null, categoryName: '', imageUri: null,
};
export const PRACTICE_PRODUCTS = [
  { id: 'coffee', name: 'Café Americano', priceCents: 10000, icon: 'coffee-outline' },
  { id: 'water', name: 'Botella de Agua', priceCents: 5000, icon: 'water-outline' },
  { id: 'snack', name: 'Snack', priceCents: 7500, icon: 'cookie-outline' },
] as const;
export type PracticeId = typeof PRACTICE_PRODUCTS[number]['id'];
export type PracticeQuantities = Partial<Record<PracticeId, number>>;
export function practiceQuantity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(10, Math.floor(value))) : 0;
}
export function practiceTotals(quantities: PracticeQuantities) {
  return PRACTICE_PRODUCTS.reduce((sum, product) => ({
    count: sum.count + practiceQuantity(quantities[product.id]),
    totalCents: sum.totalCents + practiceQuantity(quantities[product.id]) * product.priceCents,
  }), { count: 0, totalCents: 0 });
}
export function isProductFieldValid(field: ProductGuideField, draft: ProductDraft): boolean {
  switch (field) {
    case 'name': return draft.name.trim().length > 0;
    case 'kind': return draft.productKind === 'BASIC';
    case 'price': return positiveProductCents(draft.price) !== null;
    case 'cost': return positiveProductCents(draft.cost) !== null;
    case 'stock': return Number.isInteger(Number(draft.stock)) && Number(draft.stock) > 0;
    case 'available': return draft.isAvailableForSale;
    case 'save': return true;
  }
}
export const PRODUCT_GUIDE_FIELDS: ProductGuideField[] = ['name', 'kind', 'price', 'cost', 'stock', 'available', 'save'];
export function nextProductField(draft: ProductDraft): ProductGuideField {
  return PRODUCT_GUIDE_FIELDS.find(field => !isProductFieldValid(field, draft)) ?? 'save';
}
export function onboardingStorageKey(accountId: string, ownerId: string) {
  return `movopos:mobile-tutorial:v${MOBILE_TUTORIAL_VERSION}:${encodeURIComponent(accountId)}:${encodeURIComponent(ownerId)}`;
}
export type TutorialProgress = {
  stage: TutorialStage; introSeen: boolean; quantities: PracticeQuantities; draft: ProductDraft;
  productLocalId: string | null; productServerId: string | null; completedAt: string | null;
  completionIssue: 'invalid_product' | 'needs_correction' | 'missing_product' | null;
  rejectedProductId: string | null;
};
export function shouldAutoStartTutorial(input: { isOwner: boolean; eligible: boolean; remoteChecked: boolean; introSeen: boolean; completedAt: string | null; ready: boolean; onHome: boolean; hasSale: boolean }) {
  return input.isOwner && input.eligible && input.remoteChecked && !input.introSeen && !input.completedAt && input.ready && input.onHome && !input.hasSale;
}
export function initialTutorialProgress(): TutorialProgress {
  return { stage: 'welcome', introSeen: false, quantities: {}, draft: { ...EMPTY_PRODUCT_DRAFT }, productLocalId: null, productServerId: null, completedAt: null, completionIssue: null, rejectedProductId: null };
}
export function parseTutorialProgress(raw: string | null): TutorialProgress {
  const initial = initialTutorialProgress();
  if (!raw) return initial;
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object') return initial;
  const stages: TutorialStage[] = ['welcome', 'sell', 'catalog', 'cart', 'practiceDone', 'product', 'pending', 'completed'];
  const draft = { ...EMPTY_PRODUCT_DRAFT };
  for (const key of Object.keys(draft) as (keyof ProductDraft)[]) {
    const candidate = value.draft?.[key];
    if (draft[key] === null ? candidate === null || typeof candidate === 'string' : typeof candidate === typeof draft[key]) (draft as any)[key] = candidate;
  }
  if (!['BASIC', 'MEASURED', 'RECIPE'].includes(draft.productKind)) draft.productKind = 'BASIC';
  const quantities = Object.fromEntries(PRACTICE_PRODUCTS.map(product => [product.id, practiceQuantity(value.quantities?.[product.id])]));
  const completedAt = typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)) ? value.completedAt : null;
  const productLocalId = typeof value.productLocalId === 'string' && value.productLocalId ? value.productLocalId : null;
  const productServerId = typeof value.productServerId === 'string' && value.productServerId ? value.productServerId : null;
  let stage: TutorialStage = completedAt ? 'completed' : stages.includes(value.stage) ? value.stage : 'welcome';
  if (!completedAt && stage === 'completed') stage = 'welcome';
  if (stage === 'pending' && !productLocalId && !productServerId) stage = 'practiceDone';
  const completionIssue = ['invalid_product', 'needs_correction', 'missing_product'].includes(value.completionIssue) ? value.completionIssue : null;
  const rejectedProductId = typeof value.rejectedProductId === 'string' ? value.rejectedProductId : null;
  return { stage, introSeen: value.introSeen === true, quantities, draft, completedAt, productLocalId, productServerId, completionIssue, rejectedProductId };
}
