import AsyncStorage from '@react-native-async-storage/async-storage';

export type SalesSettings = {
  defaultViewMode: 'list' | 'grid';
  showItbisOnReceipts: boolean;
  defaultProfitMarginBp: number;
};

const SALES_SETTINGS_KEY = 'movopos_sales_settings_v1';

const FALLBACK_SETTINGS: SalesSettings = {
  defaultViewMode: 'list',
  showItbisOnReceipts: true,
  defaultProfitMarginBp: 3000,
};

function normalizeMarginBp(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FALLBACK_SETTINGS.defaultProfitMarginBp;
  return Math.min(50000, Math.max(0, Math.round(parsed)));
}

function normalizeViewMode(value: unknown): 'list' | 'grid' {
  return value === 'grid' ? 'grid' : 'list';
}

export function normalizeSalesSettings(raw: any): SalesSettings {
  return {
    defaultViewMode: normalizeViewMode(raw?.defaultViewMode),
    showItbisOnReceipts: typeof raw?.showItbisOnReceipts === 'boolean' ? raw.showItbisOnReceipts : true,
    defaultProfitMarginBp: normalizeMarginBp(raw?.defaultProfitMarginBp),
  };
}

export async function getSalesSettings(): Promise<SalesSettings> {
  try {
    const raw = await AsyncStorage.getItem(SALES_SETTINGS_KEY);
    if (!raw) return FALLBACK_SETTINGS;
    const parsed = JSON.parse(raw);
    return normalizeSalesSettings(parsed);
  } catch {
    return FALLBACK_SETTINGS;
  }
}

export async function setSalesSettings(next: SalesSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SALES_SETTINGS_KEY, JSON.stringify(normalizeSalesSettings(next)));
  } catch {
    // no-op
  }
}

