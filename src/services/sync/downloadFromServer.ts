import axios from 'axios';
import { db } from '../../database/Database';
import { API_URL, SYNC_DEBUG, shortToken, summarizeError } from './syncShared';
import { GENERIC_CUSTOMER_DISPLAY_NAME, normalizeCustomerVisualId } from '../../utils/customerLabels';
import { normalizeDiscountPercentBp } from '../../utils/tax';
import { normalizeApplyLegalTip, resolveLegalTipSummary } from '../../utils/legalTip';

const DETAIL_FETCH_BATCH_SIZE = 8;
const DOWNLOAD_TIMEOUT_MS = 30000;
const PAGED_TAKE = 200;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function parseJsonSafe(raw: any): any | null {
  try {
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadLocalDataByServerId(
  table: 'sales' | 'quotes',
  serverIds: string[]
): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const uniqueIds = Array.from(new Set(serverIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return result;

  for (const idBatch of chunkArray(uniqueIds, 200)) {
    const placeholders = idBatch.map(() => '?').join(', ');
    const rows = await db.query<{ server_id?: string; data?: string }>(
      `SELECT server_id, data FROM ${table} WHERE server_id IN (${placeholders})`,
      idBatch
    );

    for (const row of rows) {
      const serverId = String(row?.server_id || '').trim();
      if (!serverId) continue;
      result.set(serverId, parseJsonSafe(row?.data));
    }
  }

  return result;
}

async function fetchDetailsInBatches<T>(
  ids: string[],
  fetcher: (id: string) => Promise<T | null>
): Promise<Map<string, T>> {
  const details = new Map<string, T>();
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return details;

  for (const idBatch of chunkArray(uniqueIds, DETAIL_FETCH_BATCH_SIZE)) {
    const batchResults = await Promise.all(
      idBatch.map(async (id) => {
        const detail = await fetcher(id);
        return { id, detail };
      })
    );

    for (const item of batchResults) {
      if (item.detail) details.set(item.id, item.detail);
    }
  }

  return details;
}

function extractListPayload(payload: any): any[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractNextSkip(payload: any): number | null {
  const raw = payload?.nextSkip;
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function extractNextCursor(payload: any): string | null {
  const raw = payload?.nextCursor;
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

async function setSyncMetadataValue(key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)`,
    [key, value, Date.now()]
  );
}

async function fetchAllWithSkip(endpoint: string, headers: Record<string, string>, take: number = PAGED_TAKE): Promise<any[]> {
  const rows: any[] = [];
  let skip = 0;
  while (true) {
    const response = await axios.get(`${API_URL}/api/${endpoint}`, {
      headers,
      params: { skip, take },
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    const payload = response.data;
    const batch = extractListPayload(payload);
    rows.push(...batch);
    if (SYNC_DEBUG) {
      console.log('[SyncService] fetchAllWithSkip page', {
        endpoint,
        skip,
        take,
        count: batch.length,
        nextSkip: extractNextSkip(payload),
      });
    }
    const nextSkip = extractNextSkip(payload);
    if (nextSkip === null) {
      if (batch.length < take) break;
      skip += take;
    } else {
      if (nextSkip <= skip) break;
      skip = nextSkip;
    }
  }
  return rows;
}

async function fetchAllWithCursor(endpoint: string, headers: Record<string, string>, take: number = PAGED_TAKE): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | null = null;
  while (true) {
    const response = await axios.get(`${API_URL}/api/${endpoint}`, {
      headers,
      params: cursor ? { cursor, take } : { take },
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    const payload = response.data;
    const batch = extractListPayload(payload);
    rows.push(...batch);
    const nextCursor = extractNextCursor(payload);
    if (SYNC_DEBUG) {
      console.log('[SyncService] fetchAllWithCursor page', {
        endpoint,
        cursor,
        take,
        count: batch.length,
        nextCursor,
      });
    }
    if (!nextCursor) {
      if (batch.length < take) break;
      break;
    }
    if (nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return rows;
}

async function markMissingServerRowsAsInactive(table: 'products' | 'customers' | 'categories' | 'suppliers', serverIds: Set<string>) {
  const placeholders = Array.from(serverIds);
  if (placeholders.length === 0) {
    await db.runAsync(
      `UPDATE ${table}
       SET is_available_for_sale = 0
       WHERE server_id IS NOT NULL AND COALESCE(is_available_for_sale, 1) != 0`
    );
    return;
  }

  const inClause = placeholders.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE ${table}
     SET is_available_for_sale = 0
     WHERE server_id IS NOT NULL
       AND server_id NOT IN (${inClause})
       AND COALESCE(is_available_for_sale, 1) != 0`,
    placeholders
  );
}

export async function downloadFromServer(options: {
  authToken: string;
  getTokenFn: (() => Promise<string | null>) | null;
  getSubUserTokenFn: (() => Promise<string | null>) | null;
}): Promise<void> {
  const { authToken, getTokenFn, getSubUserTokenFn } = options;
  const failedEntities: Array<{ entity: string; error: string }> = [];
  const successfulEntities: string[] = [];

  const runEntityTask = async (entity: string, task: () => Promise<void>) => {
    try {
      await task();
      successfulEntities.push(entity);
    } catch (error) {
      const summary = String(summarizeError(error));
      failedEntities.push({ entity, error: summary });
      console.error(`[SyncService] downloadFromServer() fallo en entidad ${entity}:`, summary);
    }
  };

  try {
    // Obtener token de Clerk
    let clerkToken = authToken;
    if (!clerkToken && getTokenFn) {
      clerkToken = await getTokenFn() || '';
    }
    
    if (SYNC_DEBUG) {
      console.log('🔑 [SyncService] Clerk Token:', clerkToken ? `${clerkToken.substring(0, 20)}...` : 'NO TOKEN');
    }
    
    if (!clerkToken) {
      throw new Error('No hay token de autenticación de Clerk disponible. Por favor, inicia sesión.');
    }

    // Obtener token JWT del subusuario
    let subUserToken: string | null = null;
    let accountId: string | null = null;
    if (getSubUserTokenFn) {
      subUserToken = await getSubUserTokenFn();
      if (SYNC_DEBUG) {
        console.log('🔑 [SyncService] SubUser Token (from getter):', subUserToken ? `${subUserToken.substring(0, 20)}...` : 'NO TOKEN');
      }
      const { useAuthStore } = await import('../../store/authStore');
      accountId = useAuthStore.getState().accountId;
    } else {
      const { useAuthStore } = await import('../../store/authStore');
      subUserToken = useAuthStore.getState().subUserToken;
      accountId = useAuthStore.getState().accountId;
      if (SYNC_DEBUG) {
        console.log('🔑 [SyncService] SubUser Token (from store):', subUserToken ? `${subUserToken.substring(0, 20)}...` : 'NO TOKEN');
      }
    }

    if (!subUserToken) {
      throw new Error('No hay token de subusuario disponible. Por favor, selecciona un usuario.');
    }

    if (SYNC_DEBUG) {
      console.log('[SyncService] downloadFromServer() auth context', {
        accountId,
        clerkToken: shortToken(clerkToken),
        subUserToken: shortToken(subUserToken),
      });
    }

    if (SYNC_DEBUG) {
      console.log('📡 [SyncService] Descargando productos desde:', `${API_URL}/api/products`);
    }
    
    const headers = { 
      'Authorization': `Bearer ${clerkToken}`,
      'X-Clerk-Authorization': `Bearer ${clerkToken}`,
      'X-SubUser-Token': subUserToken,
      ...(accountId ? { 'X-Account-Id': accountId } : {}),
    };
    
    if (SYNC_DEBUG) {
      console.log('📤 [SyncService] Headers que se van a enviar:', {
        'X-Clerk-Authorization': headers['X-Clerk-Authorization'] ? headers['X-Clerk-Authorization'].substring(0, 30) + '...' : 'MISSING',
        'X-SubUser-Token': headers['X-SubUser-Token'] ? headers['X-SubUser-Token'].substring(0, 20) + '...' : 'MISSING',
      });
    }

    // Descargar productos
    await runEntityTask('products', async () => {
      const productsResponse = await axios.get(`${API_URL}/api/products`, {
        headers,
        timeout: DOWNLOAD_TIMEOUT_MS,
      });

      if (SYNC_DEBUG) {
        console.log('✅ [SyncService] Productos descargados:', productsResponse.data?.data?.length || productsResponse.data?.length || 0);
      }

      const products = productsResponse.data?.data || productsResponse.data || [];
      const serverProductIds = new Set<string>();

      for (const product of products) {
        const productId = String(product?.id || '').trim();
        if (!productId) continue;
        serverProductIds.add(productId);

        const exists = await db.queryFirst(
          'SELECT 1 FROM products WHERE server_id = ? LIMIT 1',
          [product.id]
        );

        const productData = {
          name: product.name,
          sku: product.sku,
          cost_cents: product.costCents || Math.round((product.cost || 0) * 100),
          price_cents: product.priceCents || Math.round((product.price || 0) * 100),
          stock: product.stock || 0,
          is_available_for_sale: typeof product.isAvailableForSale === 'boolean' ? (product.isAvailableForSale ? 1 : 0) : 1,
          synced: 1,
          data: JSON.stringify(product),
        };

        if (exists) {
          await db.update('products', product.id, productData, 'server_id');
        } else {
          await db.insert('products', {
            local_id: `server_${product.id}`,
            server_id: product.id,
            ...productData,
          });
        }
      }

      await markMissingServerRowsAsInactive('products', serverProductIds);
    });

    // Descargar clientes
    await runEntityTask('customers', async () => {
      const customers = await fetchAllWithCursor('customers', headers);
      const serverCustomerIds = new Set<string>();

      for (const customer of customers) {
        const customerId = String(customer?.id || '').trim();
        if (!customerId) continue;
        serverCustomerIds.add(customerId);

        const exists = await db.queryFirst(
          'SELECT 1 FROM customers WHERE server_id = ? LIMIT 1',
          [customer.id]
        );

        const customerData = {
          visual_id: normalizeCustomerVisualId(customer.visualId ?? customer.id_visual),
          name: customer.name,
          phone: customer.phone || null,
          is_available_for_sale: 1,
          synced: 1,
          data: JSON.stringify({
            ...customer,
            saleDiscountPercentBp: normalizeDiscountPercentBp(
              customer?.saleDiscountPercentBp ?? customer?.sale_discount_percent_bp ?? 0
            ),
          }),
        };

        if (exists) {
          await db.update('customers', customer.id, customerData, 'server_id');
        } else {
          await db.insert('customers', {
            local_id: `server_${customer.id}`,
            server_id: customer.id,
            ...customerData,
          });
        }
      }

      await markMissingServerRowsAsInactive('customers', serverCustomerIds);
    });

    // Descargar proveedores
    await runEntityTask('suppliers', async () => {
      const suppliers = await fetchAllWithCursor('suppliers', headers);
      const serverSupplierIds = new Set<string>();
      for (const supplier of suppliers) {
      const supplierId = String(supplier?.id || '');
      if (!supplierId) continue;
      serverSupplierIds.add(supplierId);

      const supplierData = {
        id: supplierId,
        serverId: supplierId,
        name: String(supplier?.name || ''),
        contactName: supplier?.contactName ? String(supplier.contactName) : null,
        phone: supplier?.phone ? String(supplier.phone) : null,
        email: supplier?.email ? String(supplier.email) : null,
        address: supplier?.address ? String(supplier.address) : null,
        notes: supplier?.notes ? String(supplier.notes) : null,
        discountPercentBp: Number(supplier?.discountPercentBp || 0),
        chargesItbis: Boolean(supplier?.chargesItbis),
        itbisRateBp:
          supplier?.itbisRateBp === null || supplier?.itbisRateBp === undefined
            ? null
            : Number(supplier.itbisRateBp || 0),
      };

      const supplierRow = {
        name: supplierData.name,
        discount_percent_bp: supplierData.discountPercentBp,
        charges_itbis: supplierData.chargesItbis ? 1 : 0,
        itbis_rate_bp: supplierData.itbisRateBp,
        is_available_for_sale: 1,
        synced: 1,
        data: JSON.stringify(supplierData),
      };

      const exists = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM suppliers WHERE server_id = ?',
        [supplierId]
      );
      if (exists?.local_id) {
        await db.update('suppliers', supplierId, supplierRow, 'server_id');
      } else {
        await db.insert('suppliers', {
          local_id: `server_supplier_${supplierId}`,
          server_id: supplierId,
          ...supplierRow,
        });
      }
      }

      await markMissingServerRowsAsInactive('suppliers', serverSupplierIds);
    });

    // Descargar categorias
    await runEntityTask('categories', async () => {
      const categories = await fetchAllWithCursor('categories', headers);
      const serverCategoryIds = new Set<string>();
      for (const category of categories) {
      const categoryServerId = String(category?.id || '');
      if (!categoryServerId) continue;
      serverCategoryIds.add(categoryServerId);

      const categoryData = {
        id: categoryServerId,
        serverId: categoryServerId,
        internalId: category?.internalId ? String(category.internalId) : null,
        name: String(category?.name || ''),
        description: category?.description ? String(category.description) : null,
        createdAt: category?.createdAt || null,
        updatedAt: category?.updatedAt || null,
      };

      const categoryRow = {
        name: categoryData.name,
        description: categoryData.description,
        is_available_for_sale: 1,
        synced: 1,
        data: JSON.stringify(categoryData),
      };

      const exists = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM categories WHERE server_id = ?',
        [categoryServerId]
      );
      if (exists?.local_id) {
        await db.update('categories', categoryServerId, categoryRow, 'server_id');
      } else {
        await db.insert('categories', {
          local_id: `server_category_${categoryServerId}`,
          server_id: categoryServerId,
          ...categoryRow,
        });
      }
      }

      await markMissingServerRowsAsInactive('categories', serverCategoryIds);
    });

    // Descargar ventas/facturas
    await runEntityTask('sales', async () => {
      const sales = await fetchAllWithSkip('sales', headers);
      const salesById = new Map<string, any>();
      for (const sale of sales) {
        const saleId = String(sale?.id || '').trim();
        if (saleId) salesById.set(saleId, sale);
      }
      const saleIds: string[] = sales
        .map((sale: any) => String(sale?.id || '').trim())
        .filter((id: string): id is string => Boolean(id));
      const localSalesByServerId = await loadLocalDataByServerId('sales', saleIds);

      const saleIdsMissingItems = saleIds.filter((saleId) => {
        const saleSummary = salesById.get(saleId);
        const summaryHasItems = Array.isArray(saleSummary?.items) && saleSummary.items.length > 0;
        const localSale = localSalesByServerId.get(saleId);
        const localHasItems = Array.isArray(localSale?.items) && localSale.items.length > 0;
        return !summaryHasItems && !localHasItems;
      });

      const saleDetailsById = await fetchDetailsInBatches<any>(saleIdsMissingItems, async (saleId) => {
        try {
          const detailResponse = await axios.get(`${API_URL}/api/sales/${saleId}`, {
            headers,
            timeout: DOWNLOAD_TIMEOUT_MS,
          });
          return detailResponse.data || null;
        } catch (error) {
          if (SYNC_DEBUG) {
            console.warn('[SyncService] No se pudo descargar detalle de factura', {
              saleId,
              error: summarizeError(error),
            });
          }
          return null;
        }
      });

      for (const sale of sales) {
      const saleId = String(sale?.id || '').trim();
      if (!saleId) continue;

      const saleDetail = saleDetailsById.get(saleId) || null;
      const localSale = localSalesByServerId.get(saleId) || null;
      const legalTipSource = {
        applyLegalTip: saleDetail?.applyLegalTip ?? sale?.applyLegalTip ?? localSale?.applyLegalTip,
        cobrarPropinaLegal: saleDetail?.cobrarPropinaLegal ?? sale?.cobrarPropinaLegal ?? localSale?.cobrarPropinaLegal,
        incluirPropinaLegal: saleDetail?.incluirPropinaLegal ?? sale?.incluirPropinaLegal ?? localSale?.incluirPropinaLegal,
        legalTipApplied: saleDetail?.legalTipApplied ?? sale?.legalTipApplied ?? localSale?.legalTipApplied,
        legalTipPercentBp: saleDetail?.legalTipPercentBp ?? sale?.legalTipPercentBp ?? localSale?.legalTipPercentBp,
        legalTipBaseCents: saleDetail?.legalTipBaseCents ?? sale?.legalTipBaseCents ?? localSale?.legalTipBaseCents,
        legalTipCents: saleDetail?.legalTipCents ?? sale?.legalTipCents ?? localSale?.legalTipCents,
      };
      const legalTipSummary = resolveLegalTipSummary(
        legalTipSource,
        Number(saleDetail?.subtotalCents ?? sale?.subtotalCents ?? localSale?.subtotalCents ?? 0)
      );
      const applyLegalTip = normalizeApplyLegalTip(legalTipSource, false);

      const customerId = saleDetail?.customerId || sale?.customerId || localSale?.customerId || null;
      const customerName = saleDetail?.customerName || sale?.customerName || localSale?.customerName || null;
      const customerVisualId =
        normalizeCustomerVisualId(saleDetail?.customerVisualId) ??
        normalizeCustomerVisualId(sale?.customerVisualId) ??
        normalizeCustomerVisualId(saleDetail?.customer?.visualId) ??
        normalizeCustomerVisualId(sale?.customer?.visualId) ??
        normalizeCustomerVisualId(localSale?.customerVisualId) ??
        null;
      const soldAtRaw = saleDetail?.soldAt || sale?.soldAt || localSale?.soldAt || localSale?.createdAt || null;
      const createdAt =
        soldAtRaw && !Number.isNaN(new Date(soldAtRaw).getTime())
          ? new Date(soldAtRaw).getTime()
          : Date.now();
      const cancelledAtRaw = saleDetail?.cancelledAt || sale?.cancelledAt || localSale?.cancelledAt || null;
      const status = cancelledAtRaw ? 'cancelled' : 'completed';

      const sourceItems = Array.isArray(saleDetail?.items)
        ? saleDetail.items
        : Array.isArray(sale?.items)
          ? sale.items
          : Array.isArray(localSale?.items)
            ? localSale.items
            : [];

      const items = sourceItems.map((item: any, index: number) => {
        const quantity = Number(item?.qty ?? item?.quantity ?? 0);
        const priceCents = Number(item?.unitPriceCents ?? item?.priceCents ?? 0);
        const totalCents = Number(item?.lineTotalCents ?? item?.totalCents ?? Math.round(quantity * priceCents));
        return {
          saleItemId: String(item?.id || item?.saleItemId || `${saleId}_${index}`),
          productId: String(item?.productId || ''),
          productName: String(item?.productName || item?.product?.name || 'Producto'),
          quantity,
          priceCents,
          totalCents,
          itbisRateBp: Number(item?.itbisRateBp ?? item?.product?.itbisRateBp ?? 1800),
          wasPriceOverridden: Boolean(item?.wasPriceOverridden),
          recipeAdjustments: Array.isArray(item?.recipeAdjustments) ? item.recipeAdjustments : [],
        };
      });

      const saleData = {
        id: saleId,
        invoiceCode: String(saleDetail?.invoiceCode || sale?.invoiceCode || localSale?.invoiceCode || '-'),
        soldAt: createdAt,
        customerId,
        customerVisualId,
        customerName,
        paymentMethod: String(saleDetail?.paymentMethod || sale?.paymentMethod || localSale?.paymentMethod || 'EFECTIVO'),
        treasuryAccountId:
          (saleDetail?.treasuryAccountId ? String(saleDetail.treasuryAccountId).trim() : '') ||
          (sale?.treasuryAccountId ? String(sale.treasuryAccountId).trim() : '') ||
          (localSale?.treasuryAccountId ? String(localSale.treasuryAccountId).trim() : '') ||
          null,
        transferBankName: saleDetail?.transferBankName || sale?.transferBankName || localSale?.transferBankName || null,
        paymentSplits: Array.isArray(saleDetail?.paymentSplits)
          ? saleDetail.paymentSplits.map((split: any) => ({
              method: String(split?.method || 'EFECTIVO'),
              amountCents: Number(split?.amountCents || 0),
              transferBankName: split?.transferBankName ? String(split.transferBankName) : null,
              treasuryAccountId: split?.treasuryAccountId ? String(split.treasuryAccountId) : null,
            }))
          : Array.isArray(localSale?.paymentSplits)
            ? localSale.paymentSplits
            : [],
        type: String(saleDetail?.type || sale?.type || localSale?.type || 'CONTADO'),
        items,
        subtotalCents: Number(saleDetail?.subtotalCents || sale?.subtotalCents || localSale?.subtotalCents || 0),
        itbisCents: Number(saleDetail?.itbisCents || sale?.itbisCents || localSale?.itbisCents || 0),
        salePricesIncludeItbis:
          typeof (saleDetail?.salePricesIncludeItbis ?? sale?.salePricesIncludeItbis ?? localSale?.salePricesIncludeItbis) === 'boolean'
            ? Boolean(saleDetail?.salePricesIncludeItbis ?? sale?.salePricesIncludeItbis ?? localSale?.salePricesIncludeItbis)
            : true,
        shippingCents: Number(
          saleDetail?.shippingCents ??
          saleDetail?.fleteCents ??
          sale?.shippingCents ??
          sale?.fleteCents ??
          localSale?.shippingCents ??
          localSale?.fleteCents ??
          0
        ),
        discountSource: String(
          saleDetail?.discountSource ??
          sale?.discountSource ??
          localSale?.discountSource ??
          'NONE'
        ).toUpperCase(),
        discountPercentBp: normalizeDiscountPercentBp(
          saleDetail?.discountPercentBp ??
          sale?.discountPercentBp ??
          localSale?.discountPercentBp ??
          0
        ),
        discountSubtotalCents: Number(
          saleDetail?.discountSubtotalCents ??
          sale?.discountSubtotalCents ??
          localSale?.discountSubtotalCents ??
          0
        ),
        discountTotalCents: Number(
          saleDetail?.discountTotalCents ??
          sale?.discountTotalCents ??
          localSale?.discountTotalCents ??
          0
        ),
        applyLegalTip,
        legalTipApplied: legalTipSummary.legalTipApplied,
        legalTipPercentBp: legalTipSummary.legalTipPercentBp,
        legalTipBaseCents: legalTipSummary.legalTipBaseCents,
        legalTipCents: legalTipSummary.legalTipCents,
        totalCents: Number(saleDetail?.totalCents || sale?.totalCents || localSale?.totalCents || 0),
        status,
        cancelledAt: cancelledAtRaw,
        cancellationReason:
          saleDetail?.cancellationReason ||
          sale?.cancellationReason ||
          localSale?.cancellationReason ||
          null,
        createdAt,
      };

      const saleRow = {
        invoice_code: saleData.invoiceCode,
        customer_id: customerId,
        treasury_account_id: saleData.treasuryAccountId,
        total_cents: saleData.totalCents,
        status,
        created_at: createdAt,
        synced: 1,
        data: JSON.stringify(saleData),
      };

      const exists = await db.queryFirst<any>('SELECT local_id FROM sales WHERE server_id = ?', [saleId]);
      if (exists) {
        await db.update('sales', saleId, saleRow, 'server_id');
      } else {
        await db.insert('sales', {
          local_id: `server_sale_${saleId}`,
          server_id: saleId,
          ...saleRow,
        });
      }
      }
    });

    // Descargar devoluciones
    await runEntityTask('returns', async () => {
      const returnsRows = await fetchAllWithSkip('returns', headers);
      for (const ret of returnsRows) {
      const returnServerId = String(ret?.id || '');
      if (!returnServerId) continue;

      const saleServerId = ret?.saleId ? String(ret.saleId) : null;
      let saleLocalId: string | null = null;
      if (saleServerId) {
        const localSale = await db.queryFirst<{ local_id?: string }>(
          'SELECT local_id FROM sales WHERE server_id = ? LIMIT 1',
          [saleServerId]
        );
        saleLocalId = localSale?.local_id ? String(localSale.local_id) : null;
      }

      const returnedAtMs =
        ret?.returnedAt && !Number.isNaN(new Date(ret.returnedAt).getTime())
          ? new Date(ret.returnedAt).getTime()
          : Date.now();
      const cancelledAtMs =
        ret?.cancelledAt && !Number.isNaN(new Date(ret.cancelledAt).getTime())
          ? new Date(ret.cancelledAt).getTime()
          : null;

      const returnData = {
        id: returnServerId,
        serverId: returnServerId,
        returnCode: String(ret?.returnCode || ''),
        saleId: saleServerId,
        saleLocalId,
        totalCents: Number(ret?.totalCents || 0),
        subtotalCents: Number(ret?.subtotalCents || 0),
        itbisCents: Number(ret?.itbisCents || 0),
        salePricesIncludeItbis:
          typeof ret?.salePricesIncludeItbis === 'boolean' ? Boolean(ret.salePricesIncludeItbis) : true,
        refundMethod: ret?.refundMethod ? String(ret.refundMethod) : null,
        refundTreasuryAccountId: ret?.refundTreasuryAccountId ? String(ret.refundTreasuryAccountId) : null,
        notes: ret?.notes ? String(ret.notes) : null,
        returnedAt: returnedAtMs,
        cancelledAt: cancelledAtMs,
        sale: ret?.sale || null,
        items: Array.isArray(ret?.items) ? ret.items : [],
      };

      const returnRow = {
        return_code: returnData.returnCode || null,
        sale_local_id: saleLocalId,
        sale_server_id: saleServerId,
        total_cents: returnData.totalCents,
        refund_method: returnData.refundMethod,
        refund_treasury_account_id: returnData.refundTreasuryAccountId,
        notes: returnData.notes,
        returned_at: returnedAtMs,
        cancelled_at: cancelledAtMs,
        synced: 1,
        data: JSON.stringify(returnData),
      };

      const exists = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM returns WHERE server_id = ? LIMIT 1',
        [returnServerId]
      );

      const returnLocalId = exists?.local_id
        ? String(exists.local_id)
        : `server_return_${returnServerId}`;

      if (exists?.local_id) {
        await db.update('returns', returnServerId, returnRow, 'server_id');
      } else {
        await db.insert('returns', {
          local_id: returnLocalId,
          server_id: returnServerId,
          ...returnRow,
        });
      }

      await db.runAsync('DELETE FROM return_items WHERE return_local_id = ?', [returnLocalId]);

      for (const item of returnData.items) {
        const returnItemServerId = item?.id ? String(item.id) : null;
        const productServerId = item?.productId ? String(item.productId) : null;
        let productLocalId: string | null = null;
        if (productServerId) {
          const localProduct = await db.queryFirst<{ local_id?: string }>(
            'SELECT local_id FROM products WHERE server_id = ? LIMIT 1',
            [productServerId]
          );
          productLocalId = localProduct?.local_id ? String(localProduct.local_id) : null;
        }

        const qty = Number(item?.qty || 0);
        const unitPriceCents = Number(item?.unitPriceCents || 0);
        const lineTotalCents = Number(item?.lineTotalCents || Math.round(qty * unitPriceCents));

        await db.insert('return_items', {
          local_id:
            returnItemServerId
              ? `server_return_item_${returnItemServerId}`
              : `server_return_item_${returnLocalId}_${String(item?.saleItemId || '')}_${String(item?.productId || '')}`,
          return_local_id: returnLocalId,
          sale_item_id: String(item?.saleItemId || ''),
          product_local_id: productLocalId,
          product_server_id: productServerId,
          product_name: item?.product?.name ? String(item.product.name) : 'Producto',
          qty,
          unit_price_cents: unitPriceCents,
          line_total_cents: lineTotalCents,
          synced: 1,
          data: JSON.stringify({
            ...item,
            itbisRateBp: Number(item?.itbisRateBp ?? item?.saleItem?.itbisRateBp ?? item?.product?.itbisRateBp ?? 1800),
          }),
        });
      }
      }
    });

    // Descargar cotizaciones
    await runEntityTask('quotes', async () => {
      const quotes = await fetchAllWithSkip('quotes', headers);
      const quotesById = new Map<string, any>();
      for (const quote of quotes) {
        const quoteId = String(quote?.id || '').trim();
        if (quoteId) quotesById.set(quoteId, quote);
      }
      const quoteIds: string[] = quotes
        .map((quote: any) => String(quote?.id || '').trim())
        .filter((id: string): id is string => Boolean(id));
      const localQuotesByServerId = await loadLocalDataByServerId('quotes', quoteIds);

      const quoteIdsMissingItems = quoteIds.filter((quoteId) => {
        const quoteSummary = quotesById.get(quoteId);
        const summaryHasItems = Array.isArray(quoteSummary?.items) && quoteSummary.items.length > 0;
        const localQuote = localQuotesByServerId.get(quoteId);
        const localHasItems = Array.isArray(localQuote?.items) && localQuote.items.length > 0;
        return !summaryHasItems && !localHasItems;
      });

      const quoteDetailsById = await fetchDetailsInBatches<any>(quoteIdsMissingItems, async (quoteId) => {
        try {
          const detailResponse = await axios.get(`${API_URL}/api/quotes/${quoteId}`, {
            headers,
            timeout: DOWNLOAD_TIMEOUT_MS,
          });
          return detailResponse.data || null;
        } catch (error) {
          if (SYNC_DEBUG) {
            console.warn('[SyncService] No se pudo descargar detalle de cotizacion', {
              quoteId,
              error: summarizeError(error),
            });
          }
          return null;
        }
      });

      for (const quote of quotes) {
      const quoteId = String(quote?.id || '').trim();
      if (!quoteId) continue;

      const quoteDetail = quoteDetailsById.get(quoteId) || null;
      const localQuote = localQuotesByServerId.get(quoteId) || null;

      const customerId = quoteDetail?.customerId || quote?.customerId || localQuote?.customerId || null;
      const customerName = quoteDetail?.customerName || quote?.customerName || localQuote?.customerName || null;
      const customerVisualId =
        normalizeCustomerVisualId(quoteDetail?.customerVisualId) ??
        normalizeCustomerVisualId(quote?.customerVisualId) ??
        normalizeCustomerVisualId(quoteDetail?.customer?.visualId) ??
        normalizeCustomerVisualId(quote?.customer?.visualId) ??
        normalizeCustomerVisualId(localQuote?.customerVisualId) ??
        null;
      const quotedAtRaw = quoteDetail?.quotedAt || quote?.quotedAt || localQuote?.createdAt || null;
      const createdAt =
        quotedAtRaw && !Number.isNaN(new Date(quotedAtRaw).getTime())
          ? new Date(quotedAtRaw).getTime()
          : Date.now();

      const sourceItems = Array.isArray(quoteDetail?.items)
        ? quoteDetail.items
        : Array.isArray(quote?.items)
          ? quote.items
          : Array.isArray(localQuote?.items)
            ? localQuote.items
            : [];

      const items = sourceItems.map((item: any) => {
        const quantity = Number(item?.qty ?? item?.quantity ?? 0);
        const priceCents = Number(item?.unitPriceCents ?? item?.priceCents ?? 0);
        const totalCents = Number(item?.lineTotalCents ?? item?.totalCents ?? Math.round(quantity * priceCents));
        return {
          productId: String(item?.productId || ''),
          productName: String(item?.productName || item?.product?.name || 'Producto'),
          quantity,
          priceCents,
          totalCents,
          itbisRateBp: Number(item?.itbisRateBp ?? item?.product?.itbisRateBp ?? 1800),
          wasPriceOverridden: Boolean(item?.wasPriceOverridden),
        };
      });

      const quoteData = {
        id: quoteId,
        quoteCode: String(quoteDetail?.quoteCode || quote?.quoteCode || localQuote?.quoteCode || '-'),
        customerId,
        customerVisualId,
        customerName,
        items,
        subtotalCents: Number(quoteDetail?.subtotalCents || quote?.subtotalCents || localQuote?.subtotalCents || 0),
        itbisCents: Number(quoteDetail?.itbisCents || quote?.itbisCents || localQuote?.itbisCents || 0),
        salePricesIncludeItbis:
          typeof (quoteDetail?.salePricesIncludeItbis ?? quote?.salePricesIncludeItbis ?? localQuote?.salePricesIncludeItbis) === 'boolean'
            ? Boolean(quoteDetail?.salePricesIncludeItbis ?? quote?.salePricesIncludeItbis ?? localQuote?.salePricesIncludeItbis)
            : true,
        discountSource: String(
          quoteDetail?.discountSource ??
          quote?.discountSource ??
          localQuote?.discountSource ??
          'NONE'
        ).toUpperCase(),
        discountPercentBp: normalizeDiscountPercentBp(
          quoteDetail?.discountPercentBp ??
          quote?.discountPercentBp ??
          localQuote?.discountPercentBp ??
          0
        ),
        discountSubtotalCents: Number(
          quoteDetail?.discountSubtotalCents ??
          quote?.discountSubtotalCents ??
          localQuote?.discountSubtotalCents ??
          0
        ),
        discountTotalCents: Number(
          quoteDetail?.discountTotalCents ??
          quote?.discountTotalCents ??
          localQuote?.discountTotalCents ??
          0
        ),
        totalCents: Number(quoteDetail?.totalCents || quote?.totalCents || localQuote?.totalCents || 0),
        status: 'synced',
        createdAt,
        validUntil: quoteDetail?.validUntil || quote?.validUntil || localQuote?.validUntil || null,
        notes: quoteDetail?.notes || quote?.notes || localQuote?.notes || null,
      };

      const quoteRow = {
        quote_code: quoteData.quoteCode,
        customer_id: customerId,
        total_cents: quoteData.totalCents,
        status: 'synced',
        created_at: createdAt,
        synced: 1,
        data: JSON.stringify(quoteData),
      };

      const exists = await db.queryFirst<any>('SELECT local_id FROM quotes WHERE server_id = ?', [quoteId]);
      if (exists) {
        await db.update('quotes', quoteId, quoteRow, 'server_id');
      } else {
        await db.insert('quotes', {
          local_id: `server_quote_${quoteId}`,
          server_id: quoteId,
          ...quoteRow,
        });
      }
      }
    });

    // Descargar compras
    await runEntityTask('purchases', async () => {
      const purchaseProductRows = await db.query<{ local_id: string; server_id?: string }>(
        'SELECT local_id, server_id FROM products WHERE server_id IS NOT NULL'
      );
      const localProductByServerId = new Map<string, string>();
      for (const row of purchaseProductRows) {
        if (row.server_id) {
          localProductByServerId.set(String(row.server_id), String(row.local_id));
        }
      }

      const purchases = await fetchAllWithSkip('purchases', headers);

      for (const purchase of purchases) {
      const purchaseId = String(purchase?.id || '');
      if (!purchaseId) continue;
      const existingPurchaseRow = await db.queryFirst<{ data?: string }>(
        'SELECT data FROM purchases WHERE server_id = ? LIMIT 1',
        [purchaseId]
      );
      const localPurchase = parseJsonSafe(existingPurchaseRow?.data);

      const purchasedAtMs =
        purchase?.purchasedAt && !Number.isNaN(new Date(purchase.purchasedAt).getTime())
          ? new Date(purchase.purchasedAt).getTime()
          : Date.now();
      const cancelledAtMs =
        purchase?.cancelledAt && !Number.isNaN(new Date(purchase.cancelledAt).getTime())
          ? new Date(purchase.cancelledAt).getTime()
          : null;

      const normalizedItems = (Array.isArray(purchase?.items) ? purchase.items : []).map((item: any) => {
        const productServerId = String(item?.productId || '');
        const productLocalId = localProductByServerId.get(productServerId) || productServerId;
        return {
          id: item?.id ? String(item.id) : null,
          productId: productLocalId,
          productServerId,
          productName: item?.productName ? String(item.productName) : '',
          qty: Number(item?.qty || 0),
          unitCostCents: Number(item?.unitCostCents || 0),
          discountPercentBp: Number.isFinite(Number(item?.discountPercentBp))
            ? Number(item.discountPercentBp)
            : undefined,
          netCostCents: Number(item?.netCostCents || 0),
          salePriceCents: Number(item?.salePriceCents || 0),
          saleMarginBp: Number.isFinite(Number(item?.saleMarginBp)) ? Number(item.saleMarginBp) : undefined,
          purchaseIncludesItbis:
            typeof item?.purchaseIncludesItbis === 'boolean' ? item.purchaseIncludesItbis : undefined,
          appliedItbisRateBp:
            Number.isFinite(Number(item?.appliedItbisRateBp)) ? Number(item.appliedItbisRateBp) : undefined,
          lineTotalCents: Number(item?.lineTotalCents || 0),
        };
      });

      const purchaseData = {
        id: purchaseId,
        serverId: purchaseId,
        supplierName: purchase?.supplierName ? String(purchase.supplierName) : '',
        notes: purchase?.notes ? String(purchase.notes) : null,
        totalCents: Number(purchase?.totalCents || 0),
        purchasedAt: purchasedAtMs,
        cancelledAt: cancelledAtMs,
        itemsCount: Number(purchase?.itemsCount || normalizedItems.length),
        items: normalizedItems,
        paymentMethod:
          (purchase?.paymentMethod ? String(purchase.paymentMethod).trim().toUpperCase() : '') ||
          (localPurchase?.paymentMethod ? String(localPurchase.paymentMethod).trim().toUpperCase() : '') ||
          'EFECTIVO',
        treasuryAccountId:
          (purchase?.treasuryAccountId ? String(purchase.treasuryAccountId).trim() : '') ||
          (localPurchase?.treasuryAccountId ? String(localPurchase.treasuryAccountId).trim() : '') ||
          null,
        updateProductCost: true,
        updateProductPrice: true,
      };

      const purchaseRow = {
        supplier_name: purchaseData.supplierName || null,
        total_cents: purchaseData.totalCents,
        treasury_account_id: purchaseData.treasuryAccountId,
        purchased_at: purchasedAtMs,
        cancelled_at: cancelledAtMs,
        synced: 1,
        data: JSON.stringify(purchaseData),
      };

      const exists = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM purchases WHERE server_id = ?',
        [purchaseId]
      );
      if (exists?.local_id) {
        await db.update('purchases', purchaseId, purchaseRow, 'server_id');
      } else {
        await db.insert('purchases', {
          local_id: `server_purchase_${purchaseId}`,
          server_id: purchaseId,
          ...purchaseRow,
        });
      }
      }
    });

    // Descargar cuentas por cobrar (paginado para evitar truncar por take default del backend)
    await runEntityTask('accounts_receivable', async () => {
      const arItems: any[] = [];
      const arTake = 200;
      let arSkip = 0;
      while (true) {
        const arResponse = await axios.get(`${API_URL}/api/accounts-receivable`, {
          headers,
          params: { skip: arSkip, take: arTake },
          timeout: DOWNLOAD_TIMEOUT_MS,
        });
        const batch = arResponse.data?.data || arResponse.data || [];
        if (SYNC_DEBUG) {
          console.log('[SyncService] downloadFromServer() AR page status', {
            status: arResponse.status,
            skip: arSkip,
            take: arTake,
            count: batch.length,
          });
        }
        arItems.push(...batch);
        if (!Array.isArray(batch) || batch.length < arTake) {
          break;
        }
        arSkip += arTake;
      }

      if (SYNC_DEBUG) {
        console.log('[SyncService] downloadFromServer() AR total', {
          count: arItems.length,
        });
      }
      const serverOpenArIds = new Set<string>();

      for (const ar of arItems) {
      const arServerId = String(ar.id || '');
      if (!arServerId) continue;
      serverOpenArIds.add(arServerId);
      const existsByServer = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM accounts_receivable WHERE server_id = ? LIMIT 1',
        [arServerId]
      );

      const totalCents = ar.totalCents || 0;
      const balanceCents = ar.balanceCents || 0;
      const paidCents = Math.max(0, totalCents - balanceCents);
      const customerName = ar.customer?.name || GENERIC_CUSTOMER_DISPLAY_NAME;
      const customerId = ar.customerId || ar.customer?.id || 'unknown';
      const customerVisualId =
        normalizeCustomerVisualId(ar.customerVisualId) ??
        normalizeCustomerVisualId(ar.customer?.visualId) ??
        null;
      const dueDate = ar.dueDate ? new Date(ar.dueDate).getTime() : null;
      const saleServerId = ar?.saleId ? String(ar.saleId) : ar?.sale?.id ? String(ar.sale.id) : null;
      let matchedSaleLocalId: string | null = null;
      let provisionalArLocalId: string | null = null;
      if (!existsByServer?.local_id && saleServerId) {
        const localSale = await db.queryFirst<{ local_id?: string }>(
          'SELECT local_id FROM sales WHERE server_id = ? LIMIT 1',
          [saleServerId]
        );
        matchedSaleLocalId = localSale?.local_id ? String(localSale.local_id) : null;
        if (matchedSaleLocalId) {
          const candidateLocalArId = `ar_${matchedSaleLocalId}`;
          const localDraftAr = await db.queryFirst<{ local_id?: string }>(
            'SELECT local_id FROM accounts_receivable WHERE local_id = ? AND server_id IS NULL LIMIT 1',
            [candidateLocalArId]
          );
          provisionalArLocalId = localDraftAr?.local_id ? String(localDraftAr.local_id) : null;
        }
      }

      const arData = {
        customer_id: customerId,
        customer_visual_id: customerVisualId,
        customer_name: customerName,
        total_cents: totalCents,
        paid_cents: paidCents,
        balance_cents: balanceCents,
        status: ar.status || 'PENDIENTE',
        due_date: dueDate,
        synced: 1,
        data: JSON.stringify({
          ...ar,
          saleLocalId: matchedSaleLocalId,
        }),
      };

      if (existsByServer?.local_id) {
        await db.update('accounts_receivable', arServerId, arData, 'server_id');
      } else if (provisionalArLocalId) {
        await db.update('accounts_receivable', provisionalArLocalId, {
          server_id: arServerId,
          ...arData,
        });
      } else {
        await db.insert('accounts_receivable', {
          local_id: `server_ar_${arServerId}`,
          server_id: arServerId,
          ...arData,
        });
      }
      }

      // Cerrar AR locales que estaban abiertas pero ya no existen en la lista de AR abiertas del servidor.
      // Esto cubre casos de facturas canceladas/pagadas fuera del móvil.
      const localOpenAr = await db.query<any>(
        `SELECT local_id, server_id, total_cents, data
         FROM accounts_receivable
         WHERE server_id IS NOT NULL
           AND status IN ('PENDIENTE', 'PARCIAL')`
      );

      for (const localAr of localOpenAr) {
      const serverId = String(localAr.server_id || '');
      if (!serverId || serverOpenArIds.has(serverId)) continue;

      let parsedData: any = null;
      try {
        parsedData = localAr.data ? JSON.parse(localAr.data) : null;
      } catch {
        parsedData = null;
      }
      const totalCents = Number(localAr.total_cents || parsedData?.totalCents || 0);

      await db.update(
        'accounts_receivable',
        String(localAr.local_id),
        {
          status: 'PAGADO',
          balance_cents: 0,
          paid_cents: totalCents,
          synced: 1,
          data: JSON.stringify({
            ...(parsedData || {}),
            status: 'PAGADO',
            balanceCents: 0,
            paidCents: totalCents,
            closedAt: Date.now(),
          }),
        }
      );
      }

      // Reaplicar pagos locales pendientes (create/cancel) para evitar que CxC "reaparezca"
      // mientras la sincronización de recibos aún no termina.
      const pendingPaymentRows = await db.query<any>(
        `SELECT local_id, amount_cents, ar_id, server_id, synced, data
         FROM payments
         WHERE ar_id IS NOT NULL
           AND (synced = 0 OR server_id IS NULL)`
      );

      const pendingAdjustmentByArLocalId = new Map<string, number>();
      for (const paymentRow of pendingPaymentRows) {
      const arLocalId = paymentRow?.ar_id ? String(paymentRow.ar_id) : '';
      if (!arLocalId) continue;

      let parsedPayment: any = null;
      try {
        parsedPayment = paymentRow?.data ? JSON.parse(paymentRow.data) : null;
      } catch {
        parsedPayment = null;
      }

      const amountCents = Number(parsedPayment?.amountCents || paymentRow?.amount_cents || 0);
      if (!Number.isFinite(amountCents) || amountCents <= 0) continue;

      const cancelRequested =
        parsedPayment?.cancel === true ||
        String(parsedPayment?.status || '').toLowerCase() === 'cancelled' ||
        Boolean(parsedPayment?.cancelledAt);
      const delta = cancelRequested ? -amountCents : amountCents;
      if (delta === 0) continue;

      pendingAdjustmentByArLocalId.set(
        arLocalId,
        Number(pendingAdjustmentByArLocalId.get(arLocalId) || 0) + delta
      );
      }

      for (const [arLocalId, pendingDeltaCents] of pendingAdjustmentByArLocalId.entries()) {
      if (!pendingDeltaCents) continue;
      const arRow = await db.queryFirst<any>(
        `SELECT local_id, total_cents, paid_cents, balance_cents, status, data
         FROM accounts_receivable
         WHERE local_id = ?
         LIMIT 1`,
        [arLocalId]
      );
      if (!arRow?.local_id) continue;

      let parsedAr: any = null;
      try {
        parsedAr = arRow?.data ? JSON.parse(arRow.data) : null;
      } catch {
        parsedAr = null;
      }

      const totalCents = Number(arRow.total_cents || parsedAr?.totalCents || 0);
      const basePaidCents = Number(arRow.paid_cents || parsedAr?.paidCents || 0);
      const nextPaidCents = Math.max(0, Math.min(totalCents, basePaidCents + pendingDeltaCents));
      const nextBalanceCents = Math.max(0, totalCents - nextPaidCents);
      const nextStatus = nextBalanceCents <= 0 ? 'PAGADO' : nextPaidCents > 0 ? 'PARCIAL' : 'PENDIENTE';

      await db.update(
        'accounts_receivable',
        arLocalId,
        {
          paid_cents: nextPaidCents,
          balance_cents: nextBalanceCents,
          status: nextStatus,
          synced: 0,
          data: JSON.stringify({
            ...(parsedAr || {}),
            paidCents: nextPaidCents,
            balanceCents: nextBalanceCents,
            status: nextStatus,
            localPendingPaymentDeltaCents: pendingDeltaCents,
            localPendingPaymentAdjustedAt: Date.now(),
          }),
        }
      );
      }
    });

    // Descargar recibos de pago (incluye cancelados para historial)
    await runEntityTask('payments', async () => {
      const payments = await fetchAllWithSkip('payments', headers);
      for (const payment of payments) {
      const serverPaymentId = String(payment?.id || '');
      if (!serverPaymentId) continue;

      const arServerId = payment?.arId ? String(payment.arId) : null;
      let arLocalId: string | null = null;
      if (arServerId) {
        const localAr = await db.queryFirst<{ local_id?: string }>(
          'SELECT local_id FROM accounts_receivable WHERE server_id = ?',
          [arServerId]
        );
        arLocalId = localAr?.local_id ? String(localAr.local_id) : null;
      }

      const paidAtMs =
        payment?.paidAt && !Number.isNaN(new Date(payment.paidAt).getTime())
          ? new Date(payment.paidAt).getTime()
          : Date.now();
      const cancelledAtMs =
        payment?.cancelledAt && !Number.isNaN(new Date(payment.cancelledAt).getTime())
          ? new Date(payment.cancelledAt).getTime()
          : null;

      const paymentData = {
        id: serverPaymentId,
        serverId: serverPaymentId,
        receiptCode: String(payment?.receiptCode || ''),
        receiptNumber: Number(payment?.receiptNumber || 0),
        arId: arLocalId,
        arServerId,
        customerId: payment?.customer?.id ? String(payment.customer.id) : null,
        customerVisualId:
          normalizeCustomerVisualId(payment?.customerVisualId) ??
          normalizeCustomerVisualId(payment?.customer?.visualId) ??
          null,
        customerName: payment?.customer?.name ? String(payment.customer.name) : GENERIC_CUSTOMER_DISPLAY_NAME,
        amountCents: Number(payment?.amountCents || 0),
        method: String(payment?.method || 'EFECTIVO'),
        treasuryAccountId: payment?.treasuryAccountId ? String(payment.treasuryAccountId) : null,
        transferBankName: payment?.transferBankName ? String(payment.transferBankName) : null,
        note: payment?.note || null,
        createdAt: paidAtMs,
        paidAt: paidAtMs,
        cancelledAt: cancelledAtMs,
        cancellationReason: payment?.cancellationReason ? String(payment.cancellationReason) : null,
      };

      const paymentRow = {
        receipt_code: paymentData.receiptCode || `R-${serverPaymentId}`,
        amount_cents: paymentData.amountCents,
        ar_id: arLocalId,
        treasury_account_id: paymentData.treasuryAccountId,
        synced: 1,
        data: JSON.stringify(paymentData),
      };

      const existsByServer = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM payments WHERE server_id = ?',
        [serverPaymentId]
      );
      if (existsByServer?.local_id) {
        await db.update('payments', serverPaymentId, paymentRow, 'server_id');
        continue;
      }

      const existsByReceipt = paymentData.receiptCode
        ? await db.queryFirst<{ local_id?: string }>(
            'SELECT local_id FROM payments WHERE receipt_code = ?',
            [paymentData.receiptCode]
          )
        : null;
      if (existsByReceipt?.local_id) {
        await db.update(
          'payments',
          String(existsByReceipt.local_id),
          { server_id: serverPaymentId, ...paymentRow }
        );
        continue;
      }

      await db.insert('payments', {
        local_id: `server_payment_${serverPaymentId}`,
        server_id: serverPaymentId,
        ...paymentRow,
      });
      }
    });

    // Descargar gastos operativos
    await runEntityTask('operating_expenses', async () => {
      const operatingExpenses = await fetchAllWithSkip('operating-expenses', headers);
      for (const expense of operatingExpenses) {
      const expenseId = String(expense?.id || '');
      if (!expenseId) continue;
      const existingExpenseRow = await db.queryFirst<{ data?: string }>(
        'SELECT data FROM operating_expenses WHERE server_id = ? LIMIT 1',
        [expenseId]
      );
      const localExpense = parseJsonSafe(existingExpenseRow?.data);
      const expenseDateMs =
        expense?.expenseDate && !Number.isNaN(new Date(expense.expenseDate).getTime())
          ? new Date(expense.expenseDate).getTime()
          : Date.now();
      const expenseData = {
        id: expenseId,
        serverId: expenseId,
        description: String(expense?.description || ''),
        amountCents: Number(expense?.amountCents || 0),
        paymentMethod:
          (expense?.paymentMethod ? String(expense.paymentMethod).trim().toUpperCase() : '') ||
          (localExpense?.paymentMethod ? String(localExpense.paymentMethod).trim().toUpperCase() : '') ||
          'EFECTIVO',
        treasuryAccountId:
          (expense?.treasuryAccountId ? String(expense.treasuryAccountId).trim() : '') ||
          (localExpense?.treasuryAccountId ? String(localExpense.treasuryAccountId).trim() : '') ||
          null,
        expenseDate: new Date(expenseDateMs).toISOString(),
        category: expense?.category ? String(expense.category) : null,
        notes: expense?.notes ? String(expense.notes) : null,
        user: expense?.user
          ? {
              id: String(expense.user.id || ''),
              name: expense.user.name ? String(expense.user.name) : null,
              username: expense.user.username ? String(expense.user.username) : null,
            }
          : null,
        createdAt: expense?.createdAt ? String(expense.createdAt) : null,
        updatedAt: expense?.updatedAt ? String(expense.updatedAt) : null,
      };
      const expenseRow = {
        description: expenseData.description,
        amount_cents: expenseData.amountCents,
        payment_method: expenseData.paymentMethod,
        treasury_account_id: expenseData.treasuryAccountId,
        expense_date: expenseDateMs,
        category: expenseData.category,
        notes: expenseData.notes,
        synced: 1,
        data: JSON.stringify(expenseData),
      };
      const exists = await db.queryFirst<{ local_id?: string }>(
        'SELECT local_id FROM operating_expenses WHERE server_id = ?',
        [expenseId]
      );
      if (exists?.local_id) {
        await db.update('operating_expenses', expenseId, expenseRow, 'server_id');
      } else {
        await db.insert('operating_expenses', {
          local_id: `server_opex_${expenseId}`,
          server_id: expenseId,
          ...expenseRow,
        });
      }
      }
    });

    const status = failedEntities.length > 0 ? 'partial' : 'success';
    await setSyncMetadataValue('last_download_status', status);
    await setSyncMetadataValue('failed_entities', JSON.stringify(failedEntities));
    await setSyncMetadataValue('last_download_attempt_at', String(Date.now()));
    await setSyncMetadataValue('last_download_successful_entities', JSON.stringify(successfulEntities));
    if (failedEntities.length === 0) {
      await setSyncMetadataValue('last_successful_download_at', String(Date.now()));
    }
  } catch (error: any) {
    console.error('❌ [SyncService] Error descargando datos del servidor:', error);
    if (error.response) {
      console.error('❌ [SyncService] Status:', error.response.status);
      console.error('❌ [SyncService] Data:', error.response.data);
    }
    await setSyncMetadataValue('last_download_status', 'error');
    await setSyncMetadataValue('failed_entities', JSON.stringify([
      ...failedEntities,
      { entity: 'downloadFromServer', error: summarizeError(error) },
    ]));
    await setSyncMetadataValue('last_download_attempt_at', String(Date.now()));
    throw error;
  }
}

