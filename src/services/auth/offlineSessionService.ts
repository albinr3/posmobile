import * as SecureStore from 'expo-secure-store';

const LAST_ONLINE_AT_KEY = 'movopos_last_online_at_ms';
export const OFFLINE_SESSION_MAX_DAYS = 15;
const OFFLINE_SESSION_MAX_MS = OFFLINE_SESSION_MAX_DAYS * 24 * 60 * 60 * 1000;

export interface OfflineSessionWindowResult {
  expired: boolean;
  lastOnlineAtMs: number | null;
}

function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export async function markInternetConnectionSeen(nowMs = Date.now()): Promise<void> {
  await SecureStore.setItemAsync(LAST_ONLINE_AT_KEY, String(nowMs));
}

export async function evaluateOfflineSessionWindow(
  hasInternet: boolean,
  nowMs = Date.now()
): Promise<OfflineSessionWindowResult> {
  if (hasInternet) {
    await markInternetConnectionSeen(nowMs);
    return {
      expired: false,
      lastOnlineAtMs: nowMs,
    };
  }

  const raw = await SecureStore.getItemAsync(LAST_ONLINE_AT_KEY);
  const lastOnlineAtMs = parseTimestamp(raw);

  // Migracion segura: si el valor aun no existe, inicializamos la referencia
  // para no cerrar sesiones de usuarios activos inmediatamente tras actualizar.
  if (!lastOnlineAtMs) {
    await markInternetConnectionSeen(nowMs);
    return {
      expired: false,
      lastOnlineAtMs: nowMs,
    };
  }

  return {
    expired: nowMs - lastOnlineAtMs >= OFFLINE_SESSION_MAX_MS,
    lastOnlineAtMs,
  };
}
