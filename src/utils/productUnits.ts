export type MobileProductKind = 'BASIC' | 'MEASURED' | 'RECIPE';

export const PRODUCT_UNIT_OPTIONS = [
  { value: 'UNIDAD', label: 'Unidad (und)' },
  { value: 'KG', label: 'Kilogramo (kg)' },
  { value: 'LIBRA', label: 'Libra (lb)' },
  { value: 'GRAMO', label: 'Gramo (g)' },
  { value: 'LITRO', label: 'Litro (L)' },
  { value: 'ML', label: 'Mililitro (ml)' },
  { value: 'GALON', label: 'Galón (gal)' },
  { value: 'METRO', label: 'Metro (m)' },
  { value: 'CM', label: 'Centímetro (cm)' },
  { value: 'PIE', label: 'Pie (ft)' },
] as const;

const UNIT_ABBREVIATIONS: Record<string, string> = {
  UNIDAD: 'und',
  KG: 'kg',
  LIBRA: 'lb',
  GRAMO: 'g',
  LITRO: 'L',
  ML: 'ml',
  GALON: 'gal',
  METRO: 'm',
  CM: 'cm',
  PIE: 'ft',
};

export function inferProductUnit(source: Record<string, unknown> | null | undefined): string {
  const candidates = [source?.unit, source?.saleUnit, source?.purchaseUnit];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return 'UNIDAD';
}

export function inferProductKind(source: Record<string, unknown> | null | undefined): MobileProductKind {
  const rawKind = source?.productKind;
  if (rawKind === 'RECIPE' || rawKind === 'MEASURED' || rawKind === 'BASIC') {
    return rawKind;
  }
  return inferProductUnit(source) !== 'UNIDAD' ? 'MEASURED' : 'BASIC';
}

export function unitAllowsDecimals(unit: string | null | undefined): boolean {
  return inferProductUnit({ unit }) !== 'UNIDAD';
}

export function getUnitAbbreviation(unit: string | null | undefined): string {
  const normalized = inferProductUnit({ unit });
  return UNIT_ABBREVIATIONS[normalized] || normalized.toLowerCase();
}

export function formatProductQty(value: number | string, unit: string | null | undefined): string {
  const numeric = typeof value === 'number' ? value : Number(value || 0);
  const normalizedUnit = inferProductUnit({ unit });
  if (normalizedUnit === 'UNIDAD') {
    return String(Math.round(numeric));
  }
  const formatted = numeric.toFixed(2).replace(/\.?0+$/, '');
  return `${formatted} ${getUnitAbbreviation(normalizedUnit)}`;
}
