import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeLegalTipEnabled } from '../../utils/legalTip';

export type SalesSettings = {
  defaultViewMode: 'list' | 'grid';
  showItbisOnReceipts: boolean;
  defaultProfitMarginBp: number;
  salePricesIncludeItbis: boolean;
  legalTipEnabled: boolean;
};

export type SalesSettingsListener = (settings: SalesSettings) => void;

const SALES_SETTINGS_KEY = 'movopos_sales_settings_v1';

const FALLBACK_SETTINGS: SalesSettings = {
  defaultViewMode: 'list',
  showItbisOnReceipts: true,
  defaultProfitMarginBp: 3000,
  salePricesIncludeItbis: true,
  legalTipEnabled: false,
};

const salesSettingsListeners = new Set<SalesSettingsListener>();
let inMemorySalesSettings: SalesSettings | null = null;
let loadingSalesSettingsPromise: Promise<SalesSettings> | null = null;

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
    salePricesIncludeItbis:
      typeof raw?.salePricesIncludeItbis === 'boolean'
        ? raw.salePricesIncludeItbis
        : typeof raw?.preciosVentaIncluyenItbis === 'boolean'
          ? raw.preciosVentaIncluyenItbis
          : true,
    legalTipEnabled: normalizeLegalTipEnabled(raw, false),
  };
}

export function normalizeSalesSettingsFromCompanyPayload(payload: any): SalesSettings {
  const mergedPayload = {
    ...(payload?.salesSettings || {}),
    ...(payload || {}),
  };
  return normalizeSalesSettings(mergedPayload);
}

export function hasSalesSettingsInCompanyPayload(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const hasNested =
    payload?.salesSettings &&
    typeof payload.salesSettings === 'object' &&
    Object.keys(payload.salesSettings).length > 0;
  if (hasNested) return true;

  return (
    payload?.defaultViewMode !== undefined ||
    payload?.modoVistaPorDefecto !== undefined ||
    payload?.showItbisOnReceipts !== undefined ||
    payload?.desglosarItbisEnRecibos !== undefined ||
    payload?.defaultProfitMarginBp !== undefined ||
    payload?.margenGananciaDefectoBp !== undefined ||
    payload?.salePricesIncludeItbis !== undefined ||
    payload?.preciosVentaIncluyenItbis !== undefined ||
    payload?.preciosIncluyenItbis !== undefined ||
    payload?.precioVentaIncluyeItbis !== undefined ||
    payload?.legalTipEnabled !== undefined ||
    payload?.propinaLegalEnabled !== undefined ||
    payload?.habilitarPropinaLegal !== undefined
  );
}

function notifySalesSettingsListeners(settings: SalesSettings) {
  for (const listener of salesSettingsListeners) {
    try {
      listener(settings);
    } catch {
      // no-op
    }
  }
}

export async function getSalesSettings(): Promise<SalesSettings> {
  if (inMemorySalesSettings) return inMemorySalesSettings;
  if (loadingSalesSettingsPromise) return loadingSalesSettingsPromise;

  loadingSalesSettingsPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(SALES_SETTINGS_KEY);
      if (!raw) {
        inMemorySalesSettings = FALLBACK_SETTINGS;
        return FALLBACK_SETTINGS;
      }
      const parsed = JSON.parse(raw);
      const normalized = normalizeSalesSettings(parsed);
      inMemorySalesSettings = normalized;
      return normalized;
    } catch {
      inMemorySalesSettings = FALLBACK_SETTINGS;
      return FALLBACK_SETTINGS;
    } finally {
      loadingSalesSettingsPromise = null;
    }
  })();

  return loadingSalesSettingsPromise;
}

export async function setSalesSettings(next: SalesSettings): Promise<void> {
  const normalized = normalizeSalesSettings(next);
  inMemorySalesSettings = normalized;
  notifySalesSettingsListeners(normalized);
  try {
    await AsyncStorage.setItem(SALES_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // no-op
  }
}

export async function setSalesSettingsFromCompanyPayload(payload: any): Promise<SalesSettings> {
  if (!hasSalesSettingsInCompanyPayload(payload)) {
    return getSalesSettings();
  }
  const normalized = normalizeSalesSettingsFromCompanyPayload(payload);
  await setSalesSettings(normalized);
  return normalized;
}

export function subscribeSalesSettings(listener: SalesSettingsListener): () => void {
  salesSettingsListeners.add(listener);

  if (inMemorySalesSettings) {
    listener(inMemorySalesSettings);
  } else {
    void getSalesSettings().then(listener).catch(() => {
      listener(FALLBACK_SETTINGS);
    });
  }

  return () => {
    salesSettingsListeners.delete(listener);
  };
}

