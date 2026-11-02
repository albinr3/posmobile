// SQLite en memoria y stores reales; no conecta con producción ni con un móvil.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { create } = require('zustand');
const root = path.resolve(__dirname, '..');

function fixture({ owner = false, permitted = false, role = 'USER' } = {}) {
  const cache = new Map(), alerts = [];
  const network = { post: async () => { throw new Error('Configura la respuesta de prueba'); }, isAxiosError: error => error?.isAxiosError === true };
  const auth = { accountId: 'A', subUser: { id: 'ana', isOwner: owner, canSellWithoutStock: permitted, role }, subUserToken: 'test', setSubUser: async user => { auth.subUser = user; } };
  function load(relative) {
    const file = path.resolve(root, relative.endsWith('.ts') ? relative : relative + '.ts');
    if (cache.has(file)) return cache.get(file);
    if (file.endsWith(path.join('store', 'authStore.ts'))) return { useAuthStore: { getState: () => auth } };
    if (file.endsWith(path.join('store', 'syncStore.ts'))) return { useSyncStore: { getState: () => ({ isOnline: true }) } };
    if (file.endsWith(path.join('sync', 'downloadFromServer.ts'))) return { downloadFromServer: async () => {} };
    if (file.endsWith(path.join('sync', 'prepareSyncRequestData.ts'))) return { prepareSyncRequestData: async () => ({}) };
    if (file.endsWith(path.join('sync', 'syncBaseline.ts'))) return { capturePhase0SyncBaselineSnapshot: async () => {} };
    if (file.endsWith(path.join('sync', 'syncShared.ts'))) return { API_URL: 'https://example.invalid', SYNC_DEBUG: false, shortToken: () => '', summarizeError: () => ({}) };
    if (file.endsWith(path.join('error', 'errorReporter.ts'))) return { reportError: async () => {} };
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, console, Map, Set, Date, Math, Promise, setTimeout: () => 0, clearTimeout() {}, require: name => {
      if (name === 'zustand') return { create };
      if (name === 'react-native') return { Alert: { alert: (...args) => alerts.push(args) } };
      if (name === 'expo-sqlite') return {};
      if (name === 'expo-secure-store') return { getItemAsync: async () => null, setItemAsync: async () => {} };
      if (name === 'axios') return { ...network, default: network };
      if (name === '@react-native-community/netinfo') return { default: {} };
      if (name === 'expo-file-system/legacy') return {};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      throw new Error('Dependencia inesperada: ' + name);
    } }, { filename: file });
    return exports;
  }
  const memory = new DatabaseSync(':memory:');
  memory.exec(`CREATE TABLE products(local_id TEXT PRIMARY KEY, server_id TEXT, name TEXT, sku TEXT, stock REAL, cost_cents INTEGER, price_cents INTEGER, is_available_for_sale INTEGER DEFAULT 1, synced INTEGER DEFAULT 1, data TEXT);
    CREATE TABLE sales(local_id TEXT PRIMARY KEY, server_id TEXT, invoice_code TEXT, customer_id TEXT, treasury_account_id TEXT, total_cents INTEGER, created_at INTEGER, synced INTEGER DEFAULT 0, status TEXT DEFAULT 'completed', data TEXT);
    CREATE TABLE sync_metadata(key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);`);
  const { db } = load('src/database/Database');
  db.db = {
    getAllAsync: async (sql, values = []) => memory.prepare(sql).all(...values),
    getFirstAsync: async (sql, values = []) => memory.prepare(sql).get(...values) ?? null,
    runAsync: async (sql, values = []) => memory.prepare(sql).run(...values),
    withTransactionAsync: async work => { memory.exec('BEGIN IMMEDIATE'); try { await work(); memory.exec('COMMIT'); } catch (error) { memory.exec('ROLLBACK'); throw error; } },
  };
  const { saleStockService: stock, useSaleStockStore: snapshot, stockContext, pendingStockDeltas } = load('src/services/stock/saleStockService');
  const { useCartStore: cart } = load('src/store/cartStore');
  const { createCartStore } = load('src/store/createCartStore');
  function product(id, quantity = 1, extra = {}) {
    const data = { id: 'remote-' + id, name: id, stock: quantity, productKind: 'BASIC', isActive: true, unit: 'UNIDAD', recipeItems: [], ...extra };
    memory.prepare('INSERT INTO products(local_id,server_id,name,stock,data,is_available_for_sale) VALUES(?,?,?,?,?,?)').run(id, data.id, id, quantity, JSON.stringify(data), extra.isAvailableForSale === false ? 0 : 1);
    return { localId: id, serverId: data.id, name: id, stock: quantity, unit: data.unit, productKind: data.productKind, priceCents: 100, synced: true, data: JSON.stringify(data) };
  }
  async function save(items = cart.getState().items, editing = null) {
    return stock.reserve(items, editing, async (tx, reservation) => {
      const data = JSON.stringify({ items, stockConsumptions: reservation.consumptions, stockReservationDelta: reservation.pendingDelta });
      if (editing) await tx.runAsync('UPDATE sales SET synced = 0, data = ? WHERE local_id = ?', [data, editing]);
      else await tx.runAsync('INSERT INTO sales(local_id, data) VALUES(?,?)', ['sale-' + memory.prepare('SELECT count(*) n FROM sales').get().n, data]);
    });
  }
  function remote() {
    const service = load('src/services/sync/SyncService').syncService;
    service.setTokenGetter(async () => 'clerk'); service.setSubUserTokenGetter(async () => auth.subUserToken);
    return service;
  }
  return { stock, snapshot, cart, createCartStore, memory, db, product, auth, alerts, save, stockContext, pendingStockDeltas, network, remote, value: id => memory.prepare('SELECT stock FROM products WHERE local_id = ?').get(id).stock };
}

test('Agotados no se agregan; ADMIN no sustituye el permiso explícito', async () => {
  const f = fixture({ role: 'ADMIN' }); const p = f.product('pan', 0); await f.stock.refresh();
  assert.equal(f.cart.getState().addItem(p), false); assert.equal(f.cart.getState().items.length, 0); assert.equal(f.alerts.length, 1);
});
test('Cantidad exacta, selección repetida y edición manual comparten el límite', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh();
  assert.equal(f.cart.getState().addItem(p), true); assert.equal(f.cart.getState().addItem(p), true); assert.equal(f.cart.getState().addItem(p), false);
  assert.equal(f.cart.getState().updateQuantity('pan', 3), false); assert.equal(f.cart.getState().items[0].quantity, 2);
  assert.equal(f.cart.getState().updateQuantity('pan', 1), true);
});
test('Medidas agregan 0,3 kg y rechazan un incremento excesivo', async () => {
  const f = fixture(); const p = f.product('harina', 0.3, { unit: 'KG', productKind: 'MEASURED' }); await f.stock.refresh();
  assert.equal(f.cart.getState().addItem(p), true); assert.equal(f.cart.getState().items[0].quantity, 0.3); assert.equal(f.cart.getState().addItem(p), false);
});
test('Propietarios y empleados autorizados pueden vender stock cero o negativo', async () => {
  for (const permission of [{ owner: true }, { permitted: true }]) {
    const f = fixture(permission); const p = f.product('pan', -1); await f.stock.refresh();
    assert.equal(f.cart.getState().addItem(p), true); await f.save(); assert.equal(f.value('pan'), -2);
  }
});
test('Recetas suman insumos ocultos, ventas directas y variantes EXTRA', async () => {
  const f = fixture(); const ingredient = f.product('pan', 3, { isAvailableForSale: false });
  const recipe = f.product('receta', 0, { productKind: 'RECIPE', recipeItems: [{ ingredientId: ingredient.serverId, ingredientName: 'pan', qty: 1 }] });
  await f.stock.refresh(); assert.equal(f.cart.getState().addItem(recipe, 2), true);
  const line = f.cart.getState().items[0];
  assert.equal(f.cart.getState().setItems([{ ...line, lineId: 'normal', quantity: 1 }, { ...line, lineId: 'extra', quantity: 1, recipeAdjustments: [{ ingredientId: ingredient.serverId, ingredientName: 'pan', adjustmentType: 'EXTRA' }] }]), true);
  assert.equal(f.cart.getState().addItem(recipe), false);
  await f.save(); assert.equal(f.value('pan'), 0); assert.equal(f.value('receta'), 0);
});
test('Personalizar rechaza extras sin alterar el carrito y SIN libera el insumo', async () => {
  const f = fixture(); const a = f.product('pan', 1), b = f.product('queso', 1);
  const p = f.product('receta', 0, { productKind: 'RECIPE', recipeItems: [{ ingredientId: a.serverId, qty: 1 }, { ingredientId: b.serverId, qty: 1 }] });
  await f.stock.refresh(); f.cart.getState().addItem(p); const line = f.cart.getState().items[0];
  assert.equal(f.cart.getState().setItems([{ ...line, recipeAdjustments: [{ ingredientId: a.serverId, ingredientName: 'pan', adjustmentType: 'EXTRA' }] }]), false);
  assert.equal(f.cart.getState().items[0].recipeAdjustments.length, 0);
  assert.equal(f.cart.getState().setItems([{ ...line, recipeAdjustments: [{ ingredientId: b.serverId, ingredientName: 'queso', adjustmentType: 'SIN' }] }]), true);
  await f.save(); assert.equal(f.value('queso'), 1); assert.equal(f.value('pan'), 0);
});
test('Stock cambiado antes de guardar no crea factura ni descuenta inventario', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p);
  f.memory.prepare('UPDATE products SET stock = 0').run();
  await assert.rejects(f.save(), /Existencia insuficiente/);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM sales').get().n, 0); assert.equal(f.value('pan'), 0);
});
test('SQLite revierte el descuento si no se puede guardar la factura', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p);
  await assert.rejects(f.stock.reserve(f.cart.getState().items, null, async () => { throw new Error('falló el documento'); }), /falló/);
  assert.equal(f.value('pan'), 2);
});
test('Dos guardados concurrentes no usan dos veces la última existencia', async () => {
  const f = fixture(); const p = f.product('pan', 1); await f.stock.refresh(); f.cart.getState().addItem(p);
  const results = await Promise.allSettled([f.save(), f.save()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.value('pan'), 0);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM sales').get().n, 1);
});
test('Pendientes sobreviven a refrescar y no se descuentan dos veces', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p); await f.save();
  await f.stock.refresh(); assert.equal(f.value('pan'), 1);
  await f.stock.applyCatalog([{ id: p.serverId, name: p.name, stock: 2, priceCents: 100, productKind: 'BASIC', isActive: true }]);
  assert.equal(f.value('pan'), 1);
  f.memory.prepare('UPDATE sales SET synced = 1').run();
  await f.stock.applyCatalog([{ id: p.serverId, name: p.name, stock: 1, priceCents: 100, productKind: 'BASIC', isActive: true }]);
  assert.equal(f.value('pan'), 1);
});
test('Descargar y guardar simultáneamente conserva la reserva durable', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p);
  await Promise.all([f.save(), f.stock.applyCatalog([{ id: p.serverId, name: p.name, stock: 2, priceCents: 100, productKind: 'BASIC', isActive: true }])]);
  assert.equal(f.value('pan'), 1);
});
test('Editar devuelve solo el consumo anterior; factura sin cambios con stock cero es válida', async () => {
  const f = fixture(); const p = f.product('pan', 1); await f.stock.refresh(); f.cart.getState().addItem(p); await f.save();
  f.memory.prepare('UPDATE sales SET synced = 1').run(); await f.stock.refresh('sale-0');
  await f.save(f.cart.getState().items, 'sale-0'); assert.equal(f.value('pan'), 0);
  await assert.rejects(f.save([{ ...f.cart.getState().items[0], quantity: 2 }], 'sale-0'), /Existencia insuficiente/);
});
test('Cambiar de cuenta o tener datos incompletos bloquea el carrito', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.auth.accountId = 'B';
  assert.equal(f.cart.getState().addItem(p), false); f.auth.accountId = 'A';
  f.memory.prepare('INSERT INTO sales(local_id,data) VALUES(?,?)').run('legacy', '{}'); await f.stock.refresh();
  assert.equal(f.cart.getState().addItem(p), false);
});
test('La restricción de facturación no se impone a las cotizaciones', () => {
  const f = fixture(); const p = f.product('pan', 0); const quote = f.createCartStore(() => ({}));
  assert.equal(quote.getState().addItem(p, 10), true); assert.equal(quote.getState().items[0].quantity, 10);
});
test('Cancelar recetas devuelve los insumos reales una sola vez', async () => {
  const f = fixture(); const ingredient = f.product('pan', 2);
  const p = f.product('receta', 0, { productKind: 'RECIPE', recipeItems: [{ ingredientId: ingredient.serverId, qty: 1 }] });
  await f.stock.refresh(); f.cart.getState().addItem(p); await f.save();
  assert.equal(f.value('pan'), 1);
  assert.equal(await f.stock.cancel('sale-0', {}), true); assert.equal(f.value('pan'), 2); assert.equal(f.value('receta'), 0);
  assert.equal(await f.stock.cancel('sale-0', {}), false); assert.equal(f.value('pan'), 2);
});
test('Un faltante remoto no crea factura ni reserva local', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p);
  f.network.post = async () => ({ data: { accountId: 'A', userId: 'ana', isOwner: false, canSellWithoutStock: false, ok: false, issue: { message: 'Stock remoto insuficiente' } } });
  await assert.rejects(f.remote().checkSaleStock(f.cart.getState().items, null), /Stock remoto/);
  assert.equal(f.value('pan'), 2); assert.equal(f.memory.prepare('SELECT count(*) n FROM sales').get().n, 0);
});
test('403 y endpoint ausente bloquean; solo un fallo de red permite validación offline', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p);
  for (const status of [403, 404]) {
    f.network.post = async () => { throw { isAxiosError: true, response: { status, data: { error: 'Sin permiso' } } }; };
    await assert.rejects(f.remote().checkSaleStock(f.cart.getState().items, null), status === 403 ? /Sin permiso/ : /Actualiza el servidor/);
  }
  f.network.post = async () => { throw { isAxiosError: true }; };
  await f.remote().checkSaleStock(f.cart.getState().items, null);
  assert.equal(f.value('pan'), 2);
});
test('La validación remota actualiza los permisos y descuenta pendientes del dispositivo', async () => {
  const f = fixture(); const p = f.product('pan', 3); await f.stock.refresh(); f.cart.getState().addItem(p); await f.save();
  const data = { accountId: 'A', userId: 'ana', isOwner: false, canSellWithoutStock: false, ok: true, inventory: [{ id: p.serverId, name: 'pan', stock: 1, isActive: true, snapshotAt: 1 }], consumptions: [{ ingredientId: p.serverId, qty: 1 }] };
  f.network.post = async () => ({ data });
  await assert.rejects(f.remote().checkSaleStock(f.cart.getState().items, null), /Existencia insuficiente/);
  f.memory.prepare('UPDATE sales SET synced = 1').run(); f.auth.subUser.isOwner = true;
  await f.remote().checkSaleStock(f.cart.getState().items, null); assert.equal(f.auth.subUser.isOwner, false);
});
test('Cambiar de usuario durante el preflight bloquea el guardado', async () => {
  const f = fixture(); const p = f.product('pan', 2); await f.stock.refresh(); f.cart.getState().addItem(p);
  f.network.post = async () => { f.auth.accountId = 'B'; return { data: { accountId: 'A', userId: 'ana' } }; };
  await assert.rejects(f.remote().checkSaleStock(f.cart.getState().items, null), /usuario cambió/);
  assert.equal(f.value('pan'), 2);
});
