import { pendingStockDeltas, stockContext, type StockRow } from '../stock/saleStockService';
import { validateStockConsumptions, type StockEntry, type StockConsumption } from '../../utils/stockCore';
import type { SaleItem } from '../../types';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { db, type DatabaseTransaction } from '../../database/Database';
import { cashContextForQueue, cashDeviceToken, cashOperationForInsert, discardCashPending, type CashContext, type CashQueueRow } from '../cash/cashShiftService';
import { useSyncStore } from '../../store/syncStore';
import { reportError } from '../error/errorReporter';
import { API_URL, SYNC_DEBUG, shortToken, summarizeError } from './syncShared';
import { prepareSyncRequestData } from './prepareSyncRequestData';
import { downloadFromServer } from './downloadFromServer';
import { capturePhase0SyncBaselineSnapshot } from './syncBaseline';
import { generateLocalId } from '../../utils/helpers';

type OnlineFinancialKind = 'credit_purchase' | 'supplier_payment';
type OnlineFinancialQueueRow = CashQueueRow & { data: string; request_data: string | null };
const onlineFinancialKind = (value: string): value is OnlineFinancialKind => value === 'credit_purchase' || value === 'supplier_payment';

function parseJwtExpiryMs(token: string | null | undefined): number | null {
  try {
    const raw = String(token || '');
    if (!raw) return null;
    const parts = raw.split('.');
    if (parts.length < 2) return null;
    const payloadBase64Url = parts[1];
    const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = payloadBase64.padEnd(payloadBase64.length + ((4 - (payloadBase64.length % 4)) % 4), '=');
    if (typeof globalThis.atob !== 'function') return null;
    const payloadJson = globalThis.atob(paddedPayload);
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    const expSeconds = Number(payload?.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null;
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

class SyncService {
  private static readonly SYNCING_STALE_MS = 10 * 60 * 1000;
  private static readonly MAX_RETRY_COUNT = 5;
  private static readonly RETRY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
  private static readonly PURGE_SYNCED_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
  private static readonly SUBUSER_REFRESH_WINDOW_MS = 5 * 60 * 1000;

  private isSyncing = false;
  private onlineFinancialSubmitInFlight = false;
  private isInitialized = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private unsubscribeNetInfo: (() => void) | null = null;
  private getTokenFn: (() => Promise<string | null>) | null = null;
  private getSubUserTokenFn: (() => Promise<string | null>) | null = null;
  private backendAuthCooldownUntil = 0;
  private lastAuthWaitLogAt = 0;
  private lastFullSyncAttemptAt = 0;
  private subUserRefreshInFlight: Promise<boolean> | null = null;

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

  async ensureSessionForFinancialRequest() {
    const result = await this.ensureSubUserSessionFresh();
    if (!result.ready) throw new Error(result.reason || 'Vuelve a iniciar sesión antes de continuar.');
  }

  async refreshConfirmedCreditPurchase(serverId: string) {
    const deadline = Date.now() + 30000;
    while (this.isSyncing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (this.isSyncing) throw new Error('La actualización local sigue en curso.');
    const token = await this.getTokenFn?.();
    if (!token) throw new Error('Inicia sesión para actualizar el inventario local.');
    await this.fullSync(token, { ignoreCooldown: true });
    const row = await db.queryFirst<{ local_id: string }>('SELECT local_id FROM purchases WHERE server_id = ? LIMIT 1', [serverId]);
    const status = await db.queryFirst<{ value: string }>("SELECT value FROM sync_metadata WHERE key = 'last_download_successful_entities'");
    let completed: string[] = [];
    try { completed = JSON.parse(status?.value || '[]'); } catch { /* exigir nueva descarga */ }
    if (!row || !completed.includes('products') || !completed.includes('purchases')) throw new Error('La compra está confirmada, pero inventario y listado locales aún deben sincronizarse.');
  }

  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Escuchar cambios de conectividad
    this.unsubscribeNetInfo = NetInfo.addEventListener(state => {
      const hasInternet = !!state.isConnected && state.isInternetReachable !== false;
      this.handleConnectivityChange(hasInternet);
    });

    // Sincronización periódica cada 5 minutos
    this.syncInterval = setInterval(() => {
      this.incrementalSync();
    }, 5 * 60 * 1000);

    // Actualizar contador de pendientes
    await this.updatePendingCount();
  }

  handleConnectivityChange(hasInternet: boolean) {
    useSyncStore.getState().setIsOnline(hasInternet);
    useSyncStore.getState().setSyncBlockedReason(null);

    if (hasInternet) {
      void this.processQueue();
    }
  }

  async fullSync(authToken: string, options?: { ignoreCooldown?: boolean; throwOnError?: boolean }) {
    if (this.isSyncing) {
      if (options?.throwOnError) throw new Error('Ya hay una sincronización en curso.');
      return;
    }
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
      const refreshed = await this.ensureSubUserSessionFresh();
      if (!refreshed.ready) {
        useSyncStore.getState().setSyncBlockedReason(refreshed.reason);
        if (options?.throwOnError) throw new Error('No se pudo preparar la sesión para sincronizar.');
        return;
      }
      useSyncStore.getState().setSyncBlockedReason(null);

      // 1. Descargar datos del servidor
      await this.downloadFromServer(authToken, options?.throwOnError);
      
      const pendingBeforeUpload = await this.getPendingQueueCount();
      if (pendingBeforeUpload > 0) {
        // 2. Subir cambios locales pendientes
        await this.uploadPendingChanges(authToken);

        // 3. Volver a descargar para reflejar en local lo aplicado en servidor
        await this.downloadFromServer(authToken, options?.throwOnError);
      } else if (SYNC_DEBUG) {
        console.log('[SyncService] fullSync() sin pendientes, se omite segunda descarga');
      }
      
      // 4. Actualizar timestamp
      await this.clearCashCatalogRefreshIfDownloaded();
      useSyncStore.getState().setLastSyncTime(Date.now());
    } catch (error) {
      console.error('Error en sincronización completa:', error);
      if (options?.throwOnError) throw error;
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

  async flushCashShiftQueue(shiftId: string): Promise<void> {
    if (!useSyncStore.getState().isOnline) throw new Error('Necesitas conexión para sincronizar el turno.');
    const deadline = Date.now() + 60000;
    while (this.isSyncing) {
      if (Date.now() >= deadline) throw new Error('La sincronización sigue en curso. Reintenta el cierre cuando termine.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await db.runAsync("UPDATE sync_queue SET status = 'pending', next_attempt_at = NULL, retry_count = 0 WHERE cash_shift_id = ? AND (status = 'pending' OR (status = 'error' AND entity_type NOT IN ('credit_purchase','supplier_payment')))", [shiftId]);
    await this.processQueue();
    const pending = await db.query<any>("SELECT id, status, last_error_code FROM sync_queue WHERE cash_shift_id = ? AND status != 'synced' ORDER BY client_sequence LIMIT 1", [shiftId]);
    if (pending.length) throw new Error(`Queda una operación del turno por confirmar (${pending[0].last_error_code || pending[0].status}).`);
  }

  async refreshCashDiscardCatalog(): Promise<void> {
    const marker = await db.queryFirst<{ value: string }>("SELECT value FROM sync_metadata WHERE key = 'cash_catalog_refresh_required'");
    if (!marker) return;
    const deadline = Date.now() + 60000;
    while (this.isSyncing) {
      if (Date.now() >= deadline) throw new Error('Espera a que termine la sincronización antes de actualizar el catálogo.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.isSyncing = true;
    try {
      const token = await this.getTokenFn?.();
      if (!token) throw new Error('Inicia sesión para actualizar los precios tras anular la compra.');
      await this.downloadFromServer(token);
      await this.clearCashCatalogRefreshIfDownloaded();
    } finally { this.isSyncing = false; }
  }

  private async clearCashCatalogRefreshIfDownloaded() {
    const marker = await db.queryFirst<{ value: string }>("SELECT value FROM sync_metadata WHERE key = 'cash_catalog_refresh_required'");
    if (!marker) return;
    const status = await db.queryFirst<{ value: string }>("SELECT value FROM sync_metadata WHERE key = 'last_download_successful_entities'");
    let completed: string[] = [];
    try { completed = JSON.parse(status?.value || '[]'); } catch { /* mantener pendiente */ }
    // La descarga puede ser parcial. No declarar restaurados costos y precios
    // si el catálogo de productos falló en la última descarga.
    if (!completed.includes('products')) throw new Error('No se restauró el catálogo del servidor. Reintenta la sincronización.');
    await db.runAsync("DELETE FROM sync_metadata WHERE key = 'cash_catalog_refresh_required'");
  }

  async capturePhase0Baseline(label: string = 'manual') {
    return capturePhase0SyncBaselineSnapshot(label);
  }

  private async ensureSubUserSessionFresh(): Promise<{ ready: boolean; reason: string | null }> {
    let currentTokenExpiryMs: number | null = null;
    try {
      const { useAuthStore } = await import('../../store/authStore');
      const state = useAuthStore.getState();
      const currentToken = this.getSubUserTokenFn ? await this.getSubUserTokenFn() : state.subUserToken;

      if (!currentToken) {
        return {
          ready: false,
          reason: 'Sync pausado: falta autenticacion de subusuario. Selecciona el usuario de caja.',
        };
      }

      currentTokenExpiryMs = parseJwtExpiryMs(currentToken);
      if (!currentTokenExpiryMs) {
        return { ready: true, reason: null };
      }

      const msUntilExpiry = currentTokenExpiryMs - Date.now();
      if (msUntilExpiry > SyncService.SUBUSER_REFRESH_WINDOW_MS) {
        return { ready: true, reason: null };
      }

      if (!this.getTokenFn) {
        return {
          ready: false,
          reason: 'Sync pausado: no hay sesion principal activa. Inicia sesion para continuar.',
        };
      }

      if (!this.subUserRefreshInFlight) {
        this.subUserRefreshInFlight = (async () => {
          const clerkToken = await this.getTokenFn!();
          if (!clerkToken) throw new Error('Sin token de Clerk para refrescar subusuario');

          const accountId = state.accountId;
          const headers = {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': currentToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
          };

          const response = await axios.post(`${API_URL}/api/auth/subuser/refresh`, {}, {
            headers,
            timeout: 20000,
          });

          const refreshedToken: string | null =
            response.data?.token ||
            response.data?.data?.token ||
            null;
          if (!refreshedToken) {
            throw new Error('Refresh de subusuario sin token en respuesta');
          }

          const nextSubUser = response.data?.user || state.subUser || null;
          await state.setSubUser(nextSubUser, refreshedToken, accountId || null);
          return true;
        })()
          .finally(() => {
            this.subUserRefreshInFlight = null;
          });
      }

      await this.subUserRefreshInFlight;
      return { ready: true, reason: null };
    } catch (error) {
      console.error('[SyncService] refresh subusuario falló:', summarizeError(error));
      const msUntilExpiry = currentTokenExpiryMs !== null ? currentTokenExpiryMs - Date.now() : null;
      if (msUntilExpiry !== null && msUntilExpiry > 0) {
        if (SYNC_DEBUG) {
          console.warn('[SyncService] refresh falló pero token actual sigue vigente; no se limpia sesión', {
            msUntilExpiry,
          });
        }
        return { ready: true, reason: null };
      }
      try {
        const { useAuthStore } = await import('../../store/authStore');
        await useAuthStore.getState().setSubUser(null, null, null);
      } catch {
        // ignore
      }
      return {
        ready: false,
        reason: 'Sync pausado: no se pudo renovar la sesion del subusuario. Debes volver a iniciar sesion del usuario de caja.',
      };
    }
  }

  async checkSaleStock(items: SaleItem[], editingSaleLocalId: string | null) {
    const { isOnline } = useSyncStore.getState();
    if (!isOnline) return;
    const fresh = await this.ensureSubUserSessionFresh();
    if (!fresh.ready) throw new Error(fresh.reason || 'Vuelve a iniciar sesión antes de vender.');
    const { useAuthStore } = await import('../../store/authStore');
    const actor = useAuthStore.getState();
    const accountId = actor.accountId, userId = actor.subUser?.id;
    const products = await db.query<StockRow>('SELECT local_id, server_id, name, stock, data FROM products');
    const context = stockContext(products);
    const sales = await db.query<any>('SELECT local_id, server_id, synced, status, data FROM sales WHERE synced = 0 OR local_id = ?', [editingSaleLocalId ?? '']);
    const editing = sales.find(row => row.local_id === editingSaleLocalId);
    const clerkToken = this.getTokenFn ? await this.getTokenFn() : null;
    const subUserToken = this.getSubUserTokenFn ? await this.getSubUserTokenFn() : actor.subUserToken;
    if (!clerkToken || !subUserToken) throw new Error('Conéctate y vuelve a iniciar sesión antes de guardar.');
    const serverId = (id: string) => context.products.get(context.resolve(id))?.server_id;
    const payloadItems = items.map(item => {
      const productId = serverId(item.productId);
      if (!productId) throw new Error('Sincroniza los productos antes de facturar.');
      return { productId, qty: item.quantity, recipeAdjustments: (item.recipeAdjustments ?? []).map(adjustment => {
        const ingredientId = serverId(adjustment.ingredientId);
        if (!ingredientId) throw new Error('Sincroniza los insumos antes de facturar.');
        return { ingredientId, adjustmentType: adjustment.adjustmentType };
      }) };
    });
    let checked: any;
    try {
      const response = await axios.post(API_URL + '/api/sales/stock', { items: payloadItems, saleId: editing?.server_id || undefined }, {
        headers: { Authorization: 'Bearer ' + clerkToken, 'X-Clerk-Authorization': 'Bearer ' + clerkToken, 'X-SubUser-Token': subUserToken, 'X-Account-Id': accountId || '' }, timeout: 12000,
      });
      checked = response.data;
    } catch (error) {
      // Una caída de red permite la validación SQLite. Un rechazo HTTP de
      // permisos/stock nunca debe convertirse en una venta offline pendiente.
      if (axios.isAxiosError(error) && !error.response) return;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      throw new Error(status === 404 ? 'Actualiza el servidor para comprobar existencias desde móvil.' : (axios.isAxiosError(error) ? error.response?.data?.error : null) || 'No se pudieron comprobar las existencias.');
    }
    if (checked.accountId !== accountId || checked.userId !== userId || useAuthStore.getState().accountId !== accountId || useAuthStore.getState().subUser?.id !== userId) throw new Error('El usuario cambió. Vuelve a abrir la venta.');
    if (typeof checked.isOwner !== 'boolean' || typeof checked.canSellWithoutStock !== 'boolean' || typeof checked.ok !== 'boolean') throw new Error('Respuesta de existencias incompleta. Actualiza el servidor.');
    await useAuthStore.getState().setSubUser({ ...actor.subUser!, isOwner: checked.isOwner, canSellWithoutStock: checked.canSellWithoutStock }, subUserToken, accountId);
    if (!checked.ok) throw new Error(checked.issue?.message || 'Existencia insuficiente.');
    if (!checked.isOwner && !checked.canSellWithoutStock) {
      const inventory = new Map<string, StockEntry>((checked.inventory as StockEntry[]).map(item => { const id = context.resolve(item.id); return [id, { ...item, id }]; }));
      const consumptions: StockConsumption[] = checked.consumptions.map((item: StockConsumption) => ({ ...item, ingredientId: context.resolve(item.ingredientId) }));
      const problem = validateStockConsumptions(consumptions, inventory, pendingStockDeltas(sales, context, editingSaleLocalId));
      if (problem) throw new Error(problem.message);
    }
  }

  async queueOperation(entityType: string, action: string, data: any, localId: string) {
    const context = await cashContextForQueue(entityType, action, data);
    await db.transaction(tx => this.queueOperationTx(tx, entityType, action, data, localId, context));
    await this.updatePendingCount();
    if (useSyncStore.getState().isOnline) void this.processQueue().catch(error => console.error('[SyncService] Error en processQueue background:', summarizeError(error)));
  }

  async kickQueue() {
    await this.updatePendingCount();
    if (useSyncStore.getState().isOnline) void this.processQueue().catch(error => console.error('[SyncService] Error en processQueue background:', summarizeError(error)));
  }

  async listOnlineFinancialPending(): Promise<OnlineFinancialQueueRow[]> {
    return db.query<OnlineFinancialQueueRow>("SELECT * FROM sync_queue WHERE entity_type IN ('credit_purchase','supplier_payment') AND status != 'synced' ORDER BY created_at, id");
  }

  private async settleOnlineFinancial(id: number): Promise<{ confirmed: boolean; result?: any; queueId: number; rejected?: boolean; error?: string }> {
    const deadline = Date.now() + 30000;
    while (this.isSyncing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (!this.isSyncing) await this.processQueue();
    const row = await db.queryFirst<OnlineFinancialQueueRow>('SELECT * FROM sync_queue WHERE id = ?', [id]);
    const data = row?.data ? JSON.parse(row.data) : {};
    return { confirmed: row?.status === 'synced' && !!data.serverResult, result: data.serverResult,
      queueId: id, rejected: Boolean(data.rejectedAt), error: data.lastErrorMessage || undefined };
  }

  async submitOnlineFinancial(kind: OnlineFinancialKind, input: Record<string, unknown>): Promise<{ confirmed: boolean; result?: any; queueId: number; rejected?: boolean; error?: string }> {
    if (this.onlineFinancialSubmitInFlight) throw new Error('La operación anterior todavía se está registrando.');
    this.onlineFinancialSubmitInFlight = true;
    let queueId = 0;
    let operationId: string | null = null;
    try {
    if (!useSyncStore.getState().isOnline) throw new Error('Conéctate para registrar esta operación.');
    const actor = (await import('../../store/authStore')).useAuthStore.getState();
    if (!actor.accountId || !actor.subUser?.id) throw new Error('Selecciona el empleado antes de registrar la operación.');
    const existing = await this.listOnlineFinancialPending();
    if (existing.some(row => row.account_id === actor.accountId && row.user_id === actor.subUser?.id)) {
      throw new Error('Hay una compra o pago por confirmar. Reinténtalo o resuélvelo antes de registrar otro.');
    }
    const generatedOperationId = generateLocalId();
    operationId = generatedOperationId;
    const payload = { ...input, operationId: generatedOperationId };
    const context = await cashContextForQueue(kind, 'create', kind === 'supplier_payment'
      ? { method: input.method, treasuryAccountId: input.treasuryAccountId }
      : { paymentMethod: input.initialPaymentCents ? input.paymentMethod : null, treasuryAccountId: input.initialPaymentCents ? input.treasuryAccountId : null });
    await db.transaction(async tx => {
      await this.queueOperationTx(tx, kind, 'create', payload, generatedOperationId, context);
      const row = await tx.queryFirst<OnlineFinancialQueueRow>("SELECT * FROM sync_queue WHERE entity_type = ? AND entity_local_id = ? AND action = 'create' ORDER BY id DESC LIMIT 1", [kind, generatedOperationId]);
      if (!row) throw new Error('No se pudo guardar la operación pendiente.');
      queueId = row.id;
      const request = { ...payload, ...(row.client_operation_id ? { cashOperation: {
        accountId: row.account_id, userId: row.user_id, cashShiftId: row.cash_shift_id,
        clientOperationId: row.client_operation_id, clientSequence: row.client_sequence,
      } } : {}) };
      // El cuerpo queda congelado antes de la primera petición. Una respuesta perdida
      // nunca debe regenerar el identificador ni cambiar el hash de caja.
      await tx.runAsync('UPDATE sync_queue SET account_id = ?, user_id = ?, request_data = ? WHERE id = ?',
        [actor.accountId, actor.subUser!.id, JSON.stringify(request), queueId]);
    });
    await this.updatePendingCount();
    return await this.settleOnlineFinancial(queueId);
    } catch (error) {
      if (queueId) {
        const row = await db.queryFirst<OnlineFinancialQueueRow>('SELECT * FROM sync_queue WHERE id = ?', [queueId]).catch(() => null);
        if (row && row.entity_type === kind && row.entity_local_id === operationId) {
          const data = JSON.parse(row.data || '{}');
          return { confirmed: row.status === 'synced' && !!data.serverResult, result: data.serverResult,
            queueId, rejected: Boolean(data.rejectedAt), error: data.lastErrorMessage || 'La confirmación está pendiente. Reintenta la misma operación.' };
        }
      }
      throw error;
    } finally { this.onlineFinancialSubmitInFlight = false; }
  }

  async retryOnlineFinancial(id: number) {
    const row = await db.queryFirst<OnlineFinancialQueueRow>('SELECT * FROM sync_queue WHERE id = ?', [id]);
    if (!row || !onlineFinancialKind(row.entity_type) || row.status === 'synced') throw new Error('El pendiente ya fue resuelto.');
    const actor = (await import('../../store/authStore')).useAuthStore.getState();
    if (row.account_id !== actor.accountId || row.user_id !== actor.subUser?.id) throw new Error('Vuelve al empleado que creó este pendiente.');
    if (!useSyncStore.getState().isOnline) throw new Error('Conéctate para confirmar el pendiente.');
    // Tras un reintento incierto ya no es seguro ofrecer descarte: el servidor
    // pudo confirmar esta misma operación aunque se haya perdido la respuesta.
    const data = JSON.parse(row.data || '{}');
    await db.runAsync("UPDATE sync_queue SET status = 'pending', retry_count = 0, next_attempt_at = NULL, data = ? WHERE id = ?", [JSON.stringify({ ...data, rejectedAt: null, lastErrorMessage: null }), id]);
    return this.settleOnlineFinancial(id);
  }

  async discardRejectedOnlineFinancial(id: number, reason: string) {
    const row = await db.queryFirst<OnlineFinancialQueueRow>('SELECT * FROM sync_queue WHERE id = ?', [id]);
    if (!row || !onlineFinancialKind(row.entity_type) || row.status === 'synced') throw new Error('El pendiente ya fue resuelto.');
    const data = JSON.parse(row.data || '{}');
    if (!data.rejectedAt) throw new Error('Esta operación puede estar confirmada. Reinténtala antes de descartarla.');
    if (!reason.trim()) throw new Error('Escribe el motivo para descartar el pendiente.');
    if (row.cash_shift_id) await discardCashPending(row, reason);
    else await db.runAsync("UPDATE sync_queue SET status = 'synced', synced_at = ?, last_error_code = 'DISCARDED' WHERE id = ?", [Date.now(), id]);
    await this.updatePendingCount();
  }

  // Usar esta variante dentro de la transacción que guarda el documento financiero.
  async queueOperationTx(tx: DatabaseTransaction, entityType: string, action: string, data: any, localId: string, context: CashContext | null) {
      if (SYNC_DEBUG) {
        console.log('[SyncService] queueOperation()', {
          entityType,
          action,
          localId,
          dataKeys: data ? Object.keys(data) : [],
        });
      }

      // Deduplicación: evitar encolar la misma operación si ya existe una pendiente o en vuelo
      const existing = await tx.queryFirst<any>(
        `SELECT id FROM sync_queue
         WHERE entity_type = ? AND entity_local_id = ? AND action = ? AND status IN ('pending', 'syncing', 'error')
         LIMIT 1`,
        [entityType, localId, action]
      );
      if (existing) {
        if (SYNC_DEBUG) {
          console.log('[SyncService] queueOperation() duplicado detectado, omitiendo', {
            entityType,
            action,
            localId,
            existingQueueId: existing.id,
          });
        }
        return;
      }

      const cashOperation = context ? await cashOperationForInsert(tx, context, localId) : null;
      await tx.runAsync(
        `INSERT INTO sync_queue (entity_type, entity_local_id, action, data, status, retry_count, created_at, account_id, user_id, cash_shift_id, client_operation_id, client_sequence)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?)`,
        [entityType, localId, action, JSON.stringify(data), Date.now(), cashOperation?.accountId ?? null,
          cashOperation?.userId ?? null, cashOperation?.cashShiftId ?? null,
          cashOperation?.clientOperationId ?? null, cashOperation?.clientSequence ?? null]
      );
  }

  private async processQueue() {
    if (this.isSyncing) return;
    // IMPORTANTE: este lock debe activarse antes de cualquier await para evitar
    // workers paralelos que puedan enviar operaciones create duplicadas.
    this.isSyncing = true;
    try {
      const { isOnline } = useSyncStore.getState();
      if (!isOnline) {
        useSyncStore.getState().setSyncBlockedReason(null);
        return;
      }

      const now = Date.now();
      if (now < this.backendAuthCooldownUntil) {
        if (SYNC_DEBUG) console.log('[SyncService] processQueue() en cooldown', { msRemaining: this.backendAuthCooldownUntil - now });
        return;
      }

      const refreshed = await this.ensureSubUserSessionFresh();
      if (!refreshed.ready) {
        useSyncStore.getState().setSyncBlockedReason(refreshed.reason);
        if (refreshed.reason) this.logAuthWait(refreshed.reason);
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

      // Reutilizamos el token que ya pasó la validación de Clerk en este ciclo.
      // No volver a pedirlo por cada elemento: durante un refresh Clerk puede
      // devolver null transitoriamente y convertir una sincronización válida en SYNC_ERROR.
      await this.processQueueInternal(authStatus.clerkToken || undefined);
    } finally {
      this.isSyncing = false;
      await this.updatePendingCount();
    }
  }

  /**
   * Internal queue processor — does NOT check/set isSyncing.
   * Called by processQueue (with guard) and uploadPendingChanges (already inside fullSync).
   */
  private async processQueueInternal(clerkToken?: string) {
    const now = Date.now();

    // Recuperar solo syncing stale (evita reset masivo agresivo).
    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'pending'
       WHERE status = 'syncing'
         AND (
           (sync_started_at IS NOT NULL AND sync_started_at <= ?)
           OR (sync_started_at IS NULL AND created_at <= ?)
         )`,
      [now - SyncService.SYNCING_STALE_MS, now - SyncService.SYNCING_STALE_MS]
    );

    // Limpieza periódica de synced antiguos.
    await db.runAsync(
      `DELETE FROM sync_queue
       WHERE status = 'synced'
         AND synced_at IS NOT NULL
         AND synced_at <= ?`,
      [now - SyncService.PURGE_SYNCED_OLDER_THAN_MS]
    );

    const pending = await db.query<any>(
      `SELECT *
       FROM sync_queue
       WHERE status = 'pending'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY
         CASE
           WHEN entity_type = 'product' AND action = 'create' THEN 0
           WHEN entity_type = 'product' THEN 1
           WHEN entity_type = 'customer' AND action = 'create' THEN 2
           ELSE 3
         END ASC,
         created_at ASC, id ASC`,
      [now]
    );
    if (SYNC_DEBUG) console.log('[SyncService] processQueueInternal() pending items', { count: pending.length });

    for (const item of pending) {
      if (item.cash_shift_id && item.client_sequence != null) {
        const first = await db.queryFirst<{ id: number }>("SELECT id FROM sync_queue WHERE cash_shift_id = ? AND status != 'synced' ORDER BY client_sequence, id LIMIT 1", [item.cash_shift_id]);
        if (first?.id !== item.id) break;
      }
      try {
        if (SYNC_DEBUG) {
          console.log('[SyncService] processQueueInternal() syncing item', {
            queueId: item.id,
            entityType: item.entity_type,
            action: item.action,
            entityLocalId: item.entity_local_id,
            retryCount: item.retry_count,
          });
        }

        // Marcar como 'syncing' ANTES de enviar al backend para evitar doble envío
        await db.update('sync_queue', item.id, {
          status: 'syncing',
          sync_started_at: Date.now(),
        }, 'id');

        await this.syncItem(item, clerkToken);
        
        // Marcar como sincronizado
        await db.update('sync_queue', item.id, {
          status: 'synced',
          synced_at: Date.now(),
          next_attempt_at: null,
          last_error_code: null,
        }, 'id');
      } catch (error) {
        // Revertir a pending para que handleSyncError decida reintento/backoff o error final.
        await db.update('sync_queue', item.id, {
          status: 'pending',
          sync_started_at: null,
        }, 'id');
        const stopProcessing = await this.handleSyncError(item, error);
        // Una secuencia rechazada impide enviar las posteriores del mismo turno.
        if (item.client_operation_id) break;
        if (stopProcessing) {
          if (SYNC_DEBUG) console.log('[SyncService] processQueueInternal() stopProcessing=true, cortando ciclo');
          break;
        }
      }
    }
  }

  private async syncItem(item: any, validatedClerkToken?: string) {
    const data = JSON.parse(item.data);
    const endpoint = this.getEndpoint(item.entity_type, item.action);
    
    // Obtener token de Clerk
    let clerkToken: string | null = validatedClerkToken || null;
    if (!clerkToken && this.getTokenFn) {
      clerkToken = await this.getTokenFn();
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
    if (item.client_operation_id && (item.account_id !== accountId || item.user_id !== (await import('../../store/authStore')).useAuthStore.getState().subUser?.id)) {
      throw new Error('Vuelve al empleado que registró este pendiente de caja.');
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
    const requestHeaders = {
      'Authorization': `Bearer ${clerkToken}`,
      'X-Clerk-Authorization': `Bearer ${clerkToken}`,
      'X-SubUser-Token': subUserToken,
      ...(accountId ? { 'X-Account-Id': accountId } : {}),
      'Content-Type': 'application/json',
      ...(item.client_operation_id ? { 'X-Cash-Device-Token': await cashDeviceToken() } : {}),
    };

    if (onlineFinancialKind(item.entity_type)) {
      const requestData = item.request_data ? JSON.parse(item.request_data) : data;
      if (!item.request_data) await db.update('sync_queue', item.id, { request_data: JSON.stringify(requestData) }, 'id');
      const deviceToken = await cashDeviceToken();
      // purchaseAPI identifica el móvil por cookie; caja usa además el encabezado.
      const headers = { ...requestHeaders, 'X-Cash-Device-Token': deviceToken, Cookie: `movopos-cash-device=${deviceToken}` };
      const response = await axios.post(`${API_URL}/api/${item.entity_type === 'credit_purchase' ? 'purchases' : 'supplier-payments'}`, requestData, { headers, timeout: 25000 });
      if (!response.data?.id) throw new Error('El servidor no devolvió el identificador de la operación.');
      await db.update('sync_queue', item.id, { data: JSON.stringify({ ...data, serverResult: response.data, rejectedAt: null, lastErrorMessage: null }) }, 'id');
      return;
    }

    // Preparar datos según el tipo de entidad
    const requestData = item.request_data ? JSON.parse(item.request_data) : await this.prepareRequestData(item.entity_type, data, item.action, {
      clerkToken, subUserToken, accountId,
    });
    if (item.client_operation_id && !item.request_data) {
      // Guardar el cuerpo exacto antes de enviarlo: un reintento debe tener el mismo hash.
      requestData.cashOperation = { accountId: item.account_id, userId: item.user_id,
        cashShiftId: item.cash_shift_id, clientOperationId: item.client_operation_id, clientSequence: item.client_sequence };
      await db.update('sync_queue', item.id, { request_data: JSON.stringify(requestData) }, 'id');
    }

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

    let response: any;
    try {
      response = await axios({
        method,
        url,
        data: requestData,
        timeout: 25000,
        headers: requestHeaders,
      });
    } catch (error) {
      if (!item.client_operation_id && item.action === 'create' && item.entity_type === 'payment_batch' && this.shouldFallbackBatchPayment(error)) {
        if (SYNC_DEBUG) {
          console.warn('[SyncService] payment_batch fallback -> POST /api/payments por factura', {
            queueId: item.id,
            status: axios.isAxiosError(error) ? error.response?.status : null,
            message: summarizeError(error),
          });
        }
        await this.syncPaymentBatchAsSingles(data, { clerkToken, subUserToken, accountId }, requestHeaders);
        return;
      }
      throw error;
    }

    if (item.action === 'create' && item.entity_type === 'payment_batch') {
      const responsePaymentIds = Array.isArray(response.data?.paymentIds)
        ? response.data.paymentIds
        : Array.isArray(response.data?.data?.paymentIds)
          ? response.data.data.paymentIds
          : [];
      const receiptCode =
        response.data?.receiptCode ||
        response.data?.data?.receiptCode ||
        data?.localReceiptCode ||
        null;
      const localPaymentIds = Array.isArray(data?.localPaymentIds)
        ? data.localPaymentIds.map((id: unknown) => String(id))
        : [];

      for (let i = 0; i < localPaymentIds.length; i += 1) {
        const localPaymentId = localPaymentIds[i];
        const serverPaymentId = responsePaymentIds[i] ? String(responsePaymentIds[i]) : null;
        const paymentRow = await db.queryFirst<any>(
          'SELECT data, receipt_code FROM payments WHERE local_id = ? LIMIT 1',
          [localPaymentId]
        );
        let parsedData: any = {};
        try {
          parsedData = paymentRow?.data ? JSON.parse(paymentRow.data) : {};
        } catch {
          parsedData = {};
        }

        await db.update(
          'payments',
          localPaymentId,
          {
            ...(serverPaymentId ? { server_id: serverPaymentId } : {}),
            ...(receiptCode ? { receipt_code: String(receiptCode) } : {}),
            synced: 1,
            data: JSON.stringify({
              ...parsedData,
              ...(serverPaymentId ? { id: serverPaymentId, serverId: serverPaymentId } : {}),
              ...(receiptCode ? { receiptCode: String(receiptCode) } : {}),
            }),
          },
          'local_id'
        );
      }
      return;
    }

    if (item.action === 'create' && item.entity_type === 'treasury_transfer_reverse') {
      const originalServerId =
        response.data?.originalId ||
        response.data?.data?.originalId ||
        null;
      const reverseServerId =
        response.data?.reverseId ||
        response.data?.data?.reverseId ||
        response.data?.id ||
        response.data?.data?.id ||
        null;

      const reverseLocalId = String(data?.reverseLocalId || '').trim();
      if (reverseServerId && reverseLocalId) {
        const reverseRow = await db.queryFirst<any>(
          'SELECT data FROM treasury_transfers WHERE local_id = ? LIMIT 1',
          [reverseLocalId]
        );
        let parsedReverseData: any = {};
        try {
          parsedReverseData = reverseRow?.data ? JSON.parse(reverseRow.data) : {};
        } catch {
          parsedReverseData = {};
        }
        await db.update(
          'treasury_transfers',
          reverseLocalId,
          {
            server_id: String(reverseServerId),
            synced: 1,
            data: JSON.stringify({
              ...parsedReverseData,
              id: String(reverseServerId),
              serverId: String(reverseServerId),
              ...(originalServerId ? { reversesTransferId: String(originalServerId) } : {}),
            }),
          },
          'local_id'
        );
      }

      const originalLocalId = String(item.entity_local_id || '').trim();
      if (originalLocalId) {
        const originalRow = await db.queryFirst<any>(
          'SELECT data FROM treasury_transfers WHERE local_id = ? LIMIT 1',
          [originalLocalId]
        );
        let parsedOriginalData: any = {};
        try {
          parsedOriginalData = originalRow?.data ? JSON.parse(originalRow.data) : {};
        } catch {
          parsedOriginalData = {};
        }
        await db.update(
          'treasury_transfers',
          originalLocalId,
          {
            ...(originalServerId ? { server_id: String(originalServerId) } : {}),
            status: 'REVERSED',
            synced: 1,
            data: JSON.stringify({
              ...parsedOriginalData,
              ...(originalServerId ? { id: String(originalServerId), serverId: String(originalServerId) } : {}),
              status: 'REVERSED',
            }),
          },
          'local_id'
        );
      }
      return;
    }

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
        ...(item.entity_type === 'treasury_account' ||
        item.entity_type === 'treasury_opening_balance' ||
        item.entity_type === 'treasury_transfer'
          ? {
              data: JSON.stringify({
                ...(data || {}),
                id: createdId,
                serverId: createdId,
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
      if (item.entity_type === 'treasury_account') {
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
    return prepareSyncRequestData(entityType, data, action, authContext);
  }

  private shouldFallbackBatchPayment(error: any): boolean {
    if (!axios.isAxiosError(error)) return false;
    const status = Number(error.response?.status || 0);
    const message = String(
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      ''
    ).toLowerCase();

    if (status === 404 || status === 405 || status === 501) return true;
    if (status === 401 || status === 403) {
      return (
        message.includes('no autenticado') ||
        message.includes('unauthorized') ||
        message.includes('not authenticated')
      );
    }
    return false;
  }

  private async syncPaymentBatchAsSingles(
    batchData: any,
    authContext: { clerkToken: string; subUserToken: string; accountId: string | null },
    headers: Record<string, string>
  ): Promise<void> {
    const localPaymentIds = Array.isArray(batchData?.localPaymentIds)
      ? batchData.localPaymentIds.map((id: unknown) => String(id)).filter(Boolean)
      : [];
    if (!localPaymentIds.length) {
      throw new Error('payment_batch sin localPaymentIds para fallback');
    }

    for (const localPaymentId of localPaymentIds) {
      const paymentRow = await db.queryFirst<any>(
        `SELECT local_id, server_id, receipt_code, amount_cents, ar_id, data
         FROM payments
         WHERE local_id = ?
         LIMIT 1`,
        [localPaymentId]
      );
      if (!paymentRow?.local_id) {
        continue;
      }
      if (paymentRow.server_id) {
        await db.update('payments', String(paymentRow.local_id), { synced: 1 }, 'local_id');
        continue;
      }

      let parsedData: any = {};
      try {
        parsedData = paymentRow?.data ? JSON.parse(paymentRow.data) : {};
      } catch {
        parsedData = {};
      }

      const paymentPayload = {
        ...parsedData,
        arId: parsedData?.arId || paymentRow.ar_id || null,
        amountCents: Number(parsedData?.amountCents || paymentRow.amount_cents || 0),
        method: parsedData?.method || parsedData?.paymentMethod || batchData?.method || 'EFECTIVO',
        paymentMethod: parsedData?.paymentMethod || parsedData?.method || batchData?.method || 'EFECTIVO',
        transferBankName:
          parsedData?.transferBankName ??
          batchData?.transferBankName ??
          null,
        note: parsedData?.note ?? parsedData?.notes ?? batchData?.note ?? null,
        notes: parsedData?.notes ?? parsedData?.note ?? batchData?.note ?? null,
      };

      const requestData = await this.prepareRequestData('payment', paymentPayload, 'create', authContext);
      const singleResponse = await axios({
        method: 'POST',
        url: `${API_URL}/api/payments`,
        data: requestData,
        timeout: 25000,
        headers,
      });

      const createdId =
        singleResponse.data?.id ||
        singleResponse.data?.data?.id ||
        null;
      if (!createdId) {
        throw new Error(`Respuesta de create sin id para payment (fallback batch ${localPaymentId})`);
      }

      const resolvedReceiptCode =
        parsedData?.receiptCode ||
        paymentRow.receipt_code ||
        batchData?.localReceiptCode ||
        singleResponse.data?.receiptCode ||
        singleResponse.data?.data?.receiptCode ||
        null;
      const resolvedReceiptNumber =
        singleResponse.data?.receiptNumber ||
        singleResponse.data?.data?.receiptNumber ||
        parsedData?.receiptNumber ||
        null;
      const resolvedPaidAt =
        singleResponse.data?.paidAt ||
        singleResponse.data?.data?.paidAt ||
        parsedData?.paidAt ||
        parsedData?.createdAt ||
        null;

      await db.update(
        'payments',
        String(paymentRow.local_id),
        {
          server_id: String(createdId),
          ...(resolvedReceiptCode ? { receipt_code: String(resolvedReceiptCode) } : {}),
          synced: 1,
          data: JSON.stringify({
            ...parsedData,
            ...paymentPayload,
            id: String(createdId),
            serverId: String(createdId),
            ...(resolvedReceiptCode ? { receiptCode: String(resolvedReceiptCode) } : {}),
            ...(resolvedReceiptNumber ? { receiptNumber: Number(resolvedReceiptNumber) } : {}),
            ...(resolvedPaidAt ? { paidAt: resolvedPaidAt } : {}),
          }),
        },
        'local_id'
      );
    }
  }

  private deriveErrorCode(error: any): string {
    if (axios.isAxiosError(error)) {
      const status = Number(error.response?.status || 0);
      if (status > 0) return `HTTP_${status}`;
      return `AXIOS_${String(error.code || 'ERROR')}`;
    }
    const rawName = String(error?.name || 'ERROR').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return rawName || 'ERROR';
  }

  private computeNextAttemptAt(retryCount: number): number {
    const idx = Math.min(Math.max(retryCount - 1, 0), SyncService.RETRY_BACKOFF_MS.length - 1);
    return Date.now() + SyncService.RETRY_BACKOFF_MS[idx];
  }

  private async handleSyncError(item: any, error: any): Promise<boolean> {
    const errorSummary = summarizeError(error);
    if (SYNC_DEBUG) {
      console.log('[SyncService] handleSyncError()', {
        queueId: item?.id,
        entityType: item?.entity_type,
        action: item?.action,
        summary: errorSummary,
      });
    }
    const backendStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
    const backendErrorRaw = axios.isAxiosError(error)
      ? String(error.response?.data?.error || error.response?.data?.message || error.message || '')
      : String(error?.message || '');
    const backendErrorMessage = backendErrorRaw.toLowerCase();
    if (onlineFinancialKind(item.entity_type) && backendStatus && [400, 403, 404, 409, 422].includes(backendStatus)) {
      const data = JSON.parse(item.data || '{}');
      await db.update('sync_queue', item.id, {
        status: 'error', next_attempt_at: null, retry_count: item.retry_count + 1,
        last_error_code: String(error.response?.data?.code || `HTTP_${backendStatus}`),
        data: JSON.stringify({ ...data, rejectedAt: Date.now(), lastErrorMessage: backendErrorRaw }),
      }, 'id');
      return true;
    }
    const dependencyError =
      (typeof error?.message === 'string' &&
        (error.message.includes('Producto sin server_id') ||
          error.message.includes('Item de venta sin server_id') ||
          error.message.includes('Venta sin server_id para devolución') ||
          error.message.includes('Cuenta de tesorería sin server_id') ||
          error.message.includes('Transferencia de tesorería sin server_id'))) ||
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
      // La sesión puede estar hidratándose o refrescándose. Se pausa la cola
      // sin alertar a soporte: no es un fallo de sincronización accionable.
      useSyncStore.getState().setSyncBlockedReason(
        error.message.includes('subusuario')
          ? 'Sync pausado: falta autenticacion de subusuario. Inicia sesion del usuario de caja.'
          : 'Sync pausado: falta autenticacion principal (Clerk). Inicia sesion nuevamente.'
      );
      console.warn(`Sync en espera de sesion (${item.entity_type} #${item.id}): ${error.message}`);
      return true;
    }

    void reportError(error, {
      code: 'SYNC_ERROR',
      severity: 'HIGH',
      metadata: {
        entityType: item?.entity_type || null,
        queueId: item?.id ?? null,
        action: item?.action || null,
        retryCount: item?.retry_count ?? null,
        backendStatus: backendStatus ?? null,
        backendMessage: backendErrorRaw ? backendErrorRaw.slice(0, 200) : null,
        summary: errorSummary,
      },
    });

    const backendAuthLikeMessage =
      axios.isAxiosError(error) &&
      (
        backendErrorMessage.includes('no autenticado') ||
        backendErrorMessage.includes('unauthorized') ||
        backendErrorMessage.includes('not authenticated')
      );
    const backendAuthError =
      axios.isAxiosError(error) &&
      (
        backendStatus === 401 ||
        (backendStatus === 403 && backendAuthLikeMessage)
      );
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
        console.warn('No se pudo limpiar sesion de subusuario tras 401/403 auth:', clearSessionError);
      }
      useSyncStore.getState().setSyncBlockedReason(
        'Sync pausado: backend rechazo autenticacion. Debes volver a seleccionar usuario para continuar.'
      );
      if (item.entity_type === 'customer') {
        const errorCode = this.deriveErrorCode(error);
        await db.update(
          'sync_queue',
          item.id,
          {
            status: 'error',
            retry_count: item.retry_count + 1,
            next_attempt_at: null,
            last_error_code: errorCode,
          },
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

    const backendPermissionError =
      axios.isAxiosError(error) &&
      backendStatus === 403 &&
      (
        backendErrorMessage.includes('no tienes permiso') ||
        backendErrorMessage.includes('forbidden') ||
        backendErrorMessage.includes('acceso denegado') ||
        backendErrorMessage.includes('permiso')
      );
    if (backendPermissionError) {
      const errorCode = this.deriveErrorCode(error);
      await db.update(
        'sync_queue',
        item.id,
        {
          status: 'error',
          retry_count: item.retry_count + 1,
          next_attempt_at: null,
          last_error_code: errorCode,
        },
        'id'
      );
      console.warn(`Sync detenido por permisos (${item.entity_type} #${item.id}).`);
      return false;
    }

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
    // Un rechazo dentro de un turno conserva su secuencia hasta que el cajero la anule
    // explícitamente en el servidor. El rollback automático dejaría un hueco permanente.
    if (returnBusinessRejected && !item.client_operation_id) {
      await this.rejectReturnLocally(item, backendErrorRaw || 'Devolucion rechazada por backend');
      return false;
    }

    const isTreasuryReverseCreate = item?.entity_type === 'treasury_transfer_reverse' && item?.action === 'create';
    const treasuryReverseAlreadyApplied =
      isTreasuryReverseCreate &&
      axios.isAxiosError(error) &&
      backendStatus === 400 &&
      (backendErrorMessage.includes('ya fue reversada') || backendErrorMessage.includes('ya es reverso'));
    if (treasuryReverseAlreadyApplied) {
      const now = Date.now();
      const payload = (() => {
        try {
          return item?.data ? JSON.parse(item.data) : {};
        } catch {
          return {};
        }
      })();
      const reverseLocalId = String(payload?.reverseLocalId || '').trim();
      const originalLocalId = String(item?.entity_local_id || '').trim();
      if (reverseLocalId) {
        await db.update(
          'treasury_transfers',
          reverseLocalId,
          { synced: 1 },
          'local_id'
        );
      }
      if (originalLocalId) {
        await db.update(
          'treasury_transfers',
          originalLocalId,
          { synced: 1, status: 'REVERSED' },
          'local_id'
        );
      }
      await db.update(
        'sync_queue',
        item.id,
        {
          status: 'synced',
          synced_at: now,
          next_attempt_at: null,
          last_error_code: null,
        },
        'id'
      );
      return false;
    }

    const backendBusinessError =
      axios.isAxiosError(error) &&
      typeof error.response?.data?.error === 'string' &&
      (error.response.data.error.includes('producto inválido') ||
        error.response.data.error.includes('producto invalido') ||
        error.response.data.error.includes('inactivo'));
    const duplicateSkuConflict =
      item?.entity_type === 'product' &&
      item?.action === 'create' &&
      axios.isAxiosError(error) &&
      backendStatus === 409 &&
      backendErrorMessage.includes('sku') &&
      (
        backendErrorMessage.includes('ya existe') ||
        backendErrorMessage.includes('ya está en uso') ||
        backendErrorMessage.includes('ya esta en uso') ||
        backendErrorMessage.includes('duplicate')
      );
    const localBusinessError =
      typeof error?.message === 'string' && error.message.includes('Producto inactivo en carrito');
    if (backendBusinessError || localBusinessError || duplicateSkuConflict) {
      const errorCode = this.deriveErrorCode(error);
      await db.update(
        'sync_queue',
        item.id,
        {
          status: 'error',
          retry_count: item.retry_count + 1,
          next_attempt_at: null,
          last_error_code: errorCode,
        },
        'id'
      );
      if (duplicateSkuConflict) {
        console.warn(`Sync detenido por SKU duplicado (${item.entity_type} #${item.id}).`);
      } else {
        console.warn(`Sync detenido por validacion de negocio (${item.entity_type} #${item.id}).`);
      }
      return false;
    }

    const retryCount = item.retry_count + 1;
    const errorCode = this.deriveErrorCode(error);
    const nextAttemptAt = this.computeNextAttemptAt(retryCount);

    if (retryCount >= SyncService.MAX_RETRY_COUNT) {
      await db.update('sync_queue', item.id, {
        status: 'error',
        retry_count: retryCount,
        next_attempt_at: null,
        last_error_code: errorCode,
      }, 'id');
    } else {
      await db.update('sync_queue', item.id, {
        status: 'pending',
        retry_count: retryCount,
        next_attempt_at: nextAttemptAt,
        last_error_code: errorCode,
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
        {
          status: 'synced',
          synced_at: now,
          retry_count: item.retry_count + 1,
          next_attempt_at: null,
          last_error_code: null,
        },
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
      {
        status: 'synced',
        synced_at: now,
        retry_count: item.retry_count + 1,
        next_attempt_at: null,
        last_error_code: null,
      },
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

  private async getAuthStatus(): Promise<{ ready: boolean; reason: string | null; clerkToken: string | null }> {
    // Si Clerk aun no inyecto getToken (arranque de app), no avisar error de sesion.
    if (!this.getTokenFn) {
      return { ready: false, reason: null, clerkToken: null };
    }

    let clerkToken: string | null = null;
    clerkToken = await this.getTokenFn();
    if (SYNC_DEBUG) console.log('[SyncService] getAuthStatus() clerkToken', shortToken(clerkToken));
    if (!clerkToken) {
      return {
        ready: false,
        reason: 'Sync pausado: no hay sesion principal activa. Inicia sesion para continuar.',
        clerkToken: null,
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
        clerkToken: null,
      };
    }

    return { ready: true, reason: null, clerkToken };
  }

  private async downloadFromServer(authToken: string, throwOnPartial = false) {
    await downloadFromServer({
      authToken,
      getTokenFn: this.getTokenFn,
      getSubUserTokenFn: this.getSubUserTokenFn,
      throwOnPartial,
    });
  }

  private async uploadPendingChanges(authToken: string) {
    await this.processQueueInternal(authToken);
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
      'payment_batch': 'payments/batch',
      'purchase': 'purchases',
      'credit_purchase': 'purchases',
      'supplier_payment': 'supplier-payments',
      'operating_expense': 'operating-expenses',
      'treasury_account': 'treasury/accounts',
      'treasury_opening_balance': 'treasury/opening-balances',
      'treasury_transfer': 'treasury/transfers',
      'treasury_transfer_reverse': 'treasury/transfers/reverse',
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
      'payment_batch': 'payments',
      'purchase': 'purchases',
      'operating_expense': 'operating_expenses',
      'treasury_account': 'treasury_accounts',
      'treasury_opening_balance': 'treasury_opening_balances',
      'treasury_transfer': 'treasury_transfers',
      'treasury_transfer_reverse': 'treasury_transfers',
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

