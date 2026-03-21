export function normalizeCustomerVisualId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const intValue = Math.trunc(parsed);
  if (intValue <= 0) return null;
  return intValue;
}

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

export function formatCustomerLabel(name: string | null | undefined, visualId?: unknown): string {
  const safeName = String(name || '').trim() || 'Cliente';
  const normalizedVisualId = normalizeCustomerVisualId(visualId);
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
  const query = params.query.trim().toLowerCase();
  if (!query) return true;

  const normalizedVisualId = normalizeCustomerVisualId(params.visualId);
  const haystackParts = [
    params.name || '',
    params.phone || '',
    normalizedVisualId ? String(normalizedVisualId) : '',
    normalizedVisualId ? `(${normalizedVisualId})` : '',
    normalizedVisualId ? `#${normalizedVisualId}` : '',
    ...(params.extras || []),
  ];

  const haystack = haystackParts
    .map((value) => String(value || '').toLowerCase().trim())
    .filter(Boolean)
    .join(' ');

  return haystack.includes(query);
}
