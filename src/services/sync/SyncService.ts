import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { db } from '../../database/Database';
import { useSyncStore } from '../../store/syncStore';
import { useAuth } from '@clerk/clerk-expo';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';

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

  // Método para establecer la función que obtiene el token de Clerk
  setTokenGetter(fn: () => Promise<string | null>) {
    this.getTokenFn = fn;
  }

  // Método para establecer la función que obtiene el token JWT del subusuario
  setSubUserTokenGetter(fn: () => Promise<string | null>) {
    this.getSubUserTokenFn = fn;
  }

  
  // Métodos públicos para configurar funciones de obtención de tokens
  public setGetTokenFunction(fn: () => Promise<string | null>) {
    this.getTokenFn = fn;
  }

  public setGetSubUserTokenFunction(fn: () => Promise<string | null>) {
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

  async fullSync(authToken: string) {
    if (this.isSyncing) return;
    this.isSyncing = true;
    useSyncStore.getState().setIsSyncing(true);

    try {
      // 1. Descargar datos del servidor
      await this.downloadFromServer(authToken);
      
      // 2. Subir cambios locales pendientes
      await this.uploadPendingChanges(authToken);

      // 3. Volver a descargar para reflejar en local lo aplicado en servidor
      await this.downloadFromServer(authToken);
      
      // 4. Actualizar timestamp
      useSyncStore.getState().setLastSyncTime(Date.now());
    } catch (error) {
      console.error('Error en sincronización completa:', error);
    } finally {
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
        await this.processQueue();
      }
    } catch (error) {
      console.error('Error agregando a cola:', error);
    }
  }

  private async processQueue() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const pending = await db.query<any>(
        'SELECT * FROM sync_queue WHERE status = ? ORDER BY created_at',
        ['pending']
      );

      for (const item of pending) {
        try {
          await this.syncItem(item);
          
          // Marcar como sincronizado
          await db.update('sync_queue', item.id, {
            status: 'synced',
            synced_at: Date.now(),
          }, 'id');
        } catch (error) {
          await this.handleSyncError(item, error);
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
    const requestData = await this.prepareRequestData(item.entity_type, data, item.action);
    
    let url = `${API_URL}/api/${endpoint}`;
    if (item.action === 'update' && data.id) {
      url = `${url}/${data.id}`;
    }
    
    const response = await axios({
      method: item.action === 'delete' ? 'DELETE' : item.action === 'update' ? 'PUT' : 'POST',
      url,
      data: requestData,
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
        null;
      if (!createdId) {
        throw new Error(`Respuesta de create sin id para ${item.entity_type}`);
      }

      const table = this.getTableName(item.entity_type);
      await db.update(table, item.entity_local_id, {
        server_id: createdId,
        synced: 1,
        ...(item.entity_type === 'product' && Array.isArray(data?.imageUrls)
          ? { data: JSON.stringify({ ...data, imageUrls: data.imageUrls }) }
          : {}),
      }, 'local_id');
    } else if (item.action === 'update') {
      const table = this.getTableName(item.entity_type);
      await db.update(table, item.entity_local_id, {
        synced: 1,
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

  private async prepareRequestData(entityType: string, data: any, action: string): Promise<any> {
    switch (entityType) {
      case 'product':
        return {
          name: data.name,
          sku: data.sku || null,
          reference: data.reference || null,
          supplierId: data.supplierId || null,
          categoryId: data.categoryId || null,
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

        return {
          customerId: resolvedCustomerId,
          type: data.type || (data.paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO'),
          paymentMethod: data.paymentMethod || null,
          items: saleItems,
          shippingCents: data.shippingCents || Math.round((data.shipping || 0) * 100),
        };
      case 'payment':
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
      default:
        return data;
    }
  }

  private async handleSyncError(item: any, error: any) {
    const dependencyError = typeof error?.message === 'string' && error.message.includes('Producto sin server_id');
    if (dependencyError) {
      console.warn(`Sync pendiente por dependencia (${item.entity_type} #${item.id}): ${error.message}`);
      return;
    }

    const authNotReadyError =
      typeof error?.message === 'string' &&
      (error.message.includes('No hay token de autenticación de Clerk disponible') ||
        error.message.includes('No hay token de subusuario disponible'));
    if (authNotReadyError) {
      console.warn(`Sync en espera de sesion (${item.entity_type} #${item.id}): ${error.message}`);
      return;
    }

    const backendAuthError =
      axios.isAxiosError(error) &&
      typeof error.response?.data?.error === 'string' &&
      error.response.data.error.toLowerCase().includes('no autenticado');
    if (backendAuthError) {
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
        return;
      }
      console.warn(`Sync en espera de autenticacion backend (${item.entity_type} #${item.id}).`);
      return;
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
      return;
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
      return;
    }

    console.error(`Error sincronizando ${item.entity_type}:`, {
      message: error?.message || String(error),
      queueId: item.id,
      action: item.action,
    });
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

      // Descargar cuentas por cobrar
      const arResponse = await axios.get(`${API_URL}/api/accounts-receivable`, {
        headers,
      });

      const arItems = arResponse.data?.data || arResponse.data || [];

      for (const ar of arItems) {
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

  private async updatePendingCount() {
    const result = await db.queryFirst<any>(
      'SELECT COUNT(*) as count FROM sync_queue WHERE status = ?',
      ['pending']
    );
    useSyncStore.getState().setPendingCount(result?.count || 0);
  }

  private getEndpoint(entityType: string, action: string): string {
    const endpoints: Record<string, string> = {
      'sale': 'sales',
      'product': 'products',
      'customer': 'customers',
      'payment': 'payments',
    };
    return endpoints[entityType] || entityType;
  }

  private getTableName(entityType: string): string {
    const tables: Record<string, string> = {
      'sale': 'sales',
      'product': 'products',
      'customer': 'customers',
      'payment': 'payments',
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


