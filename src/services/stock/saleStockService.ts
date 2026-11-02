import { create } from 'zustand';
import { db, type DatabaseTransaction } from '../../database/Database';
import { useAuthStore } from '../../store/authStore';
import type { Product, SaleItem } from '../../types';
import { createProductCartItem, buildLineId } from '../../store/createCartStore';
import { unitAllowsDecimals } from '../../utils/productUnits';
import { aggregateStockConsumptions, getStockConsumptions, initialStockQuantity, roundStockQty, stockConsumptionDoesNotIncrease, validateStockConsumptions, type StockConsumption, type StockEntry, type StockIssue, type StockLine } from '../../utils/stockCore';

export type StockRow = { local_id: string; server_id?: string; name: string; stock: number; data?: string; is_available_for_sale?: number };
type SaleRow = { local_id: string; server_id?: string; synced?: number; data?: string; status?: string };
const missing = (message = 'Faltan datos de existencia. Sincroniza productos y ventas antes de continuar.'): StockIssue => ({ kind: 'missing', name: '', message });
export function parseStockData(data?: string): Record<string, any> {
  try { return data ? JSON.parse(data) : {}; } catch { return {}; }
}
export function stockContext(rows: StockRow[]) {
  const aliases = new Map<string, string>();
  const products = new Map<string, StockRow>();
  for (const row of rows) {
    aliases.set(row.local_id, row.local_id);
    if (row.server_id) { aliases.set(row.server_id, row.local_id); aliases.set(`server_${row.server_id}`, row.local_id); }
    products.set(row.local_id, row);
  }
  const resolve = (id: string) => aliases.get(String(id)) ?? String(id);
  const inventory = new Map<string, StockEntry>();
  for (const row of rows) inventory.set(row.local_id, { id: row.local_id, name: row.name, stock: Number(row.stock), isActive: parseStockData(row.data).isActive !== false, snapshotAt: 0 });
  return { products, inventory, resolve };
}
type Context = ReturnType<typeof stockContext>;
export type StockReservation = { consumptions: StockConsumption[]; delta: StockConsumption[]; pendingDelta: StockConsumption[] };
export function stockLines(items: SaleItem[], context: Context): StockLine[] {
  return items.map(item => {
    const productId = context.resolve(item.productId);
    const row = context.products.get(productId);
    const data = parseStockData(row?.data);
    const recipeItems = Array.isArray(data.recipeItems) ? data.recipeItems : item.recipeItems ?? [];
    return {
      productId, name: row?.name ?? item.productName, qty: item.quantity,
      productKind: data.productKind ?? item.productKind ?? 'BASIC',
      recipeItems: recipeItems.map((ingredient: any) => ({ ...ingredient, ingredientId: context.resolve(ingredient.ingredientId), ingredientName: ingredient.ingredientName ?? ingredient.ingredient?.name ?? 'Insumo', qty: Number(ingredient.qty) })),
      recipeAdjustments: (item.recipeAdjustments ?? []).map(adjustment => ({ ...adjustment, ingredientId: context.resolve(adjustment.ingredientId) })),
    };
  });
}
function normalizeConsumptions(items: StockConsumption[], context: Context) {
  return aggregateStockConsumptions(items.map(item => ({ ingredientId: context.resolve(item.ingredientId), qty: Number(item.qty) })));
}
export function persistedStockConsumptions(row: SaleRow, context: Context): StockConsumption[] {
  const data = parseStockData(row.data);
  if (Array.isArray(data.stockConsumptions)) return normalizeConsumptions(data.stockConsumptions, context);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length && items.every((item: any) => Array.isArray(item.consumptions) && item.consumptions.length)) {
    return normalizeConsumptions(items.flatMap((item: any) => item.consumptions.map((consumption: any) => ({ ingredientId: consumption.ingredientId, qty: consumption.qty }))), context);
  }
  // Los clientes antiguos restaban el producto padre. No inventar créditos de
  // insumos de una receta antigua cuyo descuento real no podemos comprobar.
  if (items.some((item: any) => parseStockData(context.products.get(context.resolve(item.productId))?.data).productKind === 'RECIPE')) throw new Error('Sincroniza esta factura para recuperar sus consumos de receta antes de editarla.');
  return normalizeConsumptions(items.map((item: any) => ({ ingredientId: item.productId, qty: Number(item.quantity ?? item.qty) })), context);
}
export function pendingStockDeltas(rows: SaleRow[], context: Context, excludeLocalId?: string | null) {
  const all: StockConsumption[] = [];
  for (const row of rows) {
    if (row.local_id === excludeLocalId || row.status === 'cancelled' || row.synced === 1) continue;
    const data = parseStockData(row.data);
    let source = Array.isArray(data.stockReservationDelta) ? data.stockReservationDelta : data.stockConsumptions;
    if (!Array.isArray(source)) {
      const lines = (data.items ?? []).map((item: any) => ({ ...item, quantity: Number(item.quantity ?? item.qty) }));
      const resolved = getStockConsumptions(stockLines(lines, context));
      if (resolved.issue || row.server_id) throw new Error('Sincroniza las ventas antiguas antes de actualizar el inventario.');
      source = resolved.consumptions;
    }
    all.push(...normalizeConsumptions(source, context));
  }
  return aggregateStockConsumptions(all);
}
function addCredits(context: Context, credits: StockConsumption[]) {
  const inventory = new Map(context.inventory);
  for (const credit of credits) {
    const entry = inventory.get(credit.ingredientId);
    if (entry) inventory.set(entry.id, { ...entry, stock: entry.stock + credit.qty });
  }
  return inventory;
}
function actor() {
  const state = useAuthStore.getState();
  return { accountId: state.accountId, userId: state.subUser?.id, allowed: state.subUser?.isOwner === true || state.subUser?.canSellWithoutStock === true };
}
export const useSaleStockStore = create<{
  ready: boolean; accountId: string | null; context: Context; credits: StockConsumption[];
  editingSaleLocalId: string | null; incomplete: boolean; saving: boolean; version: number;
}>(() => ({ ready: false, accountId: null, context: stockContext([]), credits: [], editingSaleLocalId: null, incomplete: false, saving: false, version: 0 }));
let refreshVersion = 0;
export const saleStockService = {
  async refresh(editingSaleLocalId = useSaleStockStore.getState().editingSaleLocalId) {
    const version = ++refreshVersion;
    if (editingSaleLocalId !== useSaleStockStore.getState().editingSaleLocalId) useSaleStockStore.setState({ editingSaleLocalId, ready: false, credits: [] });
    const currentActor = actor();
    if (!currentActor.accountId) { useSaleStockStore.setState({ ready: false }); return; }
    try {
      const [products, sales, dirty] = await Promise.all([
        db.query<StockRow>('SELECT local_id, server_id, name, stock, is_available_for_sale, data FROM products'),
        db.query<SaleRow>("SELECT local_id, server_id, synced, status, data FROM sales WHERE synced = 0 OR local_id = ?", [editingSaleLocalId ?? '']),
        db.queryFirst('SELECT value FROM sync_metadata WHERE key = ?', ['stock_snapshot_dirty']),
      ]);
      const context = stockContext(products);
      const editing = sales.find(row => row.local_id === editingSaleLocalId);
      const credits = editing && editing.status !== 'cancelled' ? persistedStockConsumptions(editing, context) : [];
      const incomplete = sales.some(row => row.synced !== 1 && row.status !== 'cancelled' && !Array.isArray(parseStockData(row.data).stockConsumptions));
      if (version === refreshVersion && actor().accountId === currentActor.accountId) useSaleStockStore.setState(state => ({ ready: !dirty, accountId: currentActor.accountId, context, credits, editingSaleLocalId, incomplete, version: state.version + 1 }));
    } catch {
      if (version === refreshVersion) useSaleStockStore.setState({ ready: false });
    }
  },
  issue(items: SaleItem[], previous?: SaleItem[]): StockIssue | null {
    const state = useSaleStockStore.getState(), currentActor = actor();
    if (state.saving) return missing('La venta se está guardando. Espera a que termine.');
    const lines = stockLines(items, state.context);
    const consumed = getStockConsumptions(lines);
    if (previous && stockConsumptionDoesNotIncrease(stockLines(previous, state.context), lines)) return null;
    if (!state.ready || state.accountId !== currentActor.accountId || !currentActor.userId) return missing();
    if (consumed.issue) return consumed.issue;
    for (const line of lines) {
      const row = state.context.products.get(line.productId);
      if (!row || parseStockData(row.data).isActive === false) return missing(`El producto "${line.name}" no está disponible. Sincroniza el catálogo.`);
    }
    if (currentActor.allowed) return null;
    if (state.incomplete) return missing('Hay ventas antiguas pendientes. Sincronízalas antes de volver a vender sin existencia negativa.');
    return validateStockConsumptions(consumed.consumptions, addCredits(state.context, state.credits));
  },
  initialQuantity(product: Product, items: SaleItem[], requested?: number) {
    if (requested !== undefined) return requested;
    const existing = items.some(item => item.lineId === buildLineId(product.localId));
    if (existing) return unitAllowsDecimals(product.unit) ? 0.5 : 1;
    const state = useSaleStockStore.getState();
    const id = state.context.resolve(product.localId);
    const consumed = getStockConsumptions(stockLines(items, state.context)).consumptions.filter(item => item.ingredientId === id).reduce((sum, item) => sum + item.qty, 0);
    const available = (addCredits(state.context, state.credits).get(id)?.stock ?? product.stock) - consumed;
    return initialStockQuantity(available, product.productKind !== 'RECIPE' && unitAllowsDecimals(product.unit), actor().allowed);
  },
  available(product: Product) {
    const state = useSaleStockStore.getState();
    return roundStockQty(addCredits(state.context, state.credits).get(state.context.resolve(product.localId))?.stock ?? product.stock);
  },
  preview(product: Product, items: SaleItem[], requested?: number) {
    const quantity = this.initialQuantity(product, items, requested);
    const existing = items.find(item => item.lineId === buildLineId(product.localId));
    const next = existing ? items.map(item => item.lineId === existing.lineId ? { ...item, quantity: item.quantity + quantity } : item) : [...items, createProductCartItem(product, quantity)];
    return { items: next, issue: this.issue(next), quantity };
  },
  async reserve(items: SaleItem[], editingSaleLocalId: string | null, save?: (tx: DatabaseTransaction, reservation: StockReservation) => Promise<void>) {
    const expectedActor = actor();
    return db.transaction(async tx => {
      if (!expectedActor.userId || expectedActor.accountId !== actor().accountId || expectedActor.userId !== actor().userId) throw new Error('La sesión cambió. Vuelve a abrir la venta.');
      const products = await tx.query<StockRow>('SELECT local_id, server_id, name, stock, is_available_for_sale, data FROM products');
      const context = stockContext(products);
      const old = editingSaleLocalId ? await tx.queryFirst<SaleRow>('SELECT * FROM sales WHERE local_id = ?', [editingSaleLocalId]) : null;
      if (editingSaleLocalId && !old) throw new Error('No se encontró la factura que estás editando.');
      if (old?.status === 'cancelled') throw new Error('No puedes editar una factura cancelada.');
      const credits = old ? persistedStockConsumptions(old, context) : [];
      const result = getStockConsumptions(stockLines(items, context));
      if (result.issue) throw new Error(result.issue.message);
      const dirty = await tx.queryFirst('SELECT value FROM sync_metadata WHERE key = ?', ['stock_snapshot_dirty']);
      if (dirty && !expectedActor.allowed) throw new Error('Sincroniza el inventario antes de guardar esta venta.');
      const pending = await tx.query<SaleRow>("SELECT local_id, data FROM sales WHERE synced = 0 AND status != 'cancelled'");
      if (!expectedActor.allowed && pending.some(row => !Array.isArray(parseStockData(row.data).stockConsumptions))) throw new Error('Sincroniza las ventas antiguas pendientes antes de continuar.');
      const problem = expectedActor.allowed ? null : validateStockConsumptions(result.consumptions, addCredits(context, credits));
      if (problem) throw new Error(problem.message);
      const delta = aggregateStockConsumptions([...result.consumptions, ...credits.map(item => ({ ...item, qty: -item.qty }))]);
      for (const consumption of delta) {
        if (!context.products.has(consumption.ingredientId)) throw new Error('Falta un insumo en el catálogo. Sincroniza antes de vender.');
        await tx.runAsync('UPDATE products SET stock = stock - ? WHERE local_id = ?', [consumption.qty, consumption.ingredientId]);
      }
      const oldData = parseStockData(old?.data);
      const previousPending = old && old.synced !== 1 ? (oldData.stockReservationDelta ?? credits) : [];
      const reservation = { consumptions: result.consumptions, delta, pendingDelta: aggregateStockConsumptions([...previousPending, ...delta]) };
      // Guardar el documento en esta misma transacción. Así una descarga no
      // puede borrar una reserva que todavía no tiene factura local durable.
      if (save) await save(tx, reservation);
      return reservation;
    });
  },
  async cancel(localId: string, updatedData: Record<string, unknown>) {
    return db.transaction(async tx => {
      const row = await tx.queryFirst<SaleRow>('SELECT * FROM sales WHERE local_id = ?', [localId]);
      if (!row) throw new Error('Factura no encontrada.');
      if (row.status === 'cancelled') return false;
      const products = await tx.query<StockRow>('SELECT local_id, server_id, name, stock, data FROM products');
      const context = stockContext(products), data = parseStockData(row.data);
      // Las ventas nuevas reponen sus consumos reales. Para una venta local
      // antigua sin metadatos solo devolver el descuento del cliente antiguo.
      const legacy = row.synced !== 1 && !Array.isArray(data.stockConsumptions);
      const consumptions = legacy
        ? normalizeConsumptions((data.items ?? []).map((item: any) => ({ ingredientId: item.productId, qty: Number(item.quantity ?? item.qty) })), context)
        : persistedStockConsumptions(row, context);
      for (const item of consumptions) await tx.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [item.qty, item.ingredientId]);
      await tx.runAsync("UPDATE sales SET status = 'cancelled', synced = 0, data = ? WHERE local_id = ?", [JSON.stringify({ ...data, ...updatedData, status: 'cancelled' }), localId]);
      return true;
    });
  },
  async applyCatalog(products: Record<string, any>[]) {
    await db.transaction(async tx => {
      const localRows = await tx.query<any>('SELECT local_id, server_id, name, stock, data FROM products');
      const context = stockContext(localRows);
      const pendingSales = await tx.query<any>("SELECT local_id, server_id, synced, status, data FROM sales WHERE synced = 0 AND status != 'cancelled'");
      const reserved = new Map(pendingStockDeltas(pendingSales, context).map(item => [item.ingredientId, item.qty]));
      const serverProductIds = new Set<string>();
      // La lectura de pendientes y la sustitución del catálogo comparten la
      // cola/transacción con la venta: nunca borrar una reserva concurrente.
      for (const product of products) {
        const productId = String(product?.id || '').trim();
        if (!productId) continue;
        serverProductIds.add(productId);
        const existing = localRows.find(row => row.server_id === productId);
        const data = { name: product.name, sku: product.sku ?? null, cost_cents: product.costCents || Math.round((product.cost || 0) * 100), price_cents: product.priceCents || Math.round((product.price || 0) * 100), stock: Number(product.stock || 0) - (reserved.get(context.resolve(productId)) || 0), is_available_for_sale: product.isAvailableForSale === false ? 0 : 1, synced: 1, data: JSON.stringify(product) };
        const keys = Object.keys(data);
        if (existing) await tx.runAsync('UPDATE products SET ' + keys.map(key => key + ' = ?').join(', ') + ' WHERE server_id = ?', [...Object.values(data), productId]);
        else await tx.runAsync('INSERT INTO products (local_id, server_id, ' + keys.join(', ') + ') VALUES (?, ?, ' + keys.map(() => '?').join(', ') + ')', ['server_' + productId, productId, ...Object.values(data)]);
      }
      for (const row of localRows) {
        if (!row.server_id || serverProductIds.has(String(row.server_id))) continue;
        let oldData: any = {};
        try { oldData = JSON.parse(row.data || '{}'); } catch { /* Conservar la fila e invalidar su disponibilidad. */ }
        await tx.runAsync('UPDATE products SET is_available_for_sale = 0, data = ? WHERE local_id = ?', [JSON.stringify({ ...oldData, isActive: false }), row.local_id]);
      }
      await tx.runAsync('DELETE FROM sync_metadata WHERE key = ?', ['stock_snapshot_dirty']);
    });

    await this.refresh();
  },
  async release(delta: StockConsumption[]) {
    await db.transaction(async tx => {
      for (const item of delta) await tx.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [item.qty, item.ingredientId]);
    });
  },
};

// Una reserva o descarga modifica SQLite; refrescar las tarjetas evita reutilizar
// el stock anterior. Se agrupan las notificaciones de una misma descarga.
let timer: ReturnType<typeof setTimeout> | undefined;
db.subscribeChanges(() => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void saleStockService.refresh(); }, 40);
});
