export type MobileProductKind = 'BASIC' | 'MEASURED' | 'RECIPE';

export const PRODUCT_UNIT_OPTIONS = [
  { value: 'UNIDAD', label: 'Unidad (und)' },
  { value: 'KG', label: 'Kilogramo (kg)' },
  { value: 'LIBRA', label: 'Libra (lb)' },
  { value: 'GRAMO', label: 'Gramo (g)' },
  { value: 'MILIGRAMO', label: 'Miligramo (mg)' },
  { value: 'ONZA', label: 'Onza (oz)' },
  { value: 'TONELADA', label: 'Tonelada (t)' },
  { value: 'LITRO', label: 'Litro (L)' },
  { value: 'ML', label: 'Mililitro (ml)' },
  { value: 'ONZA_LIQUIDA', label: 'Onza líquida (fl oz)' },
  { value: 'CC', label: 'Centímetro cúbico (cc)' },
  { value: 'GALON', label: 'Galón (gal)' },
  { value: 'METRO', label: 'Metro (m)' },
  { value: 'MM', label: 'Milímetro (mm)' },
  { value: 'CM', label: 'Centímetro (cm)' },
  { value: 'PULGADA', label: 'Pulgada (in)' },
  { value: 'PIE', label: 'Pie (ft)' },
  { value: 'YARDA', label: 'Yarda (yd)' },
  { value: 'M3', label: 'Metro cúbico (m3)' },
] as const;

const UNIT_ABBREVIATIONS: Record<string, string> = {
  UNIDAD: 'und',
  KG: 'kg',
  LIBRA: 'lb',
  GRAMO: 'g',
  MILIGRAMO: 'mg',
  ONZA: 'oz',
  TONELADA: 't',
  LITRO: 'L',
  ML: 'ml',
  ONZA_LIQUIDA: 'fl oz',
  CC: 'cc',
  GALON: 'gal',
  METRO: 'm',
  MM: 'mm',
  CM: 'cm',
  PULGADA: 'in',
  PIE: 'ft',
  YARDA: 'yd',
  M3: 'm3',
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
