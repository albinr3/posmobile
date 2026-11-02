export const SALE_NOTES_MAX_LENGTH = 1000;

export function normalizeSaleNotes(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('La nota de la venta debe ser texto.');
  if (value.length > SALE_NOTES_MAX_LENGTH) {
    throw new Error(`La nota de la venta no puede superar ${SALE_NOTES_MAX_LENGTH} caracteres.`);
  }
  return value.trim() || null;
}
