import { db } from '../../database/Database';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../sync/SyncService';
import { validProductAmounts } from './productAmounts';

export async function updateLocalProduct(product: {
  localId: string; name: string; sku: string | null; priceCents: number; costCents: number;
  isAvailableForSale: boolean; [key: string]: unknown;
}, expectedAccountId: string | null, expectedUserId: string | null) {
  if (!validProductAmounts(product.priceCents, product.costCents)) throw new Error('Precio y costo deben ser mayores que cero.');
  await syncService.withProductQueuePaused(() => db.transaction(async tx => {
    const actor = useAuthStore.getState();
    if (!expectedAccountId || !expectedUserId || actor.accountId !== expectedAccountId || actor.subUser?.id !== expectedUserId || db.getAccountScope() !== expectedAccountId) {
      throw new Error('La sesión cambió. Vuelve a abrir el formulario.');
    }
    const row = await tx.queryFirst<{ server_id: string | null; stock: number }>('SELECT server_id, stock FROM products WHERE local_id = ?', [product.localId]);
    if (!row) throw new Error('Producto no encontrado.');
    const inFlight = await tx.queryFirst("SELECT id FROM sync_queue WHERE entity_type = 'product' AND entity_local_id = ? AND status = 'syncing' LIMIT 1", [product.localId]);
    if (inFlight) throw new Error('Confirma la sincronización pendiente antes de editar este producto.');
    // Leer el ID y las existencias dentro del lock evita recrear un producto que acaba de sincronizarse.
    const payload = { ...product, id: row.server_id || undefined, stock: row.stock };
    const action = row.server_id ? 'update' : 'create';
    const queued = await tx.queryFirst<{ id: number }>("SELECT id FROM sync_queue WHERE entity_type = 'product' AND entity_local_id = ? AND action = ? AND status IN ('pending','error') ORDER BY id LIMIT 1", [product.localId, action]);
    await tx.runAsync('UPDATE products SET name = ?, sku = ?, cost_cents = ?, price_cents = ?, synced = 0, is_available_for_sale = ?, data = ? WHERE local_id = ?',
      [product.name, product.sku, product.costCents, product.priceCents, product.isAvailableForSale ? 1 : 0, JSON.stringify(payload), product.localId]);
    if (queued) {
      await tx.runAsync("UPDATE sync_queue SET data = ?, status = 'pending', retry_count = 0, next_attempt_at = NULL, last_error_code = NULL, sync_started_at = NULL WHERE id = ?", [JSON.stringify(payload), queued.id]);
    }
    await tx.runAsync("DELETE FROM sync_queue WHERE entity_type = 'product' AND entity_local_id = ? AND status IN ('pending','error') AND id != ?", [product.localId, queued?.id ?? -1]);
    if (!queued) await syncService.queueOperationTx(tx, 'product', action, payload, product.localId, null);
  }));
  if (useAuthStore.getState().accountId === expectedAccountId && db.getAccountScope() === expectedAccountId) {
    void syncService.kickQueue().catch(error => console.warn('El producto corregido quedó pendiente de sincronización:', error));
  }
}
