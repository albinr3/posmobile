import { db } from '../database/Database';
import {
  GENERIC_CUSTOMER_DISPLAY_NAME,
  GENERIC_CUSTOMER_VISUAL_ID,
  isGenericCustomerLabel,
  normalizeCustomerVisualId,
  parseCustomerVisualIdFromData,
} from './customerLabels';
import { normalizeDiscountPercentBp } from './tax';

type CustomerRow = {
  local_id: string;
  server_id?: string | null;
  visual_id?: number | null;
  name?: string | null;
  data?: string | null;
};

export type ResolvedGeneralCustomer = {
  localId: string;
  serverId: string | null;
  name: string;
  visualId: number;
  saleDiscountPercentBp: number | null;
};

const parseSaleDiscountPercentBp = (rawData: string | null | undefined): number | null => {
  if (!rawData) return null;
  try {
    const parsed = JSON.parse(rawData);
    const normalized = normalizeDiscountPercentBp(
      parsed?.saleDiscountPercentBp ?? parsed?.sale_discount_percent_bp ?? 0
    );
    return normalized > 0 ? normalized : null;
  } catch {
    return null;
  }
};

const mapGeneralCustomer = (row: CustomerRow, visualId: number | null): ResolvedGeneralCustomer => ({
  localId: String(row.local_id),
  serverId: row.server_id ? String(row.server_id) : null,
  name: GENERIC_CUSTOMER_DISPLAY_NAME,
  visualId: visualId ?? GENERIC_CUSTOMER_VISUAL_ID,
  saleDiscountPercentBp: parseSaleDiscountPercentBp(row.data),
});

export async function resolveGeneralCustomerFromDb(): Promise<ResolvedGeneralCustomer | null> {
  const rows = await db.query<CustomerRow>(
    `SELECT local_id, server_id, visual_id, name, data
     FROM customers
     ORDER BY CASE WHEN server_id IS NOT NULL THEN 0 ELSE 1 END, rowid ASC`
  );

  let fallbackGeneric: ResolvedGeneralCustomer | null = null;
  for (const row of rows) {
    const resolvedVisualId =
      normalizeCustomerVisualId(row.visual_id) ??
      parseCustomerVisualIdFromData(row.data) ??
      null;
    const rowName = String(row.name || '').trim();
    const isGeneric = isGenericCustomerLabel(rowName, resolvedVisualId);
    if (!isGeneric) continue;

    const mapped = mapGeneralCustomer(row, resolvedVisualId);
    if (mapped.visualId === GENERIC_CUSTOMER_VISUAL_ID) {
      return mapped;
    }
    if (!fallbackGeneric) {
      fallbackGeneric = mapped;
    }
  }

  return fallbackGeneric;
}
