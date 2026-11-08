// Ejecuta modelo, persistencia, coordinación y handlers reales con infraestructura aislada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createStore } = require('zustand/vanilla');
const root = path.resolve(__dirname, '..');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture() {
  const storage = new Map(), cache = new Map(), intervals = new Set(), changes = new Set(), appListeners = new Set();
  const auth = { accountId: 'A', subUser: { id: 'owner-A', isOwner: true }, subUserToken: 'employee-token', isAuthenticated: true };
  const sync = { isOnline: true, lastSyncTime: null };
  const calls = { get: 0, post: 0, query: 0, realCart: 0, navigation: [] };
  let remote = { completedAt: null, mobileAutoStartEligible: true, completionProductId: null };
  let localProduct = { synced: 0, server_id: null, cost_cents: 100, price_cents: 200, is_available_for_sale: 1, data: '{}' }, pendingOperation = null, readStorage = key => Promise.resolve(storage.get(key) ?? null);
  let fetchRemote = async () => { calls.get++; return { ...remote }; };
  let post = async () => { calls.post++; return '2026-11-07T12:00:00.000Z'; };
  const cells = [], effects = []; let cursor = 0;
  const react = {
    useRef(initial) { const index = cursor++; return cells[index] ?? (cells[index] = { current: initial }); },
    useEffect(callback, dependencies) {
      const index = cursor++, old = cells[index];
      if (!old || dependencies.some((dep, i) => dep !== old.dependencies[i])) {
        effects.push(() => { old?.cleanup?.(); cells[index] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  const select = value => Object.assign(selector => selector ? selector(value) : value, { getState: () => value });
  function load(relative) {
    let file = path.resolve(root, relative);
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, console, Date, Math, Map, Set, Promise, Object, Number, JSON, AbortController,
      setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn), require: name => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
        if (name === 'zustand') return { create: initializer => { const store = createStore(initializer); return Object.assign(selector => selector ? selector(store.getState()) : store.getState(), store); } };
        if (name === '@react-native-async-storage/async-storage') return { getItem: key => readStorage(key), setItem: async (key, value) => { storage.set(key, value); } };
        if (name.endsWith('/authStore')) return { useAuthStore: select(auth) };
        if (name.endsWith('/syncStore')) return { useSyncStore: select(sync) };
        // Cualquier acceso al carrito operativo desde el recorrido aislado es una regresión.
        if (name.endsWith('/cartStore')) return { useCartStore: () => { calls.realCart++; throw new Error('La práctica accedió al carrito real'); } };
        if (name.endsWith('/SyncService')) return { syncService: { incrementalSync: async () => {} } };
        if (name === '@clerk/clerk-expo') return { useAuth: () => ({ getToken: async () => 'clerk-token' }) };
        if (name.endsWith('/Database')) return { db: { queryFirst: async sql => { calls.query++; return sql.includes('sync_queue') ? pendingOperation : localProduct; }, subscribeChanges: callback => { changes.add(callback); return () => changes.delete(callback); } } };
        if (name === './onboardingApi') return { onboardingHeaders: () => ({ accountId: auth.accountId }), fetchSharedOnboarding: (...args) => fetchRemote(...args), completeSharedOnboarding: (...args) => post(...args) };
        if (name.endsWith('/SafeAreaView')) return { SafeAreaView: 'SafeAreaView' };
        if (name.endsWith('/OnboardingTarget')) return { OnboardingTarget: 'OnboardingTarget' };
        if (name.endsWith('/useTutorialScroll')) return { useTutorialScroll: () => ({}) };
        if (name.endsWith('/SalesPresentation')) return { SalePrice: 'SalePrice', SaleSummaryRow: 'SaleSummaryRow' };
        if (name.endsWith('/TutorialCelebration')) return { TutorialCelebration: 'TutorialCelebration' };
        if (name.endsWith('/POSScreen')) return { POSScreen: 'POSScreen' };
        if (name.endsWith('/CartScreen')) return { CartScreen: 'CartScreen' };
        if (name === '@react-navigation/stack') return { createStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }), CardStyleInterpolators: {} };
        if (name === 'react-native-paper') return Object.fromEntries(['Text', 'Icon', 'IconButton', 'Button'].map(type => [type, type]));
        if (name === 'react-native-reanimated') return { useReducedMotion: () => false };
        if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: (_event, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } }, StyleSheet: { create: value => value }, View: 'View', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity' };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
        throw new Error('Dependencia no permitida en práctica: ' + name);
      } }, { filename: file });
    return exports;
  }
  const model = load('src/services/onboarding/onboardingModel.ts');
  const store = load('src/store/onboardingStore.ts').useOnboardingStore;
  const runEffects = () => { while (effects.length) effects.shift()(); };
  const unmountEffects = () => { for (const cell of cells) { cell?.cleanup?.(); if (cell) cell.cleanup = undefined; } };
  const runRuntime = () => { cursor = 0; load('src/services/onboarding/useOnboardingRuntime.ts').useOnboardingRuntime(); runEffects(); };
  return { model, store, calls, auth, sync, storage, load, runRuntime, runEffects, unmountEffects, intervals, changes, appListeners,
    setRemote: value => { remote = value; }, setFetch: fn => { fetchRemote = fn; }, setPost: fn => { post = fn; }, setLocal: value => { localProduct = value && { cost_cents: 100, price_cents: 200, is_available_for_sale: 1, data: '{}', ...value }; }, setPending: value => { pendingOperation = value; }, setStorageRead: fn => { readStorage = fn; } };
}
test('La práctica limita cantidades, calcula centavos y rechaza cantidades corruptas', () => {
  const { model } = fixture();
  assert.equal(model.practiceQuantity(Infinity), 0);
  assert.equal(model.practiceQuantity(-3), 0);
  assert.equal(model.practiceQuantity(18), 10);
  assert.equal(model.practiceTotals({ coffee: 2, water: 1 }).totalCents, 25000);
});
test('Reanudar recalcula el primer campo inválido; nunca confía en un índice guardado', () => {
  const { model } = fixture();
  const draft = { ...model.EMPTY_PRODUCT_DRAFT, name: 'Pan', price: '50', cost: '20', stock: '3' };
  assert.equal(model.nextProductField(draft), 'save');
  assert.equal(model.nextProductField({ ...draft, name: '' }), 'name');
  assert.equal(model.nextProductField({ ...draft, stock: '1.5' }), 'stock');
  assert.equal(model.nextProductField({ ...draft, price: 'Infinity' }), 'price');
  assert.equal(model.nextProductField({ ...draft, cost: '0' }), 'cost');
  const recovered = model.parseTutorialProgress(JSON.stringify({ stage: 'completed', completedAt: 'invalido', draft: { supplierId: {} } }));
  assert.equal(recovered.stage, 'welcome'); assert.equal(recovered.draft.supplierId, null);
});
test('Solo el dueño de un negocio nuevo recibe inicio automático, una vez y sin venta en curso', () => {
  const { model } = fixture();
  const eligible = { isOwner: true, eligible: true, remoteChecked: true, introSeen: false, completedAt: null, ready: true, onHome: true, hasSale: false };
  assert.equal(model.shouldAutoStartTutorial(eligible), true);
  for (const patch of [{ isOwner: false }, { eligible: false }, { remoteChecked: false }, { introSeen: true }, { completedAt: '2026-11-07' }, { ready: false }, { onHome: false }, { hasSale: true }]) {
    assert.equal(model.shouldAutoStartTutorial({ ...eligible, ...patch }), false);
  }
});
test('Posponer y reiniciar conserva borrador y práctica sin completar globalmente', async () => {
  const f = fixture(), key = f.model.onboardingStorageKey('A', 'owner-A');
  await f.store.getState().hydrate(key);
  f.store.getState().open(); f.store.getState().go('product');
  f.store.getState().setDraft({ ...f.model.EMPTY_PRODUCT_DRAFT, name: 'Mi producto' });
  f.store.getState().quantity('coffee', 2); f.store.getState().postpone();
  await flush(); await f.store.getState().hydrate(key);
  assert.equal(f.store.getState().draft.name, 'Mi producto');
  assert.equal(f.store.getState().quantities.coffee, 2);
  assert.equal(f.store.getState().active, false); assert.equal(f.store.getState().completedAt, null);
});
test('Una hidratación antigua no filtra el borrador a otro propietario o cuenta', async () => {
  const f = fixture(); let resolveOld;
  f.setStorageRead(key => key === 'A' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(null));
  const old = f.store.getState().hydrate('A'); await flush();
  await f.store.getState().hydrate('B');
  resolveOld(JSON.stringify({ stage: 'product', draft: { name: 'Privado A' } })); await old;
  assert.equal(f.store.getState().sessionKey, 'B'); assert.equal(f.store.getState().draft.name, '');
});
test('La finalización remota cierra la guía y conserva el formulario', async () => {
  const f = fixture(); await f.store.getState().hydrate('A');
  f.store.getState().open(); f.store.getState().go('product');
  f.store.getState().setDraft({ ...f.model.EMPTY_PRODUCT_DRAFT, name: 'Sin guardar' });
  f.store.getState().applyRemote({ completedAt: '2026-11-07T12:00:00.000Z', mobileAutoStartEligible: true, completionProductId: 'real' });
  assert.equal(f.store.getState().active, false); assert.equal(f.store.getState().draft.name, 'Sin guardar');
  f.store.getState().savedProduct('late'); assert.equal(f.store.getState().stage, 'completed');
});
test('Un empleado no hidrata ni consulta el onboarding del dueño', async () => {
  const f = fixture(); f.auth.subUser.isOwner = false; f.runRuntime(); await flush(); f.runRuntime(); await flush();
  assert.equal(f.store.getState().sessionKey, null); assert.equal(f.calls.get, 0);
});
async function startRuntime(f) { f.runRuntime(); await flush(); f.runRuntime(); await flush(); }
test('Guardar offline espera al ID servidor y finaliza una sola vez ante eventos simultáneos', async () => {
  const f = fixture(); await startRuntime(f);
  f.store.getState().open(); f.store.getState().savedProduct('local-product');
  f.runRuntime(); await flush(); assert.equal(f.calls.post, 0);
  f.setLocal({ synced: 1, server_id: 'server-product' });
  let resolvePost;
  f.setPost(async (_headers, productId) => { assert.equal(productId, 'server-product'); f.calls.post++; return new Promise(resolve => { resolvePost = resolve; }); });
  f.changes.forEach(callback => callback()); f.appListeners.forEach(callback => callback('active')); f.intervals.forEach(callback => callback());
  await flush(); assert.equal(f.calls.post, 1);
  resolvePost('2026-11-07T12:00:00.000Z'); await flush();
  assert.equal(f.store.getState().stage, 'completed'); assert.equal(f.store.getState().celebrating, true);
});
test('La confirmación de sincronización no repite una felicitación local ya cerrada', async () => {
  const f = fixture(); await startRuntime(f); f.setLocal({ synced: 1, server_id: 'my-product' });
  let resolvePost;
  f.setPost(async () => { f.calls.post++; return new Promise(resolve => { resolvePost = resolve; }); });
  f.store.getState().open(); f.store.getState().savedProduct('local-product'); f.runRuntime(); await flush();
  assert.equal(f.store.getState().celebrating, true); assert.equal(f.store.getState().active, false); assert.equal(f.calls.post, 1);
  f.store.getState().dismissCelebration(); resolvePost('2026-11-07T12:00:00Z'); await flush();
  assert.equal(f.store.getState().stage, 'completed'); assert.equal(f.store.getState().celebrating, false);
});
test('Cambiar de cuenta descarta respuestas HTTP antiguas', async () => {
  const f = fixture(); let resolveOld;
  f.setFetch(() => new Promise(resolve => { resolveOld = resolve; }));
  await startRuntime(f);
  const replyForA = resolveOld;
  f.setFetch(async () => ({ completedAt: null, mobileAutoStartEligible: false, completionProductId: null }));
  f.auth.accountId = 'B'; f.auth.subUser = { id: 'owner-B', isOwner: true };
  f.runRuntime(); await flush();
  replyForA({ completedAt: '2026-11-07T12:00:00.000Z', mobileAutoStartEligible: true, completionProductId: null }); await flush();
  assert.match(f.store.getState().sessionKey, /:B:owner-B$/); assert.equal(f.store.getState().completedAt, null);
});
test('Una falla de red conserva la finalización pendiente y no vuelve a crear productos', async () => {
  const f = fixture(); await startRuntime(f);
  f.setPost(async () => { f.calls.post++; throw new Error('Sin red'); });
  f.store.getState().open(); f.store.getState().finishWithExisting('real'); f.runRuntime(); await flush();
  assert.equal(f.store.getState().stage, 'pending'); assert.equal(f.calls.post, 1); assert.equal(f.calls.query, 0);
  assert.match(f.store.getState().error, /reintentaremos/);
});
function nodes(tree) { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(visit); result.push(node); visit(node.props?.children); }; visit(tree); return result; }
function practiceFixture() {
  const f = fixture();
  return { ...f, cart: f.load('src/store/tutorialCartStore.ts').useTutorialCartStore,
    catalog: f.load('src/services/onboarding/practiceCatalog.ts').PRACTICE_CATALOG };
}
function screenHandler(relative, name, context) {
  const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(declaration?.initializer, `No se encontró el handler ${name}`);
  const code = ts.transpileModule(`exports.handler = (${declaration.initializer.getText(source)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...context });
  return exports.handler;
}
function screenTargetHandler(relative, targetId, context) {
  const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let target, handler;
  const findTarget = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'OnboardingTarget'
      && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'id' && attribute.initializer?.text === targetId)) target = node;
    ts.forEachChild(node, findTarget);
  };
  findTarget(source); assert.ok(target, `No se encontró el control ${targetId}`);
  const findHandler = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress' && ts.isJsxExpression(node.initializer)) handler = node.initializer.expression;
    ts.forEachChild(node, findHandler);
  };
  findHandler(target); assert.ok(handler, `El control ${targetId} no tiene handler`);
  const exports = {}, code = ts.transpileModule(`exports.handler = (${handler.getText(source)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, ...context });
  return exports.handler;
}
test('La práctica monta las mismas pantallas POS y Carrito con el modo tutorial', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  const navigation = { addListener: () => () => {}, navigate: (...args) => f.calls.navigation.push(args), replace: (...args) => f.calls.navigation.push(args) };
  const stack = f.load('src/screens/onboarding/PracticeNavigator.tsx').PracticeNavigator({ navigation });
  const screens = Object.fromEntries(nodes(stack).filter(n => n.type === 'Screen').map(n => [n.props.name, n.props.component]));
  const rendered = ['POSMain', 'Cart'].flatMap(name => {
    assert.equal(typeof screens[name], 'function', `Falta la ruta real ${name}`);
    return nodes(screens[name]({ navigation }));
  });
  const pos = rendered.find(n => n.type === 'POSScreen'), cart = rendered.find(n => n.type === 'CartScreen');
  assert.ok(pos, 'El catálogo debe renderizar POSScreen'); assert.equal(pos.props.tutorial, true);
  assert.ok(cart, 'El carrito debe renderizar CartScreen'); assert.equal(cart.props.tutorial, true);
  assert.equal(f.calls.query, 0); assert.equal(f.calls.get, 0); assert.equal(f.calls.post, 0); assert.equal(f.calls.realCart, 0);
});
test('Los tres productos de práctica tienen identidad efímera y los mismos importes que la web', () => {
  const f = practiceFixture();
  assert.equal(f.catalog.length, 3);
  assert.deepEqual(Array.from(f.catalog, p => [p.localId, p.name, p.priceCents, p.costCents, p.stock]), [
    ['tutorial-demo:coffee', 'Café Americano', 10000, 5000, 10],
    ['tutorial-demo:water', 'Botella de Agua', 5000, 2500, 10],
    ['tutorial-demo:snack', 'Snack', 7500, 3750, 10],
  ]);
  for (const product of f.catalog) {
    assert.equal(product.serverId, undefined); assert.equal(JSON.parse(product.data).isOnboardingDemo, true);
  }
  assert.equal(f.calls.query, 0); assert.equal(f.calls.realCart, 0);
});
test('Cualquiera de los tres productos permite completar la práctica una sola vez y limpia el carrito', async () => {
  for (let index = 0; index < 3; index++) {
    const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
    const product = f.catalog[index], id = product.localId.replace('tutorial-demo:', '');
    assert.equal(f.cart.getState().addItem(product), true);
    assert.equal(f.store.getState().quantities[id], 1);
    f.store.getState().go('cart');
    assert.equal(f.store.getState().completePractice(), true);
    assert.equal(f.store.getState().stage, 'practiceDone'); assert.equal(f.store.getState().quantities[id], 1);
    assert.equal(f.cart.getState().items.length, 0); assert.equal(f.store.getState().completePractice(), false);
    assert.equal(f.calls.query, 0); assert.equal(f.calls.get, 0); assert.equal(f.calls.post, 0); assert.equal(f.calls.realCart, 0);
  }
});
test('Los handlers reales de seleccionar y facturar completan la práctica sin ejecutar el guardado financiero', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  const add = screenHandler('src/screens/sales/POSScreen.tsx', 'handleProductPress', {
    addItem: (...args) => f.cart.getState().addItem(...args), Alert: { alert: () => assert.fail('Un demo activo no debe generar alerta') },
  });
  add(f.catalog[1]); add(f.catalog[2]); add(f.catalog[1]);
  assert.equal(f.cart.getState().getTotal(), 17500); assert.equal(f.store.getState().quantities.water, 2);
  f.store.getState().go('cart');
  const complete = screenHandler('src/screens/sales/CartScreen.tsx', 'handleCompleteSale', {
    tutorial: true, completingSaleRef: { current: false }, useScreenCart: f.cart, useOnboardingStore: f.store,
    navigation: { replace: route => f.calls.navigation.push(route) },
    setLoading: () => assert.fail('El handler de práctica entró al guardado financiero'),
  });
  await Promise.all([complete(), complete()]);
  assert.equal(f.store.getState().stage, 'practiceDone'); assert.deepEqual(f.calls.navigation, ['PracticeDone']);
  assert.equal(f.cart.getState().items.length, 0); assert.equal(f.store.getState().quantities.water, 2); assert.equal(f.store.getState().quantities.snack, 1);
  assert.equal(f.calls.query, 0); assert.equal(f.calls.post, 0); assert.equal(f.calls.get, 0); assert.equal(f.calls.realCart, 0);
});
test('El carrito de práctica aumenta, reduce y elimina cantidades sin aceptar productos reales ni stock inválido', () => {
  const f = practiceFixture(), product = f.catalog[1], cart = () => f.cart.getState();
  assert.equal(cart().addItem(product, 2), true); assert.equal(cart().getTotal(), 10000);
  assert.equal(cart().updateQuantity(product.localId, 3), true); assert.equal(cart().getTotal(), 15000);
  assert.equal(cart().updateQuantity(product.localId, 1), true); assert.equal(cart().getTotal(), 5000);
  for (const quantity of [11, 1.5, Infinity, NaN]) assert.equal(cart().updateQuantity(product.localId, quantity), false);
  assert.equal(cart().items[0].quantity, 1);
  assert.equal(cart().addItem({ ...product, localId: 'real-product' }), false);
  assert.equal(cart().updateQuantity(product.localId, 0), true); assert.equal(cart().items.length, 0);
  assert.equal(f.calls.query, 0); assert.equal(f.calls.realCart, 0);
});
test('Un carrito vacío no completa la venta de práctica', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('cart');
  assert.equal(f.store.getState().completePractice(), false); assert.equal(f.store.getState().stage, 'cart');
});
test('Agregar productos desde un carrito reanudado vacío abre el catálogo aunque no exista historial', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  f.cart.getState().addItem(f.catalog[1]); f.store.getState().go('cart'); f.store.getState().postpone();
  await flush(); await f.store.getState().hydrate('A'); f.store.getState().open();
  f.cart.getState().removeItem(f.catalog[1].localId); assert.equal(f.cart.getState().items.length, 0);
  const addProducts = screenTargetHandler('src/screens/sales/CartScreen.tsx', 'sale.addProducts', {
    tutorial: true, useOnboardingStore: f.store,
    navigation: { navigate: route => f.calls.navigation.push(route), goBack: () => assert.fail('Un carrito reanudado puede no tener pantalla anterior') },
  });
  addProducts(); assert.deepEqual(f.calls.navigation, ['POSMain']); assert.equal(f.store.getState().stage, 'catalog');
  assert.equal(f.calls.query, 0); assert.equal(f.calls.realCart, 0);
});
test('Posponer limpia los productos efímeros y reabrir restaura solo las cantidades de esa sesión', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  f.cart.getState().addItem(f.catalog[2], 3); f.store.getState().go('cart'); f.store.getState().postpone();
  assert.equal(f.cart.getState().items.length, 0); assert.equal(f.store.getState().quantities.snack, 3);
  f.store.getState().open(); assert.equal(f.cart.getState().items[0].productId, 'tutorial-demo:snack'); assert.equal(f.cart.getState().items[0].quantity, 3);
  await f.store.getState().hydrate('B'); assert.equal(f.cart.getState().items.length, 0);
  assert.equal(f.model.practiceTotals(f.store.getState().quantities).count, 0); assert.equal(f.calls.realCart, 0);
});
test('Rehidratar una práctica activa conserva el avance antes de limpiar el carrito en memoria', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  f.cart.getState().addItem(f.catalog[1], 2); await flush();
  await f.store.getState().hydrate('A');
  assert.equal(f.cart.getState().items.length, 0); assert.equal(f.store.getState().quantities.water, 2);
  f.store.getState().open(); assert.equal(f.cart.getState().items[0].quantity, 2);
});
test('Desmontar la práctica pospone antes de limpiar y conserva las cantidades para reanudar', async () => {
  for (const stage of ['catalog', 'cart', 'practiceDone']) {
    const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
    f.cart.getState().addItem(f.catalog[1], 2);
    if (stage !== 'catalog') f.store.getState().go('cart');
    if (stage === 'practiceDone') f.store.getState().completePractice();
    let unsubscribed = 0;
    f.load('src/screens/onboarding/PracticeNavigator.tsx').PracticeNavigator({ navigation: { addListener: () => () => { unsubscribed++; } } });
    f.runEffects(); f.unmountEffects();
    assert.equal(unsubscribed, 1); assert.equal(f.store.getState().active, false); assert.equal(f.store.getState().stage, stage);
    assert.equal(f.store.getState().quantities.water, 2); assert.equal(f.cart.getState().items.length, 0);
    await flush(); await f.store.getState().hydrate('A'); assert.equal(f.store.getState().quantities.water, 2);
    f.store.getState().open();
    if (stage !== 'practiceDone') assert.equal(f.cart.getState().items[0].quantity, 2);
    assert.equal(f.calls.realCart, 0);
  }
});
test('El desmontaje de una sesión anterior no borra ni pospone el carrito de la nueva cuenta', async () => {
  const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  f.cart.getState().addItem(f.catalog[0], 2);
  f.load('src/screens/onboarding/PracticeNavigator.tsx').PracticeNavigator({ navigation: { addListener: () => () => {} } }); f.runEffects();
  await f.store.getState().hydrate('B'); f.store.getState().open(); f.store.getState().go('catalog'); f.cart.getState().addItem(f.catalog[2], 3);
  f.unmountEffects();
  assert.equal(f.store.getState().sessionKey, 'B'); assert.equal(f.store.getState().active, true); assert.equal(f.store.getState().stage, 'catalog');
  assert.equal(f.cart.getState().items.length, 1); assert.equal(f.cart.getState().items[0].productId, 'tutorial-demo:snack'); assert.equal(f.cart.getState().items[0].quantity, 3);
  assert.equal(f.store.getState().quantities.snack, 3); assert.equal(f.calls.realCart, 0);
});
test('Guardar el producto cierra el recorrido y celebra inmediatamente aunque la sincronización esté pendiente', async () => {
  for (const save of [state => state.savedProduct('my-product'), state => state.finishWithExisting('existing-product')]) {
    const f = practiceFixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
    f.cart.getState().addItem(f.catalog[0], 2); save(f.store.getState());
    assert.equal(f.store.getState().stage, 'pending'); assert.equal(f.store.getState().active, false); assert.equal(f.store.getState().celebrating, true);
    assert.equal(f.cart.getState().items.length, 0); assert.equal(f.model.practiceTotals(f.store.getState().quantities).count, 0);
    assert.equal(f.calls.post, 0); assert.equal(f.calls.query, 0);
    f.store.getState().applyRemote({ completedAt: '2026-11-07T12:00:00Z', mobileAutoStartEligible: true, completionProductId: 'my-product' });
    assert.equal(f.store.getState().celebrating, true);
    f.store.getState().dismissCelebration();
    f.store.getState().applyRemote({ completedAt: '2026-11-07T12:00:00Z', mobileAutoStartEligible: true, completionProductId: 'my-product' });
    assert.equal(f.store.getState().celebrating, false, 'Una sincronización posterior no debe repetir la felicitación');
  }
});

test('Precio y costo se validan en los centavos realmente enviados', () => {
  const f = fixture();
  for (const field of ['price', 'cost']) {
    for (const value of ['', ' ', '0', '-1', 'Infinity', 'NaN', '0.001', '1abc', '999999999999']) {
      assert.equal(f.model.isProductFieldValid(field, { ...f.model.EMPTY_PRODUCT_DRAFT, [field]: value }), false, `${field}: ${value}`);
    }
    assert.equal(f.model.isProductFieldValid(field, { ...f.model.EMPTY_PRODUCT_DRAFT, [field]: '0.01' }), true);
  }
});

test('Un producto eliminado se sustituye automáticamente sin conservar el localId anterior', async () => {
  const f = fixture(); await startRuntime(f); f.setLocal(null);
  f.setRemote({ completedAt: null, mobileAutoStartEligible: true, completionProductId: 'replacement' });
  f.setPost(async (_headers, id) => { f.calls.post++; assert.equal(id, 'replacement'); return '2026-11-07T12:00:00Z'; });
  f.store.getState().savedProduct('deleted'); f.runRuntime(); await flush();
  assert.equal(f.store.getState().stage, 'completed'); assert.equal(f.store.getState().productLocalId, null); assert.equal(f.calls.post, 1);
});

test('Un 422 refresca el estado y prueba otro candidato una sola vez', async () => {
  const f = fixture(); await startRuntime(f);
  f.setRemote({ completedAt: null, mobileAutoStartEligible: false, completionProductId: 'replacement' });
  const ids = [];
  f.setPost(async (_headers, id) => { ids.push(id); if (id === 'inactive') throw { response: { status: 422 } }; return '2026-11-07T12:00:00Z'; });
  f.store.getState().finishWithExisting('inactive'); f.runRuntime(); await flush();
  assert.deepEqual(ids, ['inactive', 'replacement']); assert.equal(f.store.getState().stage, 'completed');
});

test('Un 422 permanente permite recuperación y no vuelve a enviar el mismo producto tras reiniciar', async () => {
  const f = fixture(); await startRuntime(f);
  f.setPost(async () => { f.calls.post++; throw { response: { status: 422 } }; });
  f.store.getState().quantity('coffee', 2); f.store.getState().finishWithExisting('inactive'); f.runRuntime(); await flush();
  f.intervals.forEach(fn => fn()); await flush(); assert.equal(f.calls.post, 1);
  assert.equal(f.store.getState().canRestartProduct, true); assert.doesNotMatch(f.store.getState().error, /conectar/);
  const key = f.store.getState().sessionKey; await flush(); await f.store.getState().hydrate(key); f.runRuntime(); await flush();
  f.intervals.forEach(fn => fn()); await flush(); assert.equal(f.calls.post, 1);
  f.store.getState().restartProduct(); assert.equal(f.store.getState().stage, 'product'); assert.equal(f.store.getState().active, true);
  assert.equal(f.model.practiceTotals(f.store.getState().quantities).count, 0, 'La recuperación no debe revivir los productos demo retirados');
});

test('Una fila ausente con create pendiente no permite crear otro producto', async () => {
  const f = fixture(); await startRuntime(f); f.setLocal(null); f.setPending({ id: 1 });
  f.store.getState().savedProduct('missing'); f.runRuntime(); await flush();
  assert.equal(f.store.getState().canRestartProduct, false); f.store.getState().restartProduct();
  assert.equal(f.store.getState().stage, 'pending'); assert.equal(f.calls.post, 0);
});

test('Un costo cero ya guardado se corrige en el mismo producto y espera su servidor', async () => {
  const f = fixture(); await startRuntime(f); f.setLocal({ server_id: null, synced: 0, cost_cents: 0 }); f.setPending({ id: 1 });
  f.store.getState().savedProduct('zero'); f.runRuntime(); await flush();
  assert.equal(f.store.getState().completionIssue, 'needs_correction'); assert.equal(f.store.getState().canRestartProduct, false); assert.equal(f.calls.post, 0);
  f.setLocal({ server_id: null, synced: 0, cost_cents: 100 }); f.changes.forEach(fn => fn()); await flush();
  assert.equal(f.store.getState().completionIssue, null); assert.equal(f.calls.post, 0);
  f.setLocal({ server_id: 'fixed', synced: 1, cost_cents: 100 }); f.changes.forEach(fn => fn()); await flush();
  assert.equal(f.store.getState().stage, 'completed'); assert.equal(f.store.getState().productLocalId, 'zero'); assert.equal(f.calls.post, 1);
});

test('El mismo producto con cambios locales inválidos no cuenta como candidato alternativo', async () => {
  const f = fixture(); await startRuntime(f);
  f.setRemote({ completedAt: null, mobileAutoStartEligible: true, completionProductId: 'same-server' });
  f.setLocal({ server_id: 'same-server', synced: 0, cost_cents: 0 }); f.setPending({ id: 1 });
  f.store.getState().savedProduct('same-local'); f.runRuntime(); await flush();
  assert.equal(f.calls.post, 0); assert.equal(f.store.getState().completionIssue, 'needs_correction');
  f.setLocal({ server_id: 'same-server', synced: 1, cost_cents: 100 }); f.changes.forEach(fn => fn()); await flush();
  assert.equal(f.calls.post, 1); assert.equal(f.store.getState().stage, 'completed');
});

test('Una finalización remota después de rechazar el producto retira la guía', async () => {
  const f = fixture(); await startRuntime(f);
  f.setPost(async () => { f.calls.post++; f.setRemote({ completedAt: '2026-11-07T12:00:00Z', mobileAutoStartEligible: true, completionProductId: null }); throw { response: { status: 422 } }; });
  f.store.getState().open(); f.store.getState().finishWithExisting('inactive'); f.runRuntime(); await flush();
  assert.equal(f.store.getState().stage, 'completed'); assert.equal(f.store.getState().active, false); assert.equal(f.calls.post, 1);
});

test('Los errores de sesión y permisos no se presentan como falta de conexión ni se repiten con el mismo token', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); await startRuntime(f); f.setPost(async () => { f.calls.post++; throw { response: { status } }; });
    f.store.getState().finishWithExisting('real'); f.runRuntime(); await flush();
    assert.match(f.store.getState().error, status === 401 ? /sesión/ : /permiso/);
    f.intervals.forEach(fn => fn()); await flush(); assert.equal(f.calls.post, 1);
  }
});

test('El registro real de Vender funciona desde Inicio y su handler abre solo la práctica', async () => {
  const f = fixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('sell');
  f.store.setState({ routeName: 'DashboardMain' });
  let targetFocused = false, cleanup;
  const targetExports = {};
  const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/components/onboarding/OnboardingTarget.tsx'), 'utf8')), {
    exports: targetExports, Map, Promise, require: name => {
      if (name === 'react') return { useRef: () => ({ current: { measureInWindow: callback => callback(100, 600, 66, 66) } }), useEffect: callback => { cleanup?.(); cleanup = callback(); } };
      if (name === '@react-navigation/native') return { useIsFocused: () => targetFocused };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react-native') return { View: 'View' };
      throw Error(name);
    },
  });
  const file = ts.createSourceFile('MainNavigator.tsx', fs.readFileSync(path.join(root, 'src/navigation/MainNavigator.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bottomTabs = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'BottomTabs');
  const exports = {}, nav = [];
  vm.runInNewContext(compile(bottomTabs.getText(file) + '\nexports.render = BottomTabs;'), {
    exports, useIsFocused: () => true, useOnboardingStore: f.store, useAuthStore: () => ({ subUser: { isOwner: true } }),
    useSafeAreaInsets: () => ({ bottom: 0 }), canAccessModule: () => true, getInitialHomeTab: () => 'Dashboard', getFocusedRouteNameFromRoute: () => 'POSMain',
    Tab: { Navigator: 'Tabs', Screen: 'TabScreen' }, DashboardStack: 'Dashboard', SalesStack: 'Sales', ARStack: 'AR', View: 'View', Icon: 'Icon',
    OnboardingTarget: targetExports.OnboardingTarget, navigationRef: { navigate: route => nav.push(route) }, ui: { colors: { primary: '#80f', textMuted: '#888' } },
    require: () => ({ jsx, jsxs: jsx }),
  });
  const sell = nodes(exports.render()).find(node => node.type === 'TabScreen' && node.props.name === 'POS');
  const icon = sell.props.options({ route: {} }).tabBarIcon({ focused: false });
  icon.type(icon.props);
  assert.ok(targetExports.onboardingAnchor('nav.sell'));
  assert.equal((await targetExports.onboardingAnchor('nav.sell').measure()).width, 66);
  let prevented = false; sell.props.listeners.tabPress({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(nav, ['TutorialPractice']); assert.equal(f.store.getState().stage, 'catalog');
  targetExports.OnboardingTarget({ ...icon.props, visible: false }); assert.equal(targetExports.onboardingAnchor('nav.sell'), undefined);
  targetExports.OnboardingTarget({ id: 'product.name' }); assert.equal(targetExports.onboardingAnchor('product.name'), undefined);
  targetFocused = true; targetExports.OnboardingTarget({ id: 'product.name' }); assert.ok(targetExports.onboardingAnchor('product.name'));
  cleanup?.(); assert.equal(targetExports.onboardingAnchor('product.name'), undefined);
});

test('Salir de la práctica retira el stack raíz y omite estados sin una ruta de práctica que cerrar', () => {
  const exports = {}, dispatched = [], pops = [];
  let ready = true, reads = 0;
  let state = { key: 'root-stack', index: 1, routes: [
    { name: 'Main' },
    { name: 'TutorialPractice', state: { key: 'nested-practice', index: 2, routes: [{ name: 'POSMain' }, { name: 'Cart' }, { name: 'PracticeDone' }] } },
  ] };
  const navigation = {
    isReady: () => ready,
    getRootState: () => { reads++; return state; },
    dispatch: action => dispatched.push(action),
    goBack: () => assert.fail('Salir de la práctica no debe retroceder en el stack anidado'),
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/navigation/navigationRef.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert.equal(name, '@react-navigation/native');
    return { createNavigationContainerRef: () => navigation, StackActions: { pop: count => { pops.push(count); return { type: 'POP', payload: { count } }; } } };
  } });
  exports.leaveTutorialPractice();
  assert.deepEqual(pops, [1]); assert.equal(dispatched.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0])), { type: 'POP', payload: { count: 1 }, target: 'root-stack' });
  state = { key: 'root-stack', index: 1, routes: [{ name: 'TutorialPractice' }, { name: 'Main' }] };
  exports.leaveTutorialPractice(); assert.equal(dispatched.length, 1, 'Main visible no debe cerrarse');
  state = { key: 'root-stack', index: 0, routes: [{ name: 'TutorialPractice' }] };
  exports.leaveTutorialPractice(); assert.equal(dispatched.length, 1, 'La única ruta raíz debe conservarse');
  ready = false; const readsBefore = reads;
  exports.leaveTutorialPractice(); assert.equal(reads, readsBefore); assert.equal(dispatched.length, 1); assert.deepEqual(pops, [1]);
});
