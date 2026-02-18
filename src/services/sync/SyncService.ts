import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { db } from '../../database/Database';
import { useSyncStore } from '../../store/syncStore';
import { useAuth } from '@clerk/clerk-expo';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
const SYNC_DEBUG = false;

function shortToken(token: string | null | undefined): string {
  if (!token) return 'null';
  return `${token.slice(0, 12)}...(${token.length})`;
}

function summarizeError(error: any) {
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

function normalizeCategoryIdForApi(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return String(parsed);
}

// Helper para obtener token de autenticación
// Nota: Esta función debe ser llamada desde un contexto donde Clerk esté disponible
// En componentes React, usar useAuth().getToken() directamente
async function getAuthToken(): Promise<string | null> {
  try {
    // Clerk guarda el token en SecureStore con una clave específica
    // Intentamos obtenerlo directamente desde SecureStore
    const SecureStore = await import('expo-secure-store');
    // Clerk usa una clave específica para el token, pero es mejor usar getToken() si está disponible
    // Por ahora retornamos null y el código que llama debe proporcionar el token
    return null;
  } catch (error) {
    console.error('Error obteniendo token:', error);
    return null;
  }
}

class SyncService {
  private isSyncing = false;
  private isInitialized = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private unsubscribeNetInfo: (() => void) | null = null;
  private getTokenFn: (() => Promise<string | null>) | null = null;
  private getSubUserTokenFn: (() => Promise<string | null>) | null = null;
  private backendAuthCooldownUntil = 0;
  private lastAuthWaitLogAt = 0;
  private lastFullSyncAttemptAt = 0;

  // Método para establecer la función que obtiene el token de Clerk
  setTokenGetter(fn: () => Promise<string | null>) {
    if (SYNC_DEBUG) console.log('[SyncService] setTokenGetter() configurado');
    this.getTokenFn = fn;
  }

  // Método para establecer la función que obtiene el token JWT del subusuario
  setSubUserTokenGetter(fn: () => Promise<string | null>) {
    if (SYNC_DEBUG) console.log('[SyncService] setSubUserTokenGetter() configurado');
    this.getSubUserTokenFn = fn;
  }

  
  // Métodos públicos para configurar funciones de obtención de tokens
  public setGetTokenFunction(fn: () => Promise<string | null>) {
    if (SYNC_DEBUG) console.log('[SyncService] setGetTokenFunction() configurado');
    this.getTokenFn = fn;
  }

  public setGetSubUserTokenFunction(fn: () => Promise<string | null>) {
    if (SYNC_DEBUG) console.log('[SyncService] setGetSubUserTokenFunction() configurado');
    this.getSubUserTokenFn = fn;
  }

  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Escuchar cambios de conectividad
    this.unsubscribeNetInfo = NetInfo.addEventListener(state => {
      useSyncStore.getState().setIsOnline(state.isConnected ?? false);
      
      if (state.isConnected) {
        this.processQueue();
      }
    });

    // Sincronización periódica cada 5 minutos
    this.syncInterval = setInterval(() => {
      this.incrementalSync();
    }, 5 * 60 * 1000);

    // Actualizar contador de pendientes
    await this.updatePendingCount();
  }

  async fullSync(authToken: string, options?: { ignoreCooldown?: boolean }) {
    if (this.isSyncing) return;
    const now = Date.now();
    if (!options?.ignoreCooldown && now - this.lastFullSyncAttemptAt < 15_000) {
      if (SYNC_DEBUG) console.log('[SyncService] fullSync() omitido por cooldown');
      return;
    }
    this.lastFullSyncAttemptAt = now;
    if (SYNC_DEBUG) console.log('[SyncService] fullSync() start', { authToken: shortToken(authToken) });
    this.isSyncing = true;
    useSyncStore.getState().setIsSyncing(true);

    try {
      // 1. Descargar datos del servidor
      await this.downloadFromServer(authToken);
      
      const pendingBeforeUpload = await this.getPendingQueueCount();
      if (pendingBeforeUpload > 0) {
        // 2. Subir cambios locales pendientes
        await this.uploadPendingChanges(authToken);

        // 3. Volver a descargar para reflejar en local lo aplicado en servidor
        await this.downloadFromServer(authToken);
      } else if (SYNC_DEBUG) {
        console.log('[SyncService] fullSync() sin pendientes, se omite segunda descarga');
      }
      
      // 4. Actualizar timestamp
      useSyncStore.getState().setLastSyncTime(Date.now());
    } catch (error) {
      console.error('Error en sincronización completa:', error);
    } finally {
      if (SYNC_DEBUG) console.log('[SyncService] fullSync() end');
      this.isSyncing = false;
      useSyncStore.getState().setIsSyncing(false);
      await this.updatePendingCount();
    }
  }

  async incrementalSync() {
    const { isOnline } = useSyncStore.getState();
    if (!isOnline || this.isSyncing) return;

    try {
      await this.processQueue();
    } catch (error) {
      console.error('Error en sincronización incremental:', error);
    }
  }

  async queueOperation(entityType: string, action: string, data: any, localId: string) {
    try {
      if (SYNC_DEBUG) {
        console.log('[SyncService] queueOperation()', {
          entityType,
          action,
          localId,
          dataKeys: data ? Object.keys(data) : [],
        });
      }
      await db.insert('sync_queue', {
        entity_type: entityType,
        entity_local_id: localId,
        action,
        data: JSON.stringify(data),
        status: 'pending',
        retry_count: 0,
        created_at: Date.now(),
      });

      await this.updatePendingCount();

      // Intentar sincronizar si hay internet
      const { isOnline } = useSyncStore.getState();
      if (isOnline) {
        // No bloquear la UX por latencia/timeout de red: sincronizar en background.
        this.processQueue().catch((error) => {
          console.error('[SyncService] Error en processQueue background:', summarizeError(error));
        });
      }
    } catch (error) {
      console.error('Error agregando a cola:', error);
    }
  }

  private async processQueue() {
    if (this.isSyncing) return;

    const now = Date.now();
    if (now < this.backendAuthCooldownUntil) {
      if (SYNC_DEBUG) console.log('[SyncService] processQueue() en cooldown', { msRemaining: this.backendAuthCooldownUntil - now });
      return;
    }

    const authStatus = await this.getAuthStatus();
    if (SYNC_DEBUG) console.log('[SyncService] processQueue() authStatus', authStatus);
    const authReady = authStatus.ready;
    if (!authReady) {
      useSyncStore.getState().setSyncBlockedReason(authStatus.reason);
      if (authStatus.reason) {
        this.logAuthWait(authStatus.reason);
      }
      return;
    }
    useSyncStore.getState().setSyncBlockedReason(null);

    this.isSyncing = true;

    try {
      // Reintentar devoluciones que quedaron en error por mapeo temporal de item ids
      await db.runAsync(
        `UPDATE sync_queue
         SET status = 'pending', retry_count = 0
         WHERE status = 'error' AND entity_type = 'return' AND action = 'create'`
      );

      const pending = await db.query<any>(
        'SELECT * FROM sync_queue WHERE status = ? ORDER BY created_at',
        ['pending']
      );
      if (SYNC_DEBUG) console.log('[SyncService] processQueue() pending items', { count: pending.length });

      for (const item of pending) {
        try {
          if (SYNC_DEBUG) {
            console.log('[SyncService] processQueue() syncing item', {
              queueId: item.id,
              entityType: item.entity_type,
              action: item.action,
              entityLocalId: item.entity_local_id,
              retryCount: item.retry_count,
            });
          }
          await this.syncItem(item);
          
          // Marcar como sincronizado
          await db.update('sync_queue', item.id, {
            status: 'synced',
            synced_at: Date.now(),
          }, 'id');
        } catch (error) {
          const stopProcessing = await this.handleSyncError(item, error);
          if (stopProcessing) {
            if (SYNC_DEBUG) console.log('[SyncService] processQueue() stopProcessing=true, cortando ciclo');
            break;
          }
        }
      }
    } finally {
      this.isSyncing = false;
      await this.updatePendingCount();
    }
  }

  private async syncItem(item: any) {
    const data = JSON.parse(item.data);
    const endpoint = this.getEndpoint(item.entity_type, item.action);
    
    // Obtener token de Clerk
    let clerkToken: string | null = null;
    if (this.getTokenFn) {
      clerkToken = await this.getTokenFn();
    } else {
      clerkToken = await getAuthToken();
    }
    
    if (!clerkToken) {
      throw new Error('No hay token de autenticación de Clerk disponible. Por favor, inicia sesión.');
    }

    // Obtener token JWT del subusuario
    let subUserToken: string | null = null;
    let accountId: string | null = null;
    if (this.getSubUserTokenFn) {
      subUserToken = await this.getSubUserTokenFn();
      const { useAuthStore } = await import('../../store/authStore');
      accountId = useAuthStore.getState().accountId;
    } else {
      // Intentar obtener del store directamente
      const { useAuthStore } = await import('../../store/authStore');
      const subUserTokenFromStore = useAuthStore.getState().subUserToken;
      subUserToken = subUserTokenFromStore || null;
      accountId = useAuthStore.getState().accountId;
    }

    if (!subUserToken) {
      throw new Error('No hay token de subusuario disponible. Por favor, selecciona un usuario.');
    }

    if (SYNC_DEBUG) {
      console.log('[SyncService] syncItem() auth context', {
        queueId: item.id,
        endpoint,
        action: item.action,
        accountId,
        clerkToken: shortToken(clerkToken),
        subUserToken: shortToken(subUserToken),
      });
    }

    if (
      item.entity_type === 'product' &&
      (item.action === 'create' || item.action === 'update') &&
      data?.imageUri &&
      (!Array.isArray(data.imageUrls) || data.imageUrls.length === 0)
    ) {
      const uploadedUrls = await this.uploadProductImageFromUri(data.imageUri, clerkToken, subUserToken, accountId);
      if (uploadedUrls.length === 0) {
        console.warn(`No se pudo subir imagen para product ${item.entity_local_id}; se sincronizara sin foto.`);
      } else {
        data.imageUrls = uploadedUrls;
        const updatedQueueData = { ...data };
        await db.update(
          'sync_queue',
          item.id,
          { data: JSON.stringify(updatedQueueData) },
          'id'
        );
      }
    }
    
    // Preparar datos según el tipo de entidad
    const requestData = await this.prepareRequestData(item.entity_type, data, item.action, {
      clerkToken,
      subUserToken,
      accountId,
    });
    
    const paymentCancelRequested =
      item.entity_type === 'payment' &&
      item.action === 'update' &&
      (data?.cancel === true ||
        String(data?.status || '').toLowerCase() === 'cancelled' ||
        Boolean(data?.cancelledAt));

    let method: 'DELETE' | 'PUT' | 'POST' =
      item.action === 'delete' ? 'DELETE' : item.action === 'update' ? 'PUT' : 'POST';
    let url = `${API_URL}/api/${endpoint}`;
    if (paymentCancelRequested) {
      if (!data?.id) {
        throw new Error('No se puede cancelar pago sin id de servidor');
      }
      method = 'POST';
      url = `${API_URL}/api/payments/${data.id}/cancel`;
    } else if (item.action === 'delete' && data?.id) {
      url = `${url}/${data.id}`;
    } else if (item.action === 'update' && data.id) {
      url = `${url}/${data.id}`;
    }

    if (SYNC_DEBUG) {
      console.log('[SyncService] syncItem() request', {
        queueId: item.id,
        method,
        url,
        accountId,
        dataKeys: requestData ? Object.keys(requestData) : [],
        saleStatus: requestData?.status,
        saleCancel: requestData?.cancel,
      });
    }
    
    const response = await axios({
      method,
      url,
      data: requestData,
      timeout: 25000,
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
        'Content-Type': 'application/json',
      },
    });

    // Actualizar estado local después de sincronizar
    if (item.action === 'create') {
      const createdId =
        response.data?.id ||
        response.data?.data?.id ||
        response.data?.customer?.id ||
        response.data?.product?.id ||
        response.data?.sale?.id ||
        response.data?.quote?.id ||
        null;
      if (!createdId) {
        throw new Error(`Respuesta de create sin id para ${item.entity_type}`);
      }

      const table = this.getTableName(item.entity_type);
      await db.update(table, item.entity_local_id, {
        server_id: createdId,
        synced: 1,
        ...(item.entity_type === 'sale'
          ? {
              invoice_code:
                response.data?.invoiceCode ||
                response.data?.data?.invoiceCode ||
                response.data?.sale?.invoiceCode ||
                data?.invoiceCode ||
                null,
              data: JSON.stringify({
                ...data,
                invoiceCode:
                  response.data?.invoiceCode ||
                  response.data?.data?.invoiceCode ||
                  response.data?.sale?.invoiceCode ||
                  data?.invoiceCode ||
                  null,
                serverId: createdId,
              }),
            }
          : {}),
        ...(item.entity_type === 'quote'
          ? {
              quote_code:
                response.data?.quoteCode ||
                response.data?.data?.quoteCode ||
                response.data?.quote?.quoteCode ||
                data?.quoteCode ||
                null,
              status: 'synced',
              data: JSON.stringify({
                ...data,
                quoteCode:
                  response.data?.quoteCode ||
                  response.data?.data?.quoteCode ||
                  response.data?.quote?.quoteCode ||
                  data?.quoteCode ||
                  null,
                serverId: createdId,
              }),
            }
          : {}),
        ...(item.entity_type === 'product' && Array.isArray(data?.imageUrls)
          ? { data: JSON.stringify({ ...data, imageUrls: data.imageUrls }) }
          : {}),
        ...(item.entity_type === 'purchase'
          ? {
              data: JSON.stringify({
                ...(data || {}),
                id: createdId,
                serverId: createdId,
              }),
            }
          : {}),
        ...(item.entity_type === 'payment'
          ? {
              receipt_code:
                response.data?.receiptCode ||
                response.data?.data?.receiptCode ||
                data?.receiptCode ||
                null,
              data: JSON.stringify({
                ...(data || {}),
                id: createdId,
                serverId: createdId,
                receiptNumber:
                  response.data?.receiptNumber ||
                  response.data?.data?.receiptNumber ||
                  data?.receiptNumber ||
                  null,
                receiptCode:
                  response.data?.receiptCode ||
                  response.data?.data?.receiptCode ||
                  data?.receiptCode ||
                  null,
                paidAt:
                  response.data?.paidAt ||
                  response.data?.data?.paidAt ||
                  data?.paidAt ||
                  data?.createdAt ||
                  null,
              }),
            }
          : {}),
        ...(item.entity_type === 'return'
          ? {
              return_code:
                response.data?.returnCode ||
                response.data?.data?.returnCode ||
                data?.returnCode ||
                null,
              data: JSON.stringify({
                ...(data || {}),
                id: createdId,
                serverId: createdId,
                returnCode:
                  response.data?.returnCode ||
                  response.data?.data?.returnCode ||
                  data?.returnCode ||
                  null,
              }),
            }
          : {}),
      }, 'local_id');

      if (item.entity_type === 'return') {
        await db.runAsync(
          'UPDATE return_items SET synced = 1 WHERE return_local_id = ?',
          [item.entity_local_id]
        );
      }
    } else if (item.action === 'update') {
      const table = this.getTableName(item.entity_type);
      const updatePatch: any = {
        synced: 1,
      };
      if (item.entity_type === 'payment' && paymentCancelRequested) {
        const now = data?.cancelledAt || Date.now();
        updatePatch.data = JSON.stringify({
          ...(data || {}),
          status: 'cancelled',
          cancel: true,
          cancelledAt: now,
        });
      }
      if (item.entity_type === 'purchase') {
        updatePatch.data = JSON.stringify({
          ...(data || {}),
          ...(data?.id ? { serverId: data.id } : {}),
        });
      }
      await db.update(table, item.entity_local_id, {
        ...updatePatch,
        ...(item.entity_type === 'product' && Array.isArray(data?.imageUrls)
          ? { data: JSON.stringify({ ...data, imageUrls: data.imageUrls }) }
          : {}),
      }, 'local_id');
    }
  }

  private async uploadProductImageFromUri(
    imageUri: string,
    clerkToken: string,
    subUserToken: string,
    accountId: string | null
  ): Promise<string[]> {
    try {
      const uri = String(imageUri || '').trim();
      if (!uri) return [];

      const fileName = uri.split('/').pop() || `product-${Date.now()}.jpg`;
      const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : 'jpg';
      const mimeType =
        extension === 'png'
          ? 'image/png'
          : extension === 'webp'
            ? 'image/webp'
            : extension === 'heic'
              ? 'image/heic'
              : 'image/jpeg';

      const form = new FormData();
      form.append('file', {
        uri,
        name: fileName,
        type: mimeType,
      } as any);

      const uploadUrl = `${API_URL}/api/upload-product-image`;
      console.log('[SyncService][upload-product-image] Inicio upload', {
        uploadUrl,
        uri,
        fileName,
        mimeType,
      });
      try {
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': subUserToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
          },
          body: form as any,
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(`Upload HTTP ${response.status}: ${bodyText}`);
        }

        const payload = await response.json();
        const url =
          payload?.url ||
          payload?.data?.url ||
          payload?.file?.url ||
          null;
        if (url) {
          console.log('[SyncService][upload-product-image] Multipart OK', { url: String(url) });
          return [String(url)];
        }
        console.warn('[SyncService][upload-product-image] Multipart respondió sin URL', { payload });
      } catch (multipartError) {
        console.warn('[SyncService][upload-product-image] Multipart falló, intentando fallback base64...', summarizeError(multipartError));
      }

      // Fallback robusto para Android/Expo Go: enviar base64 en JSON
      const base64 = await LegacyFileSystem.readAsStringAsync(uri, {
        encoding: 'base64' as any,
      });
      if (!base64) {
        console.warn('[SyncService][upload-product-image] Fallback base64 vacío');
        return [];
      }
      console.log('[SyncService][upload-product-image] Fallback base64 generado', {
        base64Length: base64.length,
      });

      const jsonResp = await axios.post(
        uploadUrl,
        { base64, fileName, mimeType },
        {
          headers: {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': subUserToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        }
      );

      const url =
        jsonResp.data?.url ||
        jsonResp.data?.data?.url ||
        jsonResp.data?.file?.url ||
        null;
      if (!url) {
        console.warn('[SyncService][upload-product-image] Fallback JSON respondió sin URL', { data: jsonResp.data });
        return [];
      }
      console.log('[SyncService][upload-product-image] Fallback JSON OK', { url: String(url) });
      return [String(url)];
    } catch (error) {
      console.error('[SyncService][upload-product-image] Error subiendo imagen de producto:', summarizeError(error));
      return [];
    }
  }

  private async prepareRequestData(
    entityType: string,
    data: any,
    action: string,
    authContext?: { clerkToken: string; subUserToken: string; accountId: string | null }
  ): Promise<any> {
    switch (entityType) {
      case 'product':
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
          imageUrls: data.imageUrls || [],
          purchaseUnit: data.purchaseUnit || 'UNIDAD',
          saleUnit: data.saleUnit || 'UNIDAD',
        };
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
          note: data.note || null,
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
              wasPriceOverridden: item.wasPriceOverridden || false,
            };
          })
        );

        return {
          customerId: resolvedQuoteCustomerId,
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
            });
          }

          return {
            saleId: resolvedSaleId,
            items: returnItems,
            notes: data?.notes ? String(data.notes).trim() : null,
          };
        }
      default:
        return data;
    }
  }

  private async handleSyncError(item: any, error: any): Promise<boolean> {
    if (SYNC_DEBUG) {
      console.log('[SyncService] handleSyncError()', {
        queueId: item?.id,
        entityType: item?.entity_type,
        action: item?.action,
        summary: summarizeError(error),
      });
    }
    const dependencyError =
      (typeof error?.message === 'string' &&
        (error.message.includes('Producto sin server_id') ||
          error.message.includes('Item de venta sin server_id') ||
          error.message.includes('Venta sin server_id para devolución'))) ||
      (axios.isAxiosError(error) &&
        String(error.response?.data?.error || '').includes('Item de venta no encontrado'));
    if (dependencyError) {
      console.warn(`Sync pendiente por dependencia (${item.entity_type} #${item.id}): ${error.message}`);
      return false;
    }

    const authNotReadyError =
      typeof error?.message === 'string' &&
      (error.message.includes('No hay token de autenticación de Clerk disponible') ||
        error.message.includes('No hay token de subusuario disponible'));
    if (authNotReadyError) {
      useSyncStore.getState().setSyncBlockedReason(
        error.message.includes('subusuario')
          ? 'Sync pausado: falta autenticacion de subusuario. Inicia sesion del usuario de caja.'
          : 'Sync pausado: falta autenticacion principal (Clerk). Inicia sesion nuevamente.'
      );
      console.warn(`Sync en espera de sesion (${item.entity_type} #${item.id}): ${error.message}`);
      return true;
    }

    const backendErrorMessage = axios.isAxiosError(error)
      ? String(error.response?.data?.error || error.response?.data?.message || '').toLowerCase()
      : '';
    const backendErrorRaw = axios.isAxiosError(error)
      ? String(error.response?.data?.error || error.response?.data?.message || error.message || '')
      : String(error?.message || '');
    const backendStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
    const backendAuthError =
      axios.isAxiosError(error) &&
      (backendStatus === 401 || backendStatus === 403);
    if (backendAuthError) {
      this.backendAuthCooldownUntil = Date.now() + 60_000;
      if (SYNC_DEBUG) {
        console.log('[SyncService] backendAuthError detectado', {
          queueId: item?.id,
          status: axios.isAxiosError(error) ? error.response?.status : null,
          backendErrorMessage,
          cooldownUntil: this.backendAuthCooldownUntil,
        });
      }
      try {
        const { useAuthStore } = await import('../../store/authStore');
        const state = useAuthStore.getState();
        if (state.subUserToken) {
          if (SYNC_DEBUG) {
            console.log('[SyncService] limpiando subusuario por backendAuthError', {
              accountId: state.accountId,
              subUser: state.subUser?.username,
              subUserToken: shortToken(state.subUserToken),
            });
          }
          await state.setSubUser(null, null, null);
        }
      } catch (clearSessionError) {
        console.warn('No se pudo limpiar sesion de subusuario tras 401/403:', clearSessionError);
      }
      useSyncStore.getState().setSyncBlockedReason(
        'Sync pausado: backend rechazo autenticacion. Debes volver a seleccionar usuario para continuar.'
      );
      if (item.entity_type === 'customer') {
        await db.update(
          'sync_queue',
          item.id,
          { status: 'error', retry_count: item.retry_count + 1 },
          'id'
        );
        console.warn(
          `Sync detenido para customer #${item.id}: backend responde "No autenticado" en POST /customers.`
        );
        return true;
      }
      console.warn(`Sync en espera de autenticacion backend (${item.entity_type} #${item.id}).`);
      return true;
    }

    const backendAuthLikeMessage =
      axios.isAxiosError(error) &&
      (
        backendErrorMessage.includes('no autenticado') ||
        backendErrorMessage.includes('unauthorized') ||
        backendErrorMessage.includes('not authenticated')
      );
    if (backendAuthLikeMessage && SYNC_DEBUG) {
      console.warn('[SyncService] backend devolvió mensaje de auth con status no-auth estándar', {
        queueId: item?.id,
        entityType: item?.entity_type,
        action: item?.action,
        status: backendStatus,
        backendErrorMessage,
      });
    }

    const isReturnCreate = item?.entity_type === 'return' && item?.action === 'create';
    const returnBusinessRejected =
      isReturnCreate &&
      (
        backendErrorMessage.includes('no permite devoluciones') ||
        backendErrorMessage.includes('pagada totalmente') ||
        backendErrorMessage.includes('balance pendiente') ||
        backendErrorMessage.includes('cuenta por cobrar') ||
        backendErrorMessage.includes('factura a credito') ||
        backendErrorMessage.includes('factura a crédito')
      );
    if (returnBusinessRejected) {
      await this.rejectReturnLocally(item, backendErrorRaw || 'Devolucion rechazada por backend');
      return false;
    }

    const backendBusinessError =
      axios.isAxiosError(error) &&
      typeof error.response?.data?.error === 'string' &&
      (error.response.data.error.includes('producto inválido') ||
        error.response.data.error.includes('producto invalido') ||
        error.response.data.error.includes('inactivo'));
    const localBusinessError =
      typeof error?.message === 'string' && error.message.includes('Producto inactivo en carrito');
    if (backendBusinessError || localBusinessError) {
      await db.update(
        'sync_queue',
        item.id,
        { status: 'error', retry_count: item.retry_count + 1 },
        'id'
      );
      console.warn(`Sync detenido por validacion de negocio (${item.entity_type} #${item.id}).`);
      return false;
    }

    const retryCount = item.retry_count + 1;
    
    if (retryCount >= 5) {
      await db.update('sync_queue', item.id, {
        status: 'error',
        retry_count: retryCount,
      }, 'id');
    } else {
      await db.update('sync_queue', item.id, {
        retry_count: retryCount,
      }, 'id');
    }
    
    if (axios.isAxiosError(error)) {
      console.error(`Error sincronizando ${item.entity_type}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
        queueId: item.id,
        action: item.action,
      });
      return false;
    }

    console.error(`Error sincronizando ${item.entity_type}:`, {
      message: error?.message || String(error),
      queueId: item.id,
      action: item.action,
    });
    return false;
  }

  private async rejectReturnLocally(item: any, rejectReason: string): Promise<void> {
    const now = Date.now();
    const returnLocalId = String(item?.entity_local_id || '').trim();

    if (!returnLocalId) {
      await db.update(
        'sync_queue',
        item.id,
        { status: 'synced', synced_at: now, retry_count: item.retry_count + 1 },
        'id'
      );
      return;
    }

    const queueData = (() => {
      try {
        return item?.data ? JSON.parse(item.data) : {};
      } catch {
        return {};
      }
    })();

    const returnRow = await db.queryFirst<any>(
      'SELECT local_id, total_cents, notes, data FROM returns WHERE local_id = ? LIMIT 1',
      [returnLocalId]
    );

    if (returnRow) {
      let parsedReturn: any = null;
      try {
        parsedReturn = returnRow.data ? JSON.parse(returnRow.data) : null;
      } catch {
        parsedReturn = null;
      }

      const existingNotes = String(returnRow.notes || parsedReturn?.notes || '').trim();
      const rejectionTag = '[ANULADA POR RECHAZO API]';
      const composedNote = existingNotes
        ? `${existingNotes}\n${rejectionTag} ${rejectReason}`
        : `${rejectionTag} ${rejectReason}`;

      await db.update('returns', returnLocalId, {
        cancelled_at: now,
        notes: composedNote,
        synced: 1,
        data: JSON.stringify({
          ...(parsedReturn || {}),
          notes: composedNote,
          cancelledAt: now,
          syncRejected: true,
          syncRejectedAt: now,
          syncRejectedReason: rejectReason,
        }),
      });

      await db.runAsync(
        'UPDATE return_items SET synced = 1 WHERE return_local_id = ?',
        [returnLocalId]
      );

      const arLocalId = String(queueData?.arLocalId || parsedReturn?.arLocalId || '').trim();
      if (arLocalId) {
        const arRow = await db.queryFirst<any>(
          'SELECT total_cents, balance_cents, paid_cents, status, data FROM accounts_receivable WHERE local_id = ? LIMIT 1',
          [arLocalId]
        );

        if (arRow) {
          let parsedAr: any = null;
          try {
            parsedAr = arRow.data ? JSON.parse(arRow.data) : null;
          } catch {
            parsedAr = null;
          }

          const totalCents = Number(arRow.total_cents || parsedAr?.totalCents || 0);
          const currentBalanceCents = Number(arRow.balance_cents || parsedAr?.balanceCents || 0);
          const returnTotalCents = Number(returnRow.total_cents || parsedReturn?.totalCents || 0);
          const nextBalanceCents = Math.min(totalCents, Math.max(0, currentBalanceCents + returnTotalCents));
          const nextPaidCents = Math.max(0, totalCents - nextBalanceCents);
          const nextStatus = nextBalanceCents <= 0 ? 'PAGADO' : nextBalanceCents === totalCents ? 'PENDIENTE' : 'PARCIAL';

          await db.update('accounts_receivable', arLocalId, {
            balance_cents: nextBalanceCents,
            paid_cents: nextPaidCents,
            status: nextStatus,
            synced: 1,
            data: JSON.stringify({
              ...(parsedAr || {}),
              balanceCents: nextBalanceCents,
              paidCents: nextPaidCents,
              status: nextStatus,
            }),
          });
        }
      }
    }

    await db.update(
      'sync_queue',
      item.id,
      { status: 'synced', synced_at: now, retry_count: item.retry_count + 1 },
      'id'
    );
    console.warn(
      `Devolucion ${returnLocalId} anulada localmente por rechazo de backend: ${rejectReason}`
    );
  }

  private logAuthWait(message: string) {
    const now = Date.now();
    if (now - this.lastAuthWaitLogAt > 30_000) {
      this.lastAuthWaitLogAt = now;
      console.warn(message);
    }
  }

  private async hasAuthContext(): Promise<boolean> {
    const status = await this.getAuthStatus();
    return status.ready;
  }

  private async getAuthStatus(): Promise<{ ready: boolean; reason: string | null }> {
    // Si Clerk aun no inyecto getToken (arranque de app), no avisar error de sesion.
    if (!this.getTokenFn) {
      return { ready: false, reason: null };
    }

    let clerkToken: string | null = null;
    clerkToken = await this.getTokenFn();
    if (SYNC_DEBUG) console.log('[SyncService] getAuthStatus() clerkToken', shortToken(clerkToken));
    if (!clerkToken) {
      return {
        ready: false,
        reason: 'Sync pausado: no hay sesion principal activa. Inicia sesion para continuar.',
      };
    }

    let subUserToken: string | null = null;
    if (this.getSubUserTokenFn) {
      subUserToken = await this.getSubUserTokenFn();
    } else {
      const { useAuthStore } = await import('../../store/authStore');
      subUserToken = useAuthStore.getState().subUserToken || null;
    }
    if (SYNC_DEBUG) console.log('[SyncService] getAuthStatus() subUserToken', shortToken(subUserToken));

    if (!subUserToken) {
      return {
        ready: false,
        reason: 'Sync pausado: falta autenticacion de subusuario. Selecciona el usuario de caja.',
      };
    }

    return { ready: true, reason: null };
  }

  private async downloadFromServer(authToken: string) {
    try {
      // Obtener token de Clerk
      let clerkToken = authToken;
      if (!clerkToken) {
        if (this.getTokenFn) {
          clerkToken = await this.getTokenFn() || '';
        } else {
          clerkToken = await getAuthToken() || '';
        }
      }
      
      console.log('🔑 [SyncService] Clerk Token:', clerkToken ? `${clerkToken.substring(0, 20)}...` : 'NO TOKEN');
      
      if (!clerkToken) {
        throw new Error('No hay token de autenticación de Clerk disponible. Por favor, inicia sesión.');
      }

      // Obtener token JWT del subusuario
      let subUserToken: string | null = null;
      let accountId: string | null = null;
      if (this.getSubUserTokenFn) {
        subUserToken = await this.getSubUserTokenFn();
        console.log('🔑 [SyncService] SubUser Token (from getter):', subUserToken ? `${subUserToken.substring(0, 20)}...` : 'NO TOKEN');
        const { useAuthStore } = await import('../../store/authStore');
        accountId = useAuthStore.getState().accountId;
      } else {
        const { useAuthStore } = await import('../../store/authStore');
        subUserToken = useAuthStore.getState().subUserToken;
        accountId = useAuthStore.getState().accountId;
        console.log('🔑 [SyncService] SubUser Token (from store):', subUserToken ? `${subUserToken.substring(0, 20)}...` : 'NO TOKEN');
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

      console.log('📡 [SyncService] Descargando productos desde:', `${API_URL}/api/products`);
      
      const headers = { 
        'Authorization': `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };
      
      console.log('📤 [SyncService] Headers que se van a enviar:', {
        'X-Clerk-Authorization': headers['X-Clerk-Authorization'] ? headers['X-Clerk-Authorization'].substring(0, 30) + '...' : 'MISSING',
        'X-SubUser-Token': headers['X-SubUser-Token'] ? headers['X-SubUser-Token'].substring(0, 20) + '...' : 'MISSING',
      });

      // Descargar productos
      const productsResponse = await axios.get(`${API_URL}/api/products`, {
        headers,
      });
      
      console.log('✅ [SyncService] Productos descargados:', productsResponse.data?.data?.length || productsResponse.data?.length || 0);
      
      const products = productsResponse.data?.data || productsResponse.data || [];
      
      for (const product of products) {
        const exists = await db.queryFirst(
          'SELECT * FROM products WHERE server_id = ?',
          [product.id]
        );
        
        const productData = {
          name: product.name,
          sku: product.sku,
          cost_cents: product.costCents || Math.round((product.cost || 0) * 100),
          price_cents: product.priceCents || Math.round((product.price || 0) * 100),
          stock: product.stock || 0,
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

      // Descargar clientes
      const customersResponse = await axios.get(`${API_URL}/api/customers`, {
        headers,
      });
      if (SYNC_DEBUG) {
        console.log('[SyncService] downloadFromServer() customers status', {
          status: customersResponse.status,
          count: (customersResponse.data?.data || customersResponse.data || []).length,
        });
      }
      
      const customers = customersResponse.data?.data || customersResponse.data || [];
      
      for (const customer of customers) {
        const exists = await db.queryFirst(
          'SELECT * FROM customers WHERE server_id = ?',
          [customer.id]
        );
        
        const customerData = {
          name: customer.name,
          phone: customer.phone || null,
          synced: 1,
          data: JSON.stringify(customer),
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

      // Descargar proveedores
      const suppliersResponse = await axios.get(`${API_URL}/api/suppliers`, {
        headers,
      });
      const suppliers = suppliersResponse.data?.data || suppliersResponse.data || [];
      for (const supplier of suppliers) {
        const supplierId = String(supplier?.id || '');
        if (!supplierId) continue;

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

      // Descargar categorias
      const categoriesResponse = await axios.get(`${API_URL}/api/categories`, {
        headers,
      });
      const categories = categoriesResponse.data?.data || categoriesResponse.data || [];
      for (const category of categories) {
        const categoryServerId = String(category?.id || '');
        if (!categoryServerId) continue;

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

      // Descargar ventas/facturas
      const salesResponse = await axios.get(`${API_URL}/api/sales`, {
        headers,
      });
      if (SYNC_DEBUG) {
        console.log('[SyncService] downloadFromServer() sales status', {
          status: salesResponse.status,
          count: (salesResponse.data?.data || salesResponse.data || []).length,
        });
      }

      const sales = salesResponse.data?.data || salesResponse.data || [];

      for (const sale of sales) {
        const saleId = String(sale?.id || '');
        if (!saleId) continue;

        let saleDetail: any = null;
        try {
          const detailResponse = await axios.get(`${API_URL}/api/sales/${saleId}`, { headers });
          saleDetail = detailResponse.data || null;
        } catch (error) {
          if (SYNC_DEBUG) {
            console.warn('[SyncService] No se pudo descargar detalle de factura', {
              saleId,
              error: summarizeError(error),
            });
          }
        }

        const customerId = saleDetail?.customerId || sale?.customerId || null;
        const customerName = saleDetail?.customerName || sale?.customerName || null;
        const soldAtRaw = saleDetail?.soldAt || sale?.soldAt || null;
        const createdAt =
          soldAtRaw && !Number.isNaN(new Date(soldAtRaw).getTime())
            ? new Date(soldAtRaw).getTime()
            : Date.now();
        const cancelledAtRaw = saleDetail?.cancelledAt || sale?.cancelledAt || null;
        const status = cancelledAtRaw ? 'cancelled' : 'completed';

        const items = Array.isArray(saleDetail?.items)
          ? saleDetail.items.map((item: any) => ({
              saleItemId: String(item?.id || item?.saleItemId || ''),
              productId: String(item?.productId || ''),
              productName: String(item?.productName || 'Producto'),
              quantity: Number(item?.qty || 0),
              priceCents: Number(item?.unitPriceCents || 0),
              totalCents: Number(item?.lineTotalCents || 0),
            }))
          : [];

        const saleData = {
          id: saleId,
          invoiceCode: String(saleDetail?.invoiceCode || sale?.invoiceCode || '-'),
          soldAt: createdAt,
          customerId,
          customerName,
          paymentMethod: String(saleDetail?.paymentMethod || sale?.paymentMethod || 'EFECTIVO'),
          type: String(saleDetail?.type || sale?.type || 'CONTADO'),
          items,
          subtotalCents: Number(saleDetail?.subtotalCents || sale?.subtotalCents || 0),
          itbisCents: Number(saleDetail?.itbisCents || sale?.itbisCents || 0),
          shippingCents: Number(saleDetail?.shippingCents || sale?.shippingCents || 0),
          totalCents: Number(saleDetail?.totalCents || sale?.totalCents || 0),
          status,
          cancelledAt: cancelledAtRaw,
          createdAt,
        };

        const saleRow = {
          invoice_code: saleData.invoiceCode,
          customer_id: customerId,
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

      // Descargar devoluciones
      const returnsResponse = await axios.get(`${API_URL}/api/returns`, {
        headers,
      });
      const returnsRows = returnsResponse.data?.data || returnsResponse.data || [];
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
            data: JSON.stringify(item),
          });
        }
      }

      // Descargar cotizaciones
      const quotesResponse = await axios.get(`${API_URL}/api/quotes`, {
        headers,
      });
      if (SYNC_DEBUG) {
        console.log('[SyncService] downloadFromServer() quotes status', {
          status: quotesResponse.status,
          count: (quotesResponse.data?.data || quotesResponse.data || []).length,
        });
      }

      const quotes = quotesResponse.data?.data || quotesResponse.data || [];

      for (const quote of quotes) {
        const quoteId = String(quote?.id || '');
        if (!quoteId) continue;

        let quoteDetail: any = null;
        try {
          const detailResponse = await axios.get(`${API_URL}/api/quotes/${quoteId}`, { headers });
          quoteDetail = detailResponse.data || null;
        } catch (error) {
          if (SYNC_DEBUG) {
            console.warn('[SyncService] No se pudo descargar detalle de cotizacion', {
              quoteId,
              error: summarizeError(error),
            });
          }
        }

        const customerId = quoteDetail?.customerId || quote?.customerId || null;
        const customerName = quoteDetail?.customerName || quote?.customerName || null;
        const quotedAtRaw = quoteDetail?.quotedAt || quote?.quotedAt || null;
        const createdAt =
          quotedAtRaw && !Number.isNaN(new Date(quotedAtRaw).getTime())
            ? new Date(quotedAtRaw).getTime()
            : Date.now();

        const items = Array.isArray(quoteDetail?.items)
          ? quoteDetail.items.map((item: any) => ({
              productId: String(item?.productId || ''),
              productName: String(item?.productName || 'Producto'),
              quantity: Number(item?.qty || 0),
              priceCents: Number(item?.unitPriceCents || 0),
              totalCents: Number(item?.lineTotalCents || 0),
            }))
          : [];

        const quoteData = {
          id: quoteId,
          quoteCode: String(quoteDetail?.quoteCode || quote?.quoteCode || '-'),
          customerId,
          customerName,
          items,
          totalCents: Number(quoteDetail?.totalCents || quote?.totalCents || 0),
          status: 'synced',
          createdAt,
          validUntil: quoteDetail?.validUntil || quote?.validUntil || null,
          notes: quoteDetail?.notes || quote?.notes || null,
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

      // Descargar compras
      const purchaseProductRows = await db.query<{ local_id: string; server_id?: string }>(
        'SELECT local_id, server_id FROM products WHERE server_id IS NOT NULL'
      );
      const localProductByServerId = new Map<string, string>();
      for (const row of purchaseProductRows) {
        if (row.server_id) {
          localProductByServerId.set(String(row.server_id), String(row.local_id));
        }
      }

      const purchasesResponse = await axios.get(`${API_URL}/api/purchases`, {
        headers,
      });
      const purchases = purchasesResponse.data?.data || purchasesResponse.data || [];

      for (const purchase of purchases) {
        const purchaseId = String(purchase?.id || '');
        if (!purchaseId) continue;

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
          updateProductCost: true,
          updateProductPrice: true,
        };

        const purchaseRow = {
          supplier_name: purchaseData.supplierName || null,
          total_cents: purchaseData.totalCents,
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

      // Descargar cuentas por cobrar (paginado para evitar truncar por take default del backend)
      const arItems: any[] = [];
      const arTake = 200;
      let arSkip = 0;
      while (true) {
        const arResponse = await axios.get(`${API_URL}/api/accounts-receivable`, {
          headers,
          params: { skip: arSkip, take: arTake },
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
        serverOpenArIds.add(String(ar.id));
        const exists = await db.queryFirst(
          'SELECT * FROM accounts_receivable WHERE server_id = ?',
          [ar.id]
        );

        const totalCents = ar.totalCents || 0;
        const balanceCents = ar.balanceCents || 0;
        const paidCents = Math.max(0, totalCents - balanceCents);
        const customerName = ar.customer?.name || 'Cliente';
        const customerId = ar.customerId || ar.customer?.id || 'unknown';
        const dueDate = ar.dueDate ? new Date(ar.dueDate).getTime() : null;

        const arData = {
          customer_id: customerId,
          customer_name: customerName,
          total_cents: totalCents,
          paid_cents: paidCents,
          balance_cents: balanceCents,
          status: ar.status || 'PENDIENTE',
          due_date: dueDate,
          synced: 1,
          data: JSON.stringify(ar),
        };

        if (exists) {
          await db.update('accounts_receivable', ar.id, arData, 'server_id');
        } else {
          await db.insert('accounts_receivable', {
            local_id: `server_ar_${ar.id}`,
            server_id: ar.id,
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

      // Descargar recibos de pago (incluye cancelados para historial)
      const paymentsResponse = await axios.get(`${API_URL}/api/payments`, {
        headers,
        params: { take: 500 },
      });
      if (SYNC_DEBUG) {
        console.log('[SyncService] downloadFromServer() payments status', {
          status: paymentsResponse.status,
          count: (paymentsResponse.data?.data || paymentsResponse.data || []).length,
        });
      }

      const payments = paymentsResponse.data?.data || paymentsResponse.data || [];
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
          customerName: payment?.customer?.name ? String(payment.customer.name) : 'Cliente',
          amountCents: Number(payment?.amountCents || 0),
          method: String(payment?.method || 'EFECTIVO'),
          note: payment?.note || null,
          createdAt: paidAtMs,
          paidAt: paidAtMs,
          cancelledAt: cancelledAtMs,
        };

        const paymentRow = {
          receipt_code: paymentData.receiptCode || `R-${serverPaymentId}`,
          amount_cents: paymentData.amountCents,
          ar_id: arLocalId,
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

      // Descargar gastos operativos
      const operatingExpensesResponse = await axios.get(`${API_URL}/api/operating-expenses`, {
        headers,
      });
      const operatingExpenses = operatingExpensesResponse.data?.data || operatingExpensesResponse.data || [];
      for (const expense of operatingExpenses) {
        const expenseId = String(expense?.id || '');
        if (!expenseId) continue;
        const expenseDateMs =
          expense?.expenseDate && !Number.isNaN(new Date(expense.expenseDate).getTime())
            ? new Date(expense.expenseDate).getTime()
            : Date.now();
        const expenseData = {
          id: expenseId,
          serverId: expenseId,
          description: String(expense?.description || ''),
          amountCents: Number(expense?.amountCents || 0),
          expenseDate: new Date(expenseDateMs).toISOString(),
          category: expense?.category ? String(expense.category) : null,
          notes: expense?.notes ? String(expense.notes) : null,
          createdAt: expense?.createdAt ? String(expense.createdAt) : null,
          updatedAt: expense?.updatedAt ? String(expense.updatedAt) : null,
        };
        const expenseRow = {
          description: expenseData.description,
          amount_cents: expenseData.amountCents,
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
    } catch (error: any) {
      console.error('❌ [SyncService] Error descargando datos del servidor:', error);
      if (error.response) {
        console.error('❌ [SyncService] Status:', error.response.status);
        console.error('❌ [SyncService] Data:', error.response.data);
      }
      throw error;
    }
  }

  private async uploadPendingChanges(authToken: string) {
    await this.processQueue();
  }

  private async getPendingQueueCount(): Promise<number> {
    const result = await db.queryFirst<any>(
      'SELECT COUNT(*) as count FROM sync_queue WHERE status = ?',
      ['pending']
    );
    return Number(result?.count || 0);
  }

  private async updatePendingCount() {
    const count = await this.getPendingQueueCount();
    useSyncStore.getState().setPendingCount(count);
  }

  private getEndpoint(entityType: string, action: string): string {
    const endpoints: Record<string, string> = {
      'sale': 'sales',
      'quote': 'quotes',
      'product': 'products',
      'customer': 'customers',
      'category': 'categories',
      'supplier': 'suppliers',
      'return': 'returns',
      'payment': 'payments',
      'purchase': 'purchases',
      'operating_expense': 'operating-expenses',
    };
    return endpoints[entityType] || entityType;
  }

  private getTableName(entityType: string): string {
    const tables: Record<string, string> = {
      'sale': 'sales',
      'quote': 'quotes',
      'product': 'products',
      'customer': 'customers',
      'category': 'categories',
      'supplier': 'suppliers',
      'return': 'returns',
      'payment': 'payments',
      'purchase': 'purchases',
      'operating_expense': 'operating_expenses',
    };
    return tables[entityType] || entityType;
  }

  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
    this.isInitialized = false;
    this.isSyncing = false;
  }
}

export const syncService = new SyncService();


