import axios from 'axios';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
export const SYNC_DEBUG = false;

export function shortToken(token: string | null | undefined): string {
  if (!token) return 'null';
  return `${token.slice(0, 12)}...(${token.length})`;
}

export function summarizeError(error: any) {
  if (!error) return { message: 'Error desconocido' };
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    };
  }
  return {
    message: error?.message || String(error),
    name: error?.name,
  };
}

export function normalizeCategoryIdForApi(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return String(parsed);
}
