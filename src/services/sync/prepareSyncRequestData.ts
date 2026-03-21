import axios from 'axios';
import { db } from '../../database/Database';
import { API_URL, SYNC_DEBUG, normalizeCategoryIdForApi, summarizeError } from './syncShared';
import { inferProductKind, inferProductUnit } from '../../utils/productUnits';

export async function prepareSyncRequestData(
  entityType: string,
  data: any,
  action: string,
  authContext?: { clerkToken: string; subUserToken: string; accountId: string | null }
): Promise<any> {
  switch (entityType) {
    case 'product':
      {
      const inferredUnit = inferProductUnit(data as Record<string, unknown>);
      const inferredKind = inferProductKind({
        ...(data as Record<string, unknown>),
        unit: inferredUnit,
      });
      const resolvedUnit = inferredKind === 'MEASURED' ? inferredUnit : 'UNIDAD';
      return {
        name: data.name,
        sku: data.sku || null,
        reference: data.reference || null,
        supplierId: data.supplierId || null,
        categoryId: normalizeCategoryIdForApi(data.categoryId),
        priceCents: data.priceCents || Math.round((data.price || 0) * 100),
        costCents: data.costCents || Math.round((data.cost || 0) * 100),
        stock: data.stock || 0,
        minStock: data.minStock || 0,
        itbisRateBp: data.itbisRateBp || 1800,
        isAvailableForSale: typeof data.isAvailableForSale === 'boolean' ? data.isAvailableForSale : true,
        imageUrls: data.imageUrls || [],
        productKind: inferredKind,
        unit: resolvedUnit,
        recipeItems: Array.isArray(data.recipeItems) ? data.recipeItems : [],
      };
      }
    case 'customer':
      return {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        cedula: data.cedula || null,
        province: data.province || null,
        creditEnabled: data.creditEnabled || false,
        creditDays: data.creditDays || 0,
        creditLimitCents: data.creditLimitCents || Math.round((data.creditLimit || 0) * 100),
        notes: data.notes || null,
      };
    case 'sale':
      {
      const cancelRequested =
        String(data?.status || '').toLowerCase() === 'cancelled' ||
        String(data?.status || '').toUpperCase() === 'CANCELADA' ||
        data?.cancel === true ||
        Boolean(data?.cancelledAt);

      if (action === 'update' && cancelRequested) {
        return {
          status: 'cancelled',
          cancel: true,
          cancelledAt: data?.cancelledAt || Date.now(),
        };
      }

      let resolvedCustomerId: string | null = null;
      if (data.customerId) {
        const customer = await db.queryFirst<{ server_id?: string }>(
          'SELECT server_id FROM customers WHERE local_id = ?',
          [data.customerId]
        );
        resolvedCustomerId = customer?.server_id || null;
      }

      // Convertir productId local -> server_id para el API
      const saleItems = await Promise.all(
        (data.items || []).map(async (item: any) => {
          const product = await db.queryFirst<{ server_id?: string; data?: string }>(
            'SELECT server_id, data FROM products WHERE local_id = ?',
            [item.productId]
          );
          if (!product?.server_id) {
            throw new Error(`Producto sin server_id: ${item.productId}`);
          }

          let isActive = true;
          try {
            const parsed = product.data ? JSON.parse(product.data) : null;
            if (typeof parsed?.isActive === 'boolean') isActive = parsed.isActive;
            if (typeof parsed?.active === 'boolean') isActive = parsed.active;
          } catch {
            // no-op
          }
          if (!isActive) {
            throw new Error(`Producto inactivo en carrito: ${item.productId}`);
          }

          const resolvedProductId = product.server_id;
          const resolvedUnitPriceCents =
            item.unitPriceCents ||
            item.priceCents ||
            Math.round((item.price || 0) * 100);

          if (!Number.isInteger(resolvedUnitPriceCents) || resolvedUnitPriceCents <= 0) {
            throw new Error(`Precio unitario invalido para producto ${item.productId}`);
          }

          return {
            productId: resolvedProductId,
            quantity: item.quantity || item.qty,
            price: item.price || resolvedUnitPriceCents / 100,
            unitPriceCents: resolvedUnitPriceCents,
            itbisRateBp:
              Number.isFinite(Number(item?.itbisRateBp))
                ? Math.max(0, Math.round(Number(item.itbisRateBp)))
                : undefined,
            wasPriceOverridden: Boolean(item.wasPriceOverridden),
            recipeAdjustments: Array.isArray(item.recipeAdjustments) ? item.recipeAdjustments : [],
          };
        })
      );

      const saleTimestampRaw = data?.soldAt ?? data?.createdAt ?? null;
      let soldAtIso: string | null = null;
      if (typeof saleTimestampRaw === 'number' && Number.isFinite(saleTimestampRaw)) {
        soldAtIso = new Date(saleTimestampRaw).toISOString();
      } else if (typeof saleTimestampRaw === 'string' && saleTimestampRaw.trim()) {
        const parsed = new Date(saleTimestampRaw);
        if (!Number.isNaN(parsed.getTime())) {
          soldAtIso = parsed.toISOString();
        }
      } else if (saleTimestampRaw instanceof Date && !Number.isNaN(saleTimestampRaw.getTime())) {
        soldAtIso = saleTimestampRaw.toISOString();
      }

      return {
        customerId: resolvedCustomerId,
        type: data.type || (data.paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO'),
        paymentMethod: data.paymentMethod || null,
        transferBankName: data.transferBankName || null,
        paymentSplits: Array.isArray(data.paymentSplits) ? data.paymentSplits : undefined,
        salePricesIncludeItbis:
          typeof data.salePricesIncludeItbis === 'boolean' ? data.salePricesIncludeItbis : undefined,
        items: saleItems,
        shippingCents: data.shippingCents || Math.round((data.shipping || 0) * 100),
        ...(soldAtIso ? { soldAt: soldAtIso } : {}),
      };
      }
    case 'payment':
      {
      const cancelRequested =
        action === 'update' &&
        (data?.cancel === true ||
          String(data?.status || '').toLowerCase() === 'cancelled' ||
          Boolean(data?.cancelledAt));
      if (cancelRequested) {
        return {
          cancel: true,
          cancelledAt: data?.cancelledAt || Date.now(),
        };
      }

      let resolvedArId = data.arId || data.accountReceivableId || data.arServerId || null;
      if (resolvedArId) {
        const ar = await db.queryFirst<{ server_id?: string }>(
          'SELECT server_id FROM accounts_receivable WHERE local_id = ?',
          [resolvedArId]
        );
        resolvedArId = ar?.server_id || resolvedArId;
      }
      return {
        arId: resolvedArId,
        amountCents: data.amountCents || Math.round((data.amount || 0) * 100),
        method: data.method || data.paymentMethod,
        transferBankName: data.transferBankName || null,
        note: data.note || data.notes || null,
      };
      }
    case 'payment_batch':
      {
      const rawArIds = Array.isArray(data?.arIds) ? data.arIds : [];
      const resolvedArIds: string[] = [];
      for (const rawArId of rawArIds) {
        if (!rawArId) continue;
        let resolved = String(rawArId);
        const ar = await db.queryFirst<{ server_id?: string }>(
          'SELECT server_id FROM accounts_receivable WHERE local_id = ?',
          [resolved]
        );
        if (ar?.server_id) {
          resolved = String(ar.server_id);
        }
        resolvedArIds.push(resolved);
      }

      return {
        arIds: resolvedArIds,
        amountCents: data.amountCents || Math.round((data.amount || 0) * 100),
        method: data.method || data.paymentMethod,
        transferBankName: data.transferBankName || null,
        note: data.note || data.notes || null,
      };
      }
    case 'purchase':
      {
      const supplierRawId = data?.supplierServerId || data?.supplierId || null;
      let resolvedSupplierId: string | null = null;
      if (supplierRawId) {
        const supplier = await db.queryFirst<{ server_id?: string }>(
          'SELECT server_id FROM suppliers WHERE local_id = ? OR server_id = ? LIMIT 1',
          [supplierRawId, supplierRawId]
        );
        resolvedSupplierId = supplier?.server_id || String(supplierRawId);
      }

      const purchaseItems = await Promise.all(
        (data?.items || []).map(async (item: any) => {
          const rawProductId = String(item?.productServerId || item?.productId || '');
          if (!rawProductId) {
            throw new Error('Producto sin server_id: (vacío)');
          }

          const product = await db.queryFirst<{ server_id?: string }>(
            'SELECT server_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
            [rawProductId, rawProductId]
          );
          if (!product?.server_id) {
            throw new Error(`Producto sin server_id: ${rawProductId}`);
          }

          const qty = Number(item?.qty || 0);
          const unitCostCents = Number(item?.unitCostCents || 0);
          const payloadItem: any = {
            productId: product.server_id,
            qty,
            unitCostCents,
          };

          if (Number.isFinite(Number(item?.discountPercentBp))) {
            payloadItem.discountPercentBp = Number(item.discountPercentBp);
          }
          if (Number.isFinite(Number(item?.salePriceCents))) {
            payloadItem.salePriceCents = Number(item.salePriceCents);
          }
          if (Number.isFinite(Number(item?.saleMarginBp))) {
            payloadItem.saleMarginBp = Number(item.saleMarginBp);
          }
          if (typeof item?.purchaseIncludesItbis === 'boolean') {
            payloadItem.purchaseIncludesItbis = item.purchaseIncludesItbis;
          }

          return payloadItem;
        })
      );

      return {
        supplierId: resolvedSupplierId,
        supplierName: data?.supplierName ? String(data.supplierName).trim() : null,
        notes: data?.notes ? String(data.notes).trim() : null,
        updateProductCost: data?.updateProductCost !== false,
        updateProductPrice: data?.updateProductPrice !== false,
        items: purchaseItems,
      };
      }
    case 'quote':
      let resolvedQuoteCustomerId: string | null = null;
      if (data.customerId) {
        const customer = await db.queryFirst<{ server_id?: string }>(
          'SELECT server_id FROM customers WHERE local_id = ?',
          [data.customerId]
        );
        resolvedQuoteCustomerId = customer?.server_id || null;
      }

      const quoteItems = await Promise.all(
        (data.items || []).map(async (item: any) => {
          const product = await db.queryFirst<{ server_id?: string; data?: string }>(
            'SELECT server_id, data FROM products WHERE local_id = ?',
            [item.productId]
          );
          if (!product?.server_id) {
            throw new Error(`Producto sin server_id: ${item.productId}`);
          }

          let isActive = true;
          try {
            const parsed = product.data ? JSON.parse(product.data) : null;
            if (typeof parsed?.isActive === 'boolean') isActive = parsed.isActive;
            if (typeof parsed?.active === 'boolean') isActive = parsed.active;
          } catch {
            // no-op
          }
          if (!isActive) {
            throw new Error(`Producto inactivo en carrito: ${item.productId}`);
          }

          const resolvedUnitPriceCents =
            item.unitPriceCents ||
            item.priceCents ||
            Math.round((item.price || 0) * 100);

          if (!Number.isInteger(resolvedUnitPriceCents) || resolvedUnitPriceCents <= 0) {
            throw new Error(`Precio unitario invalido para producto ${item.productId}`);
          }

          return {
            productId: product.server_id,
            qty: item.quantity || item.qty || 1,
            unitPriceCents: resolvedUnitPriceCents,
            itbisRateBp:
              Number.isFinite(Number(item?.itbisRateBp))
                ? Math.max(0, Math.round(Number(item.itbisRateBp)))
                : undefined,
            wasPriceOverridden: item.wasPriceOverridden || false,
          };
        })
      );

      return {
        customerId: resolvedQuoteCustomerId,
        salePricesIncludeItbis:
          typeof data.salePricesIncludeItbis === 'boolean' ? data.salePricesIncludeItbis : undefined,
        items: quoteItems,
        shippingCents: data.shippingCents || Math.round((data.shipping || 0) * 100),
        notes: data.notes || null,
        validUntil: data.validUntil || null,
      };
    case 'operating_expense':
      {
        const expenseDate = data?.expenseDate
          ? new Date(String(data.expenseDate)).toISOString()
          : new Date().toISOString();
        if (action === 'delete') {
          return {};
        }
        return {
          description: String(data?.description || '').trim(),
          amountCents: Number(data?.amountCents || 0),
          expenseDate,
          category: data?.category ? String(data.category).trim() : null,
          notes: data?.notes ? String(data.notes).trim() : null,
        };
      }
    case 'supplier':
      {
        if (action === 'delete') return {};
        return {
          name: String(data?.name || '').trim(),
          contactName: data?.contactName ? String(data.contactName).trim() : null,
          phone: data?.phone ? String(data.phone).trim() : null,
          email: data?.email ? String(data.email).trim() : null,
          address: data?.address ? String(data.address).trim() : null,
          notes: data?.notes ? String(data.notes).trim() : null,
          discountPercentBp: Number.isFinite(Number(data?.discountPercentBp))
            ? Number(data.discountPercentBp)
            : 0,
          chargesItbis: Boolean(data?.chargesItbis),
          itbisRateBp:
            data?.chargesItbis
              ? Math.min(10000, Math.max(0, Math.round(Number(data?.itbisRateBp ?? 1800))))
              : null,
        };
      }
    case 'category':
      {
        if (action === 'delete') return {};
        return {
          name: String(data?.name || '').trim(),
          description: data?.description ? String(data.description).trim() : null,
        };
      }
    case 'return':
      {
        if (action === 'delete') return {};

        const saleRef = String(data?.saleServerId || data?.saleId || data?.saleLocalId || '').trim();
        let saleLocalId: string | null = null;
        let resolvedSaleId: string | null = null;
        let saleItemsFromLocal: any[] = [];

        if (saleRef) {
          const sale = await db.queryFirst<{ local_id?: string; server_id?: string; data?: string }>(
            'SELECT local_id, server_id, data FROM sales WHERE local_id = ? OR server_id = ? LIMIT 1',
            [saleRef, saleRef]
          );
          saleLocalId = sale?.local_id ? String(sale.local_id) : null;
          resolvedSaleId = sale?.server_id ? String(sale.server_id) : null;
          try {
            const parsed = sale?.data ? JSON.parse(sale.data) : null;
            saleItemsFromLocal = Array.isArray(parsed?.items) ? parsed.items : [];
          } catch {
            saleItemsFromLocal = [];
          }
        }
        if (!resolvedSaleId) {
          resolvedSaleId = String(data?.saleServerId || data?.saleId || '').trim() || null;
        }
        if (!resolvedSaleId) {
          throw new Error('Venta sin server_id para devolución');
        }

        const usedLocalSaleItems = new Set<string>();
        const localSaleCatalog = await Promise.all(
          saleItemsFromLocal.map(async (item: any) => {
            const rawProductId = String(item?.productId || '').trim();
            let productServerId = rawProductId;
            if (rawProductId) {
              const product = await db.queryFirst<{ server_id?: string }>(
                'SELECT server_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
                [rawProductId, rawProductId]
              );
              if (product?.server_id) productServerId = String(product.server_id);
            }
            return {
              saleItemId: String(item?.saleItemId || item?.id || '').trim(),
              productId: productServerId,
              qty: Number(item?.qty || item?.quantity || 0),
              unitPriceCents: Number(item?.unitPriceCents || item?.priceCents || 0),
            };
          })
        );

        let remoteSaleCatalog: Array<{
          saleItemId: string;
          productId: string;
          availableQty: number;
          unitPriceCents: number;
        }> = [];

        const resolveFromCatalog = (
          item: any,
          resolvedProductId: string,
          preferRemote: boolean
        ): string | null => {
          const rawSaleItemId = String(item?.saleItemId || '').trim();
          const qty = Number(item?.qty || 0);
          const unitPriceCents = Number(item?.unitPriceCents || 0);

          const selectCandidate = (catalog: any[], used: Set<string>) => {
            if (!Array.isArray(catalog) || !catalog.length) return null;
            const byId = rawSaleItemId
              ? catalog.find((entry) => entry.saleItemId === rawSaleItemId)
              : null;
            if (byId && !used.has(byId.saleItemId)) {
              return byId;
            }

            const candidates = catalog.filter((entry) => {
              if (!entry?.saleItemId || used.has(entry.saleItemId)) return false;
              const sameProduct = !resolvedProductId || entry.productId === resolvedProductId;
              if (!sameProduct) return false;
              const hasQty = Number(entry.availableQty ?? entry.qty ?? 0) >= qty;
              if (!hasQty) return false;
              if (unitPriceCents > 0 && Number(entry.unitPriceCents || 0) > 0) {
                return Number(entry.unitPriceCents) === unitPriceCents;
              }
              return true;
            });
            return candidates[0] || null;
          };

          if (preferRemote) {
            const fromRemote = selectCandidate(remoteSaleCatalog, usedLocalSaleItems);
            if (fromRemote) return fromRemote.saleItemId;
            const fromLocal = selectCandidate(localSaleCatalog, usedLocalSaleItems);
            if (fromLocal) return fromLocal.saleItemId;
            return null;
          }

          const fromLocal = selectCandidate(localSaleCatalog, usedLocalSaleItems);
          if (fromLocal) return fromLocal.saleItemId;
          const fromRemote = selectCandidate(remoteSaleCatalog, usedLocalSaleItems);
          if (fromRemote) return fromRemote.saleItemId;
          return null;
        };

        const returnItems: Array<{
          saleItemId: string;
          productId: string;
          qty: number;
          unitPriceCents: number;
        }> = [];

        for (const item of data?.items || []) {
          const rawProductId = String(item?.productId || '').trim();
          let resolvedProductId = rawProductId || null;
          if (resolvedProductId) {
            const product = await db.queryFirst<{ server_id?: string }>(
              'SELECT server_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
              [resolvedProductId, resolvedProductId]
            );
            resolvedProductId = product?.server_id ? String(product.server_id) : resolvedProductId;
          }

          let resolvedSaleItemId = resolveFromCatalog(item, String(resolvedProductId || ''), false);
          if (!resolvedSaleItemId && authContext && resolvedSaleId) {
            try {
              if (!remoteSaleCatalog.length) {
                const detailResponse = await axios.get(`${API_URL}/api/returns/sales/${resolvedSaleId}`, {
                  timeout: 20000,
                  headers: {
                    Authorization: `Bearer ${authContext.clerkToken}`,
                    'X-Clerk-Authorization': `Bearer ${authContext.clerkToken}`,
                    'X-SubUser-Token': authContext.subUserToken,
                    ...(authContext.accountId ? { 'X-Account-Id': authContext.accountId } : {}),
                  },
                });
                const remoteItems = Array.isArray(detailResponse.data?.items) ? detailResponse.data.items : [];
                remoteSaleCatalog = remoteItems.map((entry: any) => ({
                  saleItemId: String(entry?.saleItemId || entry?.id || '').trim(),
                  productId: String(entry?.productId || '').trim(),
                  availableQty: Number(entry?.availableQty ?? entry?.qty ?? 0),
                  unitPriceCents: Number(entry?.unitPriceCents || 0),
                }));
              }
              resolvedSaleItemId = resolveFromCatalog(item, String(resolvedProductId || ''), true);
            } catch (remoteSaleError) {
              if (SYNC_DEBUG) {
                console.warn('[SyncService] No se pudo consultar detalle remoto de venta para return', {
                  saleId: resolvedSaleId,
                  error: summarizeError(remoteSaleError),
                });
              }
            }
          }

          if (!resolvedSaleItemId) {
            throw new Error(`Item de venta sin server_id para producto ${rawProductId || '(vacio)'}`);
          }
          if (!resolvedProductId) {
            throw new Error(`Producto sin server_id: ${rawProductId || '(vacio)'}`);
          }

          usedLocalSaleItems.add(resolvedSaleItemId);
          returnItems.push({
            saleItemId: resolvedSaleItemId,
            productId: String(resolvedProductId),
            qty: Number(item?.qty || 0),
            unitPriceCents: Number(item?.unitPriceCents || 0),
            ...(Number.isFinite(Number(item?.itbisRateBp))
              ? { itbisRateBp: Math.max(0, Math.round(Number(item.itbisRateBp))) }
              : {}),
          });
        }

        return {
          saleId: resolvedSaleId,
          salePricesIncludeItbis:
            typeof data.salePricesIncludeItbis === 'boolean' ? data.salePricesIncludeItbis : undefined,
          items: returnItems,
          notes: data?.notes ? String(data.notes).trim() : null,
        };
      }
    default:
      return data;
  }
}
