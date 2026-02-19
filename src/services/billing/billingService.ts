import axios from 'axios';
import * as LegacyFileSystem from 'expo-file-system/legacy';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';

const BILLING_OVERVIEW_ENDPOINTS = ['/api/billing/overview', '/api/billing'];
const BILLING_PROFILE_ENDPOINT = '/api/billing/profile';
const BILLING_MANUAL_PAYMENT_ENDPOINTS = ['/api/billing/payments/manual', '/api/billing/payment/dop'];
const BILLING_PROOF_UPLOAD_ENDPOINTS = ['/api/billing/proofs/upload', '/api/billing/upload-proof'];
const BILLING_USD_CHECKOUT_ENDPOINTS = ['/api/billing/checkout/usd', '/api/billing/payments/usd-checkout'];
const BILLING_OVERVIEW_CACHE_TTL_MS = 60_000;

type BillingOverviewCacheEntry = {
  fetchedAt: number;
  data: BillingOverview;
};

const billingOverviewCache = new Map<string, BillingOverviewCacheEntry>();
const billingOverviewInFlight = new Map<string, Promise<BillingOverview>>();
const billingPreferredEndpointByGroup = new Map<string, string>();

export interface BillingAuthContext {
  clerkToken: string;
  subUserToken: string;
  accountId: string | null;
}

export interface BillingProfileInput {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  phone?: string;
}

export interface BillingProfile {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  phone?: string | null;
}

export interface BillingProof {
  id: string;
  url: string;
}

export interface BillingPayment {
  id: string;
  amountCents: number;
  currency: string;
  provider: string;
  status: string;
  rejectionReason?: string | null;
  createdAt: string;
  proofs: BillingProof[];
}

export interface BankAccountInfo {
  id: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  accountName: string;
  currency: string;
  bankLogo: string | null;
  instructions: string | null;
}

export interface BillingSubscriptionSummary {
  id?: string;
  currency: string;
  provider: string;
  priceUsdCents: number;
  priceDopCents: number;
}

export interface BillingState {
  status: string;
  isBlocked: boolean;
  isTrialing: boolean;
  isActive: boolean;
  isGrace: boolean;
  daysRemaining: number | null;
  trialDaysRemaining: number | null;
  graceDaysRemaining: number | null;
  currentPeriodEndsAt: string | null;
  canAccessApp: boolean;
  needsPayment: boolean;
  currency: string;
  provider: string;
  priceInCents: number;
}

export interface BillingOverview {
  subscription: BillingSubscriptionSummary | null;
  profile: BillingProfile | null;
  state: BillingState;
  payments: BillingPayment[];
  bankAccounts: BankAccountInfo[];
  isLimited?: boolean;
}

export interface GetBillingOverviewOptions {
  forceRefresh?: boolean;
}

export class BillingEndpointUnavailableError extends Error {
  endpoints: string[];

  constructor(endpoints: string[]) {
    super(`No existe endpoint de billing para: ${endpoints.join(', ')}`);
    this.name = 'BillingEndpointUnavailableError';
    this.endpoints = endpoints;
  }
}

export function isBillingEndpointUnavailableError(error: unknown): error is BillingEndpointUnavailableError {
  return error instanceof BillingEndpointUnavailableError;
}

function buildHeaders(auth: BillingAuthContext) {
  return {
    Authorization: `Bearer ${auth.clerkToken}`,
    'X-Clerk-Authorization': `Bearer ${auth.clerkToken}`,
    'X-SubUser-Token': auth.subUserToken,
    ...(auth.accountId ? { 'X-Account-Id': auth.accountId } : {}),
  };
}

function getBillingOverviewCacheKey(auth: BillingAuthContext): string {
  return `${auth.accountId || 'default'}:${auth.subUserToken}`;
}

export function invalidateBillingOverviewCache(auth?: BillingAuthContext): void {
  if (!auth) {
    billingOverviewCache.clear();
    return;
  }
  billingOverviewCache.delete(getBillingOverviewCacheKey(auth));
}

function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 405);
}

function pickUrl(payload: any): string | null {
  const url = payload?.url || payload?.fileUrl || payload?.data?.url || payload?.file?.url || null;
  if (!url) return null;
  return String(url);
}

async function getFromFirstAvailable<T>(
  endpointPaths: string[],
  requester: (url: string) => Promise<T>,
  endpointGroup?: string
): Promise<T> {
  const preferredPath = endpointGroup ? billingPreferredEndpointByGroup.get(endpointGroup) : null;
  if (preferredPath && endpointPaths.includes(preferredPath)) {
    try {
      const preferredEndpoint = `${API_URL}${preferredPath}`;
      const preferredResult = await requester(preferredEndpoint);
      return preferredResult;
    } catch (error) {
      if (!(error instanceof BillingEndpointUnavailableError) && !isNotFound(error)) {
        throw error;
      }
      if (endpointGroup) {
        billingPreferredEndpointByGroup.delete(endpointGroup);
      }
    }
  }

  for (const path of endpointPaths) {
    if (preferredPath && path === preferredPath) continue;
    const endpoint = `${API_URL}${path}`;
    try {
      const result = await requester(endpoint);
      if (endpointGroup) {
        billingPreferredEndpointByGroup.set(endpointGroup, path);
      }
      return result;
    } catch (error) {
      if (error instanceof BillingEndpointUnavailableError && error.endpoints.length === 1) {
        continue;
      }
      if (isNotFound(error)) continue;
      throw error;
    }
  }
  throw new BillingEndpointUnavailableError(endpointPaths.map((path) => `${API_URL}${path}`));
}

function normalizeBillingState(rawState: any): BillingState {
  const status = String(rawState?.status || 'BLOCKED').toUpperCase();

  return {
    status,
    isBlocked: typeof rawState?.isBlocked === 'boolean' ? rawState.isBlocked : status === 'BLOCKED' || status === 'CANCELED',
    isTrialing: typeof rawState?.isTrialing === 'boolean' ? rawState.isTrialing : status === 'TRIALING',
    isActive: typeof rawState?.isActive === 'boolean' ? rawState.isActive : status === 'ACTIVE',
    isGrace: typeof rawState?.isGrace === 'boolean' ? rawState.isGrace : status === 'GRACE',
    daysRemaining: Number.isFinite(Number(rawState?.daysRemaining)) ? Number(rawState.daysRemaining) : null,
    trialDaysRemaining: Number.isFinite(Number(rawState?.trialDaysRemaining)) ? Number(rawState.trialDaysRemaining) : null,
    graceDaysRemaining: Number.isFinite(Number(rawState?.graceDaysRemaining)) ? Number(rawState.graceDaysRemaining) : null,
    currentPeriodEndsAt: rawState?.currentPeriodEndsAt ? String(rawState.currentPeriodEndsAt) : null,
    canAccessApp: typeof rawState?.canAccessApp === 'boolean' ? rawState.canAccessApp : status !== 'BLOCKED' && status !== 'CANCELED',
    needsPayment: typeof rawState?.needsPayment === 'boolean' ? rawState.needsPayment : status === 'BLOCKED' || status === 'GRACE',
    currency: String(rawState?.currency || 'DOP').toUpperCase(),
    provider: String(rawState?.provider || 'MANUAL').toUpperCase(),
    priceInCents: Number.isFinite(Number(rawState?.priceInCents)) ? Number(rawState.priceInCents) : 130000,
  };
}

function normalizeOverview(rawData: any): BillingOverview {
  const profile = rawData?.profile
    ? {
        legalName: String(rawData.profile.legalName || ''),
        taxId: String(rawData.profile.taxId || ''),
        address: String(rawData.profile.address || ''),
        email: String(rawData.profile.email || ''),
        phone: rawData.profile.phone ? String(rawData.profile.phone) : null,
      }
    : null;

  const subscription = rawData?.subscription
    ? {
        id: rawData.subscription.id ? String(rawData.subscription.id) : undefined,
        currency: String(rawData.subscription.currency || 'DOP').toUpperCase(),
        provider: String(rawData.subscription.provider || 'MANUAL').toUpperCase(),
        priceUsdCents: Number(rawData.subscription.priceUsdCents || 2000),
        priceDopCents: Number(rawData.subscription.priceDopCents || 130000),
      }
    : null;

  const payments: BillingPayment[] = Array.isArray(rawData?.payments)
    ? rawData.payments.map((payment: any) => ({
        id: String(payment?.id || ''),
        amountCents: Number(payment?.amountCents || 0),
        currency: String(payment?.currency || ''),
        provider: String(payment?.provider || ''),
        status: String(payment?.status || ''),
        rejectionReason: payment?.rejectionReason ? String(payment.rejectionReason) : null,
        createdAt: String(payment?.createdAt || ''),
        proofs: Array.isArray(payment?.proofs)
          ? payment.proofs
              .filter((proof: any) => proof?.url)
              .map((proof: any) => ({ id: String(proof?.id || ''), url: String(proof.url) }))
          : [],
      }))
    : [];

  const bankAccounts: BankAccountInfo[] = Array.isArray(rawData?.bankAccounts)
    ? rawData.bankAccounts.map((account: any) => ({
        id: String(account?.id || ''),
        bankName: String(account?.bankName || ''),
        accountType: String(account?.accountType || ''),
        accountNumber: String(account?.accountNumber || ''),
        accountName: String(account?.accountName || ''),
        currency: String(account?.currency || 'DOP'),
        bankLogo: account?.bankLogo ? String(account.bankLogo) : null,
        instructions: account?.instructions ? String(account.instructions) : null,
      }))
    : [];

  return {
    subscription,
    profile,
    state: normalizeBillingState(rawData?.state),
    payments,
    bankAccounts,
    isLimited: false,
  };
}

function inferMimeTypeFromUri(uri: string): string {
  const normalized = uri.toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.heic')) return 'image/heic';
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

export async function getBillingOverview(auth: BillingAuthContext): Promise<BillingOverview> {
  return getBillingOverviewWithOptions(auth, { forceRefresh: false });
}

export async function getBillingOverviewWithOptions(
  auth: BillingAuthContext,
  options: GetBillingOverviewOptions
): Promise<BillingOverview> {
  const forceRefresh = !!options.forceRefresh;
  const cacheKey = getBillingOverviewCacheKey(auth);
  const now = Date.now();

  if (!forceRefresh) {
    const cached = billingOverviewCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < BILLING_OVERVIEW_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const inFlight = billingOverviewInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = fetchBillingOverview(auth)
    .then((data) => {
      billingOverviewCache.set(cacheKey, {
        fetchedAt: Date.now(),
        data,
      });
      return data;
    })
    .finally(() => {
      billingOverviewInFlight.delete(cacheKey);
    });

  billingOverviewInFlight.set(cacheKey, requestPromise);
  return requestPromise;
}

async function fetchBillingOverview(auth: BillingAuthContext): Promise<BillingOverview> {
  const headers = buildHeaders(auth);

  try {
    return await getFromFirstAvailable(BILLING_OVERVIEW_ENDPOINTS, async (endpoint) => {
      const response = await axios.get(endpoint, { headers });
      return normalizeOverview(response.data);
    }, 'overview');
  } catch (error) {
    if (!isBillingEndpointUnavailableError(error)) throw error;
  }

  const stateResponse = await axios.get(`${API_URL}/api/billing/state`, { headers });
  const fallbackState = normalizeBillingState(stateResponse.data);

  return {
    subscription: null,
    profile: null,
    state: fallbackState,
    payments: [],
    bankAccounts: [],
    isLimited: true,
  };
}

export async function saveBillingProfile(auth: BillingAuthContext, data: BillingProfileInput): Promise<void> {
  const headers = buildHeaders(auth);
  await getFromFirstAvailable([BILLING_PROFILE_ENDPOINT], async (endpoint) => {
    try {
      await axios.put(endpoint, data, { headers });
      return null;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const response = await axios.post(endpoint, data, { headers });
    if (response.data?.success === false) {
      throw new Error(String(response.data?.error || 'No se pudo guardar el perfil.'));
    }
    return null;
  }, 'profile');
  invalidateBillingOverviewCache(auth);
}

export async function createDopPayment(auth: BillingAuthContext, bankAccountId: string): Promise<string> {
  const headers = buildHeaders(auth);

  const paymentId = await getFromFirstAvailable(BILLING_MANUAL_PAYMENT_ENDPOINTS, async (endpoint) => {
    const response = await axios.post(
      endpoint,
      { bankAccountId },
      { headers }
    );
    if (response.data?.success === false) {
      throw new Error(String(response.data?.error || 'No se pudo crear el pago.'));
    }
    const paymentId = response.data?.paymentId || response.data?.id || null;
    if (!paymentId) throw new Error('El backend no devolvió paymentId.');
    return String(paymentId);
  }, 'manual-payment');
  invalidateBillingOverviewCache(auth);
  return paymentId;
}

export async function submitPaymentProof(
  auth: BillingAuthContext,
  paymentId: string,
  proofUrl: string
): Promise<void> {
  const headers = buildHeaders(auth);
  const endpoint = `${API_URL}/api/billing/payments/${paymentId}/proof`;
  const response = await axios.post(
    endpoint,
    { proofUrl },
    { headers }
  );

  if (response.data?.success === false) {
    throw new Error(String(response.data?.error || 'No se pudo enviar el comprobante.'));
  }
  invalidateBillingOverviewCache(auth);
}

export async function getUsdCheckoutUrl(auth: BillingAuthContext): Promise<string> {
  const headers = buildHeaders(auth);

  return getFromFirstAvailable(BILLING_USD_CHECKOUT_ENDPOINTS, async (endpoint) => {
    try {
      const response = await axios.post(endpoint, {}, { headers });
      if (response.data?.success === false) {
        throw new Error(String(response.data?.error || 'No se pudo iniciar pago por tarjeta.'));
      }
      const url = pickUrl(response.data);
      if (!url) throw new Error('El backend no devolvió URL de checkout.');
      return url;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const response = await axios.get(endpoint, { headers });
    const url = pickUrl(response.data);
    if (!url) throw new Error('El backend no devolvió URL de checkout.');
    return url;
  }, 'usd-checkout');
}

export async function uploadPaymentProofFromUri(auth: BillingAuthContext, fileUri: string): Promise<string> {
  const headers = buildHeaders(auth);
  const uri = String(fileUri || '').trim();
  if (!uri) throw new Error('Archivo inválido.');

  const fileName = uri.split('/').pop() || `proof-${Date.now()}.jpg`;
  const mimeType = inferMimeTypeFromUri(uri);
  const form = new FormData();
  form.append('file', {
    uri,
    name: fileName,
    type: mimeType,
  } as any);

  try {
    return await getFromFirstAvailable(BILLING_PROOF_UPLOAD_ENDPOINTS, async (endpoint) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: form as any,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        if (response.status === 404 || response.status === 405) {
          throw new BillingEndpointUnavailableError([endpoint]);
        }
        throw new Error(`Upload HTTP ${response.status}: ${bodyText}`);
      }

      const payload = await response.json();
      const url = pickUrl(payload);
      if (!url) throw new Error('La subida no devolvió URL.');
      return url;
    }, 'proof-upload');
  } catch (error) {
    if (!isBillingEndpointUnavailableError(error)) {
      throw error;
    }
  }

  const base64 = await LegacyFileSystem.readAsStringAsync(uri, {
    encoding: 'base64' as any,
  });
  if (!base64) throw new Error('No se pudo leer el archivo para subida.');

  return getFromFirstAvailable(BILLING_PROOF_UPLOAD_ENDPOINTS, async (endpoint) => {
    const response = await axios.post(
      endpoint,
      { base64, fileName, mimeType },
      {
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        timeout: 45000,
      }
    );

    if (response.data?.success === false) {
      throw new Error(String(response.data?.error || 'No se pudo subir el comprobante.'));
    }

    const url = pickUrl(response.data);
    if (!url) throw new Error('La subida no devolvió URL.');
    return url;
  }, 'proof-upload');
}
