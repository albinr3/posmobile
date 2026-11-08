const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const memory = new DatabaseSync(':memory:');
  memory.exec(`CREATE TABLE products(local_id TEXT PRIMARY KEY,server_id TEXT,name TEXT,sku TEXT,cost_cents INTEGER,price_cents INTEGER,stock REAL,synced INTEGER,is_available_for_sale INTEGER,data TEXT);
    CREATE TABLE sync_queue(id INTEGER PRIMARY KEY,entity_type TEXT,entity_local_id TEXT,action TEXT,data TEXT,status TEXT,retry_count INTEGER DEFAULT 0,next_attempt_at INTEGER,last_error_code TEXT,sync_started_at INTEGER);
    INSERT INTO products VALUES ('same',NULL,'Pan',NULL,0,200,3,0,1,'{}');
    INSERT INTO sync_queue(id,entity_type,entity_local_id,action,data,status) VALUES(7,'product','same','create','{"costCents":0}','error');`);
  const actor = { accountId: 'A', subUser: { id: 'owner' } };
  const state = { kicks: 0, workers: 0, failQueue: false };
  const tx = { runAsync: async (sql, params = []) => memory.prepare(sql).run(...params), queryFirst: async (sql, params = []) => memory.prepare(sql).get(...params) ?? null };
  const db = { getAccountScope: () => 'A', transaction: async callback => {
    memory.exec('BEGIN IMMEDIATE');
    try { const result = await callback(tx); memory.exec('COMMIT'); return result; } catch (error) { memory.exec('ROLLBACK'); throw error; }
  } };
  const file = ts.createSourceFile('SyncService.ts', fs.readFileSync(path.join(root, 'src/services/sync/SyncService.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const serviceClass = file.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'SyncService');
  const methods = ['withProductQueuePaused', 'processQueue'].map(name => serviceClass.members.find(n => n.name?.text === name).getText(file).replace(/^(?:private )?async (\w+)/, 'async function $1'));
  const exports = {};
  vm.runInNewContext(compile(methods.join('\n') + '\nexports.pause = withProductQueuePaused; exports.process = processQueue;'), {
    exports, Date, Promise, Error, setTimeout, SYNC_DEBUG: false, useSyncStore: { getState: () => ({ isOnline: true, setSyncBlockedReason() {} }) },
  });
  const service = {
    isSyncing: false, backendAuthCooldownUntil: 0, withProductQueuePaused: exports.pause, processQueue: exports.process,
    ensureSubUserSessionFresh: async () => ({ ready: true }), getAuthStatus: async () => ({ ready: true, clerkToken: 'token' }), updatePendingCount: async () => {},
    processQueueInternal: async () => { state.workers++; },
    queueOperationTx: async (connection, entity, action, data, id) => {
      if (state.failQueue) throw new Error('Fallo de cola');
      await connection.runAsync("INSERT INTO sync_queue(entity_type,entity_local_id,action,data,status) VALUES(?,?,?,?, 'pending')", [entity, id, action, JSON.stringify(data)]);
    },
    kickQueue: async () => { state.kicks++; },
  };
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file); if (!file.endsWith('.ts')) file += '.ts';
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, console, require: name => {
      if (name.endsWith('/Database')) return { db };
      if (name.endsWith('/authStore')) return { useAuthStore: { getState: () => actor } };
      if (name.endsWith('/SyncService')) return { syncService: service };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      throw Error(name);
    } });
    return exports;
  }
  const update = load('src/services/products/updateLocalProduct.ts').updateLocalProduct;
  const product = { localId: 'same', name: 'Pan', sku: null, costCents: 100, priceCents: 200, stock: 999, isAvailableForSale: true };
  return { memory, actor, state, service, update, product, queued: () => memory.prepare("SELECT * FROM sync_queue WHERE status != 'synced'").all() };
}

test('Corregir costo cero conserva localId, fila y create pendiente incluso con dos guardados simultáneos', async () => {
  const f = fixture();
  await Promise.all([f.update(f.product, 'A', 'owner'), f.update(f.product, 'A', 'owner')]);
  assert.equal(f.memory.prepare('SELECT count(*) n FROM products').get().n, 1);
  const rows = f.queued(); assert.equal(rows.length, 1); assert.equal(rows[0].id, 7); assert.equal(rows[0].action, 'create');
  assert.equal(JSON.parse(rows[0].data).costCents, 100); assert.equal(JSON.parse(rows[0].data).stock, 3);
  assert.equal(f.memory.prepare('SELECT cost_cents FROM products').get().cost_cents, 100);
});

test('La edición espera al worker y relee el ID recién sincronizado antes de decidir create/update', async () => {
  const f = fixture(); let release;
  f.service.processQueueInternal = async () => {
    await new Promise(resolve => { release = resolve; });
    f.memory.exec("UPDATE products SET server_id='remote',synced=1; UPDATE sync_queue SET status='synced'");
  };
  const worker = f.service.processQueue();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const saving = f.update(f.product, 'A', 'owner'); release(); await worker; await saving;
  assert.equal(f.queued().length, 1); assert.equal(f.queued()[0].action, 'update'); assert.equal(JSON.parse(f.queued()[0].data).id, 'remote');
});

test('El lock de edición impide que processQueue entre durante la transacción y se libera ante errores', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.withProductQueuePaused(async () => {
    assert.equal(f.service.isSyncing, true); await f.service.processQueue(); assert.equal(f.state.workers, 0); throw new Error('rollback');
  }), /rollback/);
  assert.equal(f.service.isSyncing, false); await f.service.processQueue(); assert.equal(f.state.workers, 1);
});

test('Un envío syncing incierto se conserva y no se convierte en otro create', async () => {
  const f = fixture(); f.memory.exec("UPDATE sync_queue SET status='syncing'");
  await assert.rejects(() => f.update(f.product, 'A', 'owner'), /sincronización pendiente/);
  assert.equal(f.queued().length, 1); assert.equal(f.queued()[0].status, 'syncing');
  assert.equal(f.memory.prepare('SELECT cost_cents FROM products').get().cost_cents, 0);
});

test('Producto y cola se revierten juntos si falla la edición', async () => {
  const f = fixture(); f.memory.exec("UPDATE products SET server_id='remote'; DELETE FROM sync_queue"); f.state.failQueue = true;
  await assert.rejects(() => f.update(f.product, 'A', 'owner'), /Fallo de cola/);
  assert.equal(f.memory.prepare('SELECT cost_cents FROM products').get().cost_cents, 0); assert.equal(f.queued().length, 0); assert.equal(f.service.isSyncing, false);
});

test('La edición rechaza importes inválidos y cambios de sesión sin modificar el producto', async () => {
  const f = fixture(); await assert.rejects(() => f.update({ ...f.product, costCents: 0 }, 'A', 'owner'), /mayores que cero/);
  f.actor.accountId = 'B'; await assert.rejects(() => f.update(f.product, 'A', 'owner'), /sesión cambió/);
  assert.equal(f.memory.prepare('SELECT cost_cents FROM products').get().cost_cents, 0);
});
