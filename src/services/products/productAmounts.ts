// Validar los centavos que realmente enviamos evita aceptar 0.001 y guardarlo como cero.
export function positiveProductCents(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647 ? cents : null;
}

export function validProductAmounts(priceCents: number, costCents: number): boolean {
  return [priceCents, costCents].every(cents => Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647);
}
