export const GENERIC_CUSTOMER_DISPLAY_NAME = 'Cliente general';
export const GENERIC_CUSTOMER_VISUAL_ID = 1;

export function normalizeCustomerVisualId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const intValue = Math.trunc(parsed);
  if (intValue <= 0) return null;
  return intValue;
}

const normalizeTextForCompare = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()#]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function parseCustomerVisualIdFromData(rawData: unknown): number | null {
  if (!rawData) return null;
  let parsed: any = null;
  if (typeof rawData === 'string') {
    try {
      parsed = JSON.parse(rawData);
    } catch {
      parsed = null;
    }
  } else if (typeof rawData === 'object') {
    parsed = rawData;
  }

  if (!parsed) return null;

  return (
    normalizeCustomerVisualId(parsed?.customerVisualId) ??
    normalizeCustomerVisualId(parsed?.visualId) ??
    normalizeCustomerVisualId(parsed?.id_visual) ??
    normalizeCustomerVisualId(parsed?.customer?.visualId) ??
    normalizeCustomerVisualId(parsed?.customer?.id_visual) ??
    normalizeCustomerVisualId(parsed?.sale?.customerVisualId) ??
    normalizeCustomerVisualId(parsed?.sale?.customer?.visualId) ??
    null
  );
}

export function isGenericCustomerName(name: string | null | undefined): boolean {
  const normalized = normalizeTextForCompare(name);
  if (!normalized) return false;
  if (
    normalized === 'cliente general' ||
    normalized === 'cliente generico' ||
    normalized === 'general' ||
    normalized === 'generico'
  ) {
    return true;
  }
  return normalized.includes('cliente general') || normalized.includes('cliente generico');
}

export function isGenericCustomerLabel(
  name: string | null | undefined,
  visualId?: unknown
): boolean {
  const normalizedVisualId = normalizeCustomerVisualId(visualId);
  if (normalizedVisualId === GENERIC_CUSTOMER_VISUAL_ID) return true;
  return isGenericCustomerName(name);
}

export function isGenericCustomerQuery(query: string): boolean {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === '#1' || raw === '(1)' || raw === '1') return true;
  const normalized = normalizeTextForCompare(raw);
  if (normalized === '1') return true;
  if (
    normalized === 'cliente general' ||
    normalized === 'cliente generico' ||
    normalized === 'general' ||
    normalized === 'generico'
  ) {
    return true;
  }
  return normalized.includes('cliente general') || normalized.includes('cliente generico');
}

export function formatCustomerLabel(name: string | null | undefined, visualId?: unknown): string {
  const safeName = String(name || '').trim();
  const normalizedVisualId = normalizeCustomerVisualId(visualId);
  if (!safeName || isGenericCustomerLabel(safeName, normalizedVisualId)) {
    return GENERIC_CUSTOMER_DISPLAY_NAME;
  }
  if (!normalizedVisualId) return safeName;
  return `(${normalizedVisualId}) ${safeName}`;
}

export function customerMatchesQuery(params: {
  query: string;
  name?: string | null;
  phone?: string | null;
  visualId?: unknown;
  extras?: Array<string | null | undefined>;
}): boolean {
  const rawQuery = String(params.query || '').trim().toLowerCase();
  if (!rawQuery) return true;
  const normalizedQuery = normalizeTextForCompare(rawQuery);

  const normalizedVisualId = normalizeCustomerVisualId(params.visualId);
  const isGeneric = isGenericCustomerLabel(params.name || null, normalizedVisualId);
  const haystackParts = [
    params.name || '',
    params.phone || '',
    normalizedVisualId ? String(normalizedVisualId) : '',
    normalizedVisualId ? `(${normalizedVisualId})` : '',
    normalizedVisualId ? `#${normalizedVisualId}` : '',
    isGeneric ? GENERIC_CUSTOMER_DISPLAY_NAME : '',
    isGeneric ? 'cliente generico' : '',
    isGeneric ? 'generico' : '',
    isGeneric ? 'general' : '',
    isGeneric ? '#1' : '',
    isGeneric ? '(1)' : '',
    ...(params.extras || []),
  ];

  const haystackRaw = haystackParts
    .map((value) => String(value || '').toLowerCase().trim())
    .filter(Boolean)
    .join(' ');
  const haystackNormalized = normalizeTextForCompare(haystackRaw);

  return haystackRaw.includes(rawQuery) || (!!normalizedQuery && haystackNormalized.includes(normalizedQuery));
}
