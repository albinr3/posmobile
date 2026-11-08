const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
function fixture() {
  const memory = new DatabaseSync(':memory:');
  memory.exec('CREATE TABLE products(local_id TEXT PRIMARY KEY,name TEXT,sku TEXT,cost_cents INTEGER,price_cents INTEGER,stock REAL,synced INTEGER,is_available_for_sale INTEGER,data TEXT); CREATE TABLE sync_queue(local_id TEXT PRIMARY KEY,data TEXT);');
  const actor = { accountId: 'A', subUser: { id: 'owner' } };
  const state = { scope: 'A', failQueue: false, failKick: false, kicks: 0 };
  const tx = { runAsync: async (sql, params) => memory.prepare(sql).run(...params) };
  const db = { getAccountScope: () => state.scope, transaction: async callback => {
    memory.exec('BEGIN IMMEDIATE');
    try { await callback(tx); memory.exec('COMMIT'); } catch (error) { memory.exec('ROLLBACK'); throw error; }
  } };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/services/products/createLocalProduct.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, console: { warn() {} }, require: name => {
    if (name === './productAmounts') {
      const amounts = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/products/productAmounts.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: amounts });
      return amounts;
    }
    if (name.endsWith('/Database')) return { db };
    if (name.endsWith('/authStore')) return { useAuthStore: { getState: () => actor } };
    if (name.endsWith('/SyncService')) return { syncService: {
      queueOperationTx: async (connection, entity, action, data, localId, cash) => {
        assert.equal(connection, tx); assert.equal(entity, 'product'); assert.equal(action, 'create'); assert.equal(cash, null);
        if (state.failQueue) throw new Error('No se pudo encolar');
        await connection.runAsync('INSERT INTO sync_queue VALUES (?, ?)', [localId, JSON.stringify(data)]);
      },
      kickQueue: async () => { state.kicks++; if (state.failKick) throw new Error('Sync no disponible'); },
    } };
    throw Error(name);
  } });
  const product = id => ({ localId: id, name: 'Pan', sku: null, costCents: 100, priceCents: 150, stock: 3, isAvailableForSale: true });
  return { create: exports.createLocalProduct, memory, state, actor, product };
}
test('El producto y su create pendiente confirman en una misma transacción', async () => {
  const f = fixture(); await f.create(f.product('one'), 'A', 'owner');
  assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 1);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM sync_queue').get().n, 1); assert.equal(f.state.kicks, 1);
});
test('Si falla la cola se revierte el producto; reintentar no deja duplicados locales', async () => {
  const f = fixture(); f.state.failQueue = true;
  await assert.rejects(() => f.create(f.product('failed'), 'A', 'owner'), /encolar/);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 0);
  f.state.failQueue = false; await f.create(f.product('retry'), 'A', 'owner');
  assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 1);
});
test('Cambiar de cuenta, dueño o conexión SQLite bloquea el guardado anterior', async () => {
  for (const mutate of [f => { f.actor.accountId = 'B'; }, f => { f.actor.subUser.id = 'other'; }, f => { f.state.scope = 'B'; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(() => f.create(f.product('one'), 'A', 'owner'), /sesión cambió/);
    assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 0);
  }
});
test('Un error al activar el sync después del commit no presenta el guardado como fallido', async () => {
  const f = fixture(); f.state.failKick = true;
  await f.create(f.product('one'), 'A', 'owner');
  assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 1);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM sync_queue').get().n, 1);
});

test('Importes inválidos no dejan producto ni operación pendiente', async () => {
  const f = fixture();
  for (const costCents of [0, -1, Infinity, NaN, 0.5, 2147483648]) {
    await assert.rejects(() => f.create({ ...f.product('invalid'), costCents }, 'A', 'owner'), /mayores que cero/);
  }
  assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 0);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM sync_queue').get().n, 0);
});
