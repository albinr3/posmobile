import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import * as Device from 'expo-device';
import { API_URL } from '../sync/syncShared';
import { useAuthStore } from '../../store/authStore';

const QUEUE_KEY = 'movopos_error_queue_v1';
const MAX_QUEUE = 20;
const DEBOUNCE_MS = 60_000;

type ErrorSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ErrorReportOptions = {
  code?: string;
  severity?: ErrorSeverity;
  metadata?: Record<string, unknown>;
  isFatal?: boolean;
  route?: string | null;
};

type ErrorReportPayload = {
  message: string;
  stack?: string;
  code?: string;
  severity?: ErrorSeverity;
  accountId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userPhone?: string | null;
  metadata?: Record<string, unknown>;
  requestBody?: unknown;
  createdAt: number;
};

let getClerkTokenFn: (() => Promise<string | null>) | null = null;
let getSubUserTokenFn: (() => Promise<string | null>) | null = null;
let getCurrentRouteFn: (() => string | null) | null = null;
let flushing = false;

const recentSignatures = new Map<string, number>();

export function setErrorTokenGetter(fn: () => Promise<string | null>) {
  getClerkTokenFn = fn;
}

export function setErrorSubUserTokenGetter(fn: () => Promise<string | null>) {
  getSubUserTokenFn = fn;
}

export function setErrorRouteGetter(fn: () => string | null) {
  getCurrentRouteFn = fn;
}

function buildBaseMetadata(): Record<string, unknown> {
  const manifest = Updates.manifest as { version?: string } | null;
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    deviceName: Device.deviceName || null,
    appVersion: manifest?.version || Updates.runtimeVersion || null,
    updateId: Updates.updateId || null,
  };
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || 'Error desconocido', stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: String((error as any)?.message || error || 'Error desconocido') };
}

function resolveRoute(options: ErrorReportOptions): string | null {
  if (typeof options.route === 'string' && options.route.trim()) {
    return options.route.trim();
  }

  if (!getCurrentRouteFn) return null;

  try {
    const route = getCurrentRouteFn();
    if (typeof route !== 'string' || !route.trim()) return null;
    return route.trim();
  } catch {
    return null;
  }
}

function buildSignature(payload: ErrorReportPayload): string {
  return `${payload.message}|${payload.stack || ''}`;
}

async function readQueue(): Promise<ErrorReportPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: ErrorReportPayload[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

async function enqueue(payload: ErrorReportPayload): Promise<void> {
  const queue = await readQueue();
  const next = [...queue, payload].slice(-MAX_QUEUE);
  await writeQueue(next);
}

async function resolveAuthHeaders() {
  const state = useAuthStore.getState();
  const clerkToken = getClerkTokenFn ? await getClerkTokenFn() : null;
  const subUserToken = getSubUserTokenFn ? await getSubUserTokenFn() : state.subUserToken || null;
  const accountId = state.accountId || null;
  return { clerkToken, subUserToken, accountId, subUser: state.subUser };
}

async function sendPayload(payload: ErrorReportPayload): Promise<boolean> {
  const auth = await resolveAuthHeaders();
  if (!auth.clerkToken || !auth.subUserToken) return false;

  await axios.post(`${API_URL}/api/error-logs`, payload, {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${auth.clerkToken}`,
      'X-Clerk-Authorization': `Bearer ${auth.clerkToken}`,
      'X-SubUser-Token': auth.subUserToken,
      ...(auth.accountId ? { 'X-Account-Id': auth.accountId } : {}),
      'Content-Type': 'application/json',
    },
  });
  return true;
}

export async function reportError(error: unknown, options: ErrorReportOptions = {}): Promise<void> {
  try {
    const normalized = normalizeError(error);
    const now = Date.now();
    const authState = useAuthStore.getState();
    const accountId = authState.accountId;
    const subUser = authState.subUser;
    const mainUser = authState.user;
    const route = resolveRoute(options);
    const resolvedUserId = subUser?.id || mainUser?.id || null;
    const resolvedUserEmail = subUser?.email || mainUser?.email || null;
    const resolvedUserPhone = mainUser?.phone || null;
    const payload: ErrorReportPayload = {
      message: normalized.message,
      stack: normalized.stack,
      code: options.code,
      severity: options.severity,
      accountId,
      userId: resolvedUserId,
      userEmail: resolvedUserEmail,
      userPhone: resolvedUserPhone,
      metadata: {
        ...buildBaseMetadata(),
        accountId,
        subUserId: subUser?.id || null,
        subUserName: subUser?.name || null,
        subUserUsername: subUser?.username || null,
        mainUserId: mainUser?.id || null,
        mainUserName: mainUser?.name || null,
        mainUserEmail: mainUser?.email || null,
        ...(options.metadata || {}),
        isFatal: options.isFatal ?? false,
        route,
        screen: route,
      },
      createdAt: now,
    };

    const signature = buildSignature(payload);
    const lastAt = recentSignatures.get(signature);
    if (lastAt && now - lastAt < DEBOUNCE_MS) return;
    recentSignatures.set(signature, now);

    const sent = await sendPayload(payload);
    if (!sent) {
      await enqueue(payload);
    }
  } catch {
    // no-op
  }
}

export async function flushErrorQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) return;
    const remaining: ErrorReportPayload[] = [];
    for (const payload of queue) {
      try {
        const sent = await sendPayload(payload);
        if (!sent) {
          remaining.push(payload);
          break;
        }
      } catch {
        remaining.push(payload);
        break;
      }
    }
    await writeQueue(remaining);
  } finally {
    flushing = false;
  }
}
