const DEFAULT_API_URL = 'https://www.movopos.com';

export function normalizeApiUrl(value?: string): string {
  const url = value?.trim().replace(/\/+$/, '') || DEFAULT_API_URL;
  // Vercel redirige el dominio sin www con 308. Evitar la redirección en POST
  // impide perder la petición/cabecera de Clerk en clientes móviles y preflight web.
  return url.replace(/^https?:\/\/movopos\.com(?=\/|$)/i, DEFAULT_API_URL);
}

export const API_URL = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL || process.env.API_URL);
