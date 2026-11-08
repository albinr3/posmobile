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
  const calls = { get: 0, post: 0, query: 0, navigation: [] };
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
        if (name.endsWith('/SyncService')) return { syncService: { incrementalSync: async () => {} } };
        if (name === '@clerk/clerk-expo') return { useAuth: () => ({ getToken: async () => 'clerk-token' }) };
        if (name.endsWith('/Database')) return { db: { queryFirst: async sql => { calls.query++; return sql.includes('sync_queue') ? pendingOperation : localProduct; }, subscribeChanges: callback => { changes.add(callback); return () => changes.delete(callback); } } };
        if (name === './onboardingApi') return { onboardingHeaders: () => ({ accountId: auth.accountId }), fetchSharedOnboarding: (...args) => fetchRemote(...args), completeSharedOnboarding: (...args) => post(...args) };
        if (name.endsWith('/SafeAreaView')) return { SafeAreaView: 'SafeAreaView' };
        if (name.endsWith('/OnboardingTarget')) return { OnboardingTarget: 'OnboardingTarget' };
        if (name.endsWith('/useTutorialScroll')) return { useTutorialScroll: () => ({}) };
        if (name.endsWith('/SalesPresentation')) return { SalePrice: 'SalePrice', SaleSummaryRow: 'SaleSummaryRow' };
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
  const runRuntime = () => { cursor = 0; load('src/services/onboarding/useOnboardingRuntime.ts').useOnboardingRuntime(); while (effects.length) effects.shift()(); };
  return { model, store, calls, auth, sync, storage, load, runRuntime, intervals, changes, appListeners,
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
test('Los handlers de práctica agregan, revisan y cobran sin cargar infraestructura financiera', async () => {
  const f = fixture(); await f.store.getState().hydrate('A'); f.store.getState().open(); f.store.getState().go('catalog');
  const navigation = { addListener: () => () => {}, navigate: (...args) => f.calls.navigation.push(args), replace: (...args) => f.calls.navigation.push(args) };
  const stack = f.load('src/screens/onboarding/PracticeNavigator.tsx').PracticeNavigator({ navigation });
  const screens = Object.fromEntries(nodes(stack).filter(n => n.type === 'Screen').map(n => [n.props.name, n.props.component]));
  let catalog = nodes(screens.PracticeCatalog({ navigation }));
  const coffee = catalog.find(n => n.props?.accessibilityLabel === 'Agregar Café Americano');
  coffee.props.onPress(); coffee.props.onPress();
  assert.equal(f.store.getState().quantities.coffee, 2);
  catalog = nodes(screens.PracticeCatalog({ navigation }));
  const checkout = catalog.find(n => n.type === 'OnboardingTarget' && n.props.id === 'practice.checkout').props.children;
  checkout.props.onPress(); assert.equal(f.store.getState().stage, 'cart');
  const cart = nodes(screens.PracticeCart({ navigation }));
  const finish = cart.find(n => n.type === 'OnboardingTarget' && n.props.id === 'practice.complete').props.children;
  finish.props.onPress(); finish.props.onPress();
  assert.equal(f.store.getState().stage, 'practiceDone');
  assert.equal(f.calls.navigation.filter(([route]) => route === 'PracticeDone').length, 1);
  assert.equal(f.calls.query, 0); assert.equal(f.calls.get, 0); assert.equal(f.calls.post, 0);
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
  f.store.getState().restartProduct(); assert.equal(f.store.getState().stage, 'practiceDone'); assert.equal(f.store.getState().quantities.coffee, 2);
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
