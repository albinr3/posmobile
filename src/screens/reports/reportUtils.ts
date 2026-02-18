export function toYmd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseYmd(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}

export function rangeToTimestamps(fromYmd: string, toYmd: string): { fromTs: number; toTs: number } {
  const fromDate = parseYmd(fromYmd) || new Date();
  const toDate = parseYmd(toYmd) || fromDate;

  const fromTs = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
    0,
    0,
    0,
    0
  ).getTime();

  const toTs = new Date(
    toDate.getFullYear(),
    toDate.getMonth(),
    toDate.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

  return { fromTs, toTs };
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeEpochTimestamp(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return normalizeEpochTimestamp(asNumber);
    const asDate = new Date(value).getTime();
    return Number.isFinite(asDate) ? asDate : null;
  }
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
}

export function isCancelledStatus(status: unknown): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'cancelled' || normalized === 'cancelado';
}

export function normalizeSaleType(rawType: unknown, rawMethod: unknown): 'CONTADO' | 'CREDITO' {
  const type = String(rawType || '').toUpperCase();
  if (type === 'CREDITO' || type === 'CREDIT') return 'CREDITO';

  const method = String(rawMethod || '').toUpperCase();
  if (method === 'CREDITO' || method === 'CREDIT') return 'CREDITO';

  return 'CONTADO';
}

export function resolveSaleTimestamp(
  rowCreatedAt: unknown,
  parsed: Record<string, unknown> | null,
  fallback: number = Date.now()
): number {
  const resolved =
    toTimestamp(rowCreatedAt) ??
    toTimestamp(parsed?.createdAt) ??
    toTimestamp(parsed?.soldAt) ??
    toTimestamp(parsed?.date) ??
    fallback;

  return Number.isFinite(resolved) ? resolved : fallback;
}

function normalizeEpochTimestamp(value: number): number {
  const abs = Math.abs(value);

  // Epoch en segundos (10 dígitos aprox) -> milisegundos.
  if (abs > 0 && abs < 1e11) return value * 1000;

  // Epoch en microsegundos -> milisegundos.
  if (abs >= 1e14) return Math.trunc(value / 1000);

  return value;
}
