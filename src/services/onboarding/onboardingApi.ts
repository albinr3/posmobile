import axios from 'axios';
import { API_URL } from '../apiConfig';
export type SharedOnboardingState = { completedAt: string | null; mobileAutoStartEligible: boolean; completionProductId: string | null };
export function parseSharedOnboardingState(value: any): SharedOnboardingState {
  if (!value || (value.completedAt !== null && (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)))) || typeof value.mobileAutoStartEligible !== 'boolean' || (value.completionProductId !== null && typeof value.completionProductId !== 'string')) {
    throw new Error('Respuesta de tutorial inválida');
  }
  return value;
}
export function onboardingHeaders(token: string, subUserToken: string, accountId: string) {
  return { Authorization: `Bearer ${token}`, 'X-Clerk-Authorization': `Bearer ${token}`, 'X-SubUser-Token': subUserToken, 'X-Account-Id': accountId };
}
export async function fetchSharedOnboarding(headers: Record<string, string>, signal?: AbortSignal) {
  const response = await axios.get(`${API_URL}/api/onboarding`, { headers, signal, timeout: 12000 });
  return parseSharedOnboardingState(response.data);
}
export async function completeSharedOnboarding(headers: Record<string, string>, productId: string, signal?: AbortSignal): Promise<string> {
  const response = await axios.post(`${API_URL}/api/onboarding/complete`, { productId }, { headers, signal, timeout: 12000 });
  const at = response.data?.completedAt;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error('No se pudo confirmar la finalización');
  return at;
}
