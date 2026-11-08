import { db } from '../../database/Database';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../sync/SyncService';
import { validProductAmounts } from './productAmounts';

export async function createLocalProduct(product: {
  localId: string; name: string; sku: string | null; costCents: number; priceCents: number;
  stock: number; isAvailableForSale: boolean; [key: string]: unknown;
}, expectedAccountId: string | null, expectedUserId: string | null) {
  if (!validProductAmounts(product.priceCents, product.costCents)) throw new Error('Precio y costo deben ser mayores que cero.');
  await db.transaction(async tx => {
    const actor = useAuthStore.getState();
    if (!expectedAccountId || !expectedUserId || actor.accountId !== expectedAccountId || actor.subUser?.id !== expectedUserId || db.getAccountScope() !== expectedAccountId) {
      throw new Error('La sesión cambió. Vuelve a abrir el formulario.');
    }
    // Producto y cola deben confirmar juntos: un fallo de cola nunca deja una
    // fila huérfana que el siguiente intento vuelva a crear con otro localId.
    await tx.runAsync(`INSERT INTO products (local_id, name, sku, cost_cents, price_cents, stock, synced, is_available_for_sale, data)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`, [product.localId, product.name, product.sku, product.costCents,
      product.priceCents, product.stock, product.isAvailableForSale ? 1 : 0, JSON.stringify(product)]);
    await syncService.queueOperationTx(tx, 'product', 'create', product, product.localId, null);
  });
  // La confirmación local ya ocurrió; fallar el refresco no debe invitar a guardar otra vez.
  if (useAuthStore.getState().accountId === expectedAccountId && db.getAccountScope() === expectedAccountId) {
    void syncService.kickQueue().catch(error => console.warn('El producto quedó pendiente de sincronización:', error));
  }
}
