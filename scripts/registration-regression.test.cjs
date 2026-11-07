// Ejecuta los handlers reales con Clerk, SecureStore y la red simulados; no crea cuentas externas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(screenName, options = {}) {
  const cells = [...(options.cells || [])]; let cursor = 0;
  const state = { signedIn: false, ...options };
  const events = [];
  const navigation = Object.fromEntries(['navigate', 'replace', 'reset'].map(name => [name, (...args) => events.push([name, ...args])]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], next => { cells[index] = typeof next === 'function' ? next(cells[index]) : next; }];
    },
    useRef(value) { const index = cursor++; if (!(index in cells)) cells[index] = { current: value }; return cells[index]; },
    useEffect() {},
  };
  const clerk = {
    useSignUp: () => ({ isLoaded: true, signUp: state.signUp, setActive: state.setActive }),
    useSignIn: () => ({ isLoaded: true, signIn: state.signIn, setActive: state.setActive }),
    useOAuth: () => ({ startOAuthFlow: state.oauth }),
    useAuth: () => ({ isLoaded: state.loaded !== false, isSignedIn: state.signedIn, getToken: async () => 'clerk', signOut: async () => {} }),
  };
  const file = path.join(__dirname, screenName === 'AppNavigator' ? '../src/navigation/AppNavigator.tsx' : '../src/screens/auth/' + screenName + '.tsx');
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, console: { error() {} }, process: { env: {} }, require: name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { StyleSheet: { create: x => x }, Platform: { OS: 'android' }, View: 'View', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', TextInput: 'RNTextInput', ActivityIndicator: 'ActivityIndicator' };
    if (name === 'react-native-paper') return { Button: 'Button', Text: 'Text', TextInput: 'TextInput', Surface: 'Surface' };
    if (name === '@clerk/clerk-expo') return clerk;
    if (name === 'expo-auth-session') return { makeRedirectUri: () => 'movopos://oauth-native-callback' };
    if (name.endsWith('/SafeAreaView')) return { SafeAreaView: 'SafeAreaView' };
    if (name.endsWith('/ui')) return { ui: { colors: {}, radius: {} } };
    if (name.endsWith('/authStore')) { const hook = () => state.store; hook.getState = () => state.store; return { useAuthStore: hook }; }
    if (name.endsWith('/SyncService')) return { syncService: { setTokenGetter() {}, setSubUserTokenGetter() {}, fullSync: (...args) => state.sync(...args) } };
    if (name === 'axios') return { post: (...args) => state.post(...args) };
    if (name === '@react-native-async-storage/async-storage') return {};
    if (name === '@react-navigation/native') return { NavigationContainer: 'NavigationContainer', createNavigationContainerRef: () => ({ isReady: () => false }) };
    if (name === '@react-navigation/stack') return { createStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }) };
    if (name === './AuthNavigator') return { AuthNavigator: 'AuthNavigator' };
    if (name === './MainNavigator') return { MainNavigator: 'MainNavigator' };
    if (name.endsWith('/WelcomeScreen')) return { WELCOME_SEEN_STORAGE_KEY: 'welcome' };
    if (name.endsWith('/errorReporter')) return { setErrorRouteGetter() {} };
    throw new Error('Dependencia inesperada: ' + name);
  } }, { filename: file });
  function render() {
    cursor = 0;
    const tree = exports[screenName]({ navigation, route: state.route });
    const nodes = [];
    function walk(node) { if (typeof node === 'function') return walk(node()); if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); nodes.push(node); walk(node.props?.children); }
    walk(tree);
    return {
      input: label => nodes.find(n => n.type === 'TextInput' && n.props.label === label)?.props,
      button: label => nodes.find(n => n.type === 'Button' && n.props.children === label)?.props,
      digits: nodes.filter(n => n.type === 'RNTextInput').map(n => n.props),
      text: nodes.filter(n => n.type === 'Text').map(n => n.props.children).join(' '),
      authRoute: nodes.find(n => n.type === 'AuthNavigator')?.props.initialRouteName,
      loading: nodes.some(n => n.type === 'ActivityIndicator'),
      main: nodes.some(n => n.type === 'Screen' && n.props.name === 'Main'),
    };
  }
  return { state, events, render };
}

test('Un fallo al enviar el código permite reenviar sin recrear el registro ni conservar contraseñas', async () => {
  let creates = 0, deliveries = 0;
  const signUp = {
    async create({ emailAddress }) { creates++; Object.assign(this, { id: 'signup', emailAddress, hasPassword: true, status: 'missing_requirements', unverifiedFields: ['email_address'] }); return this; },
    async prepareEmailAddressVerification() { if (++deliveries === 1) throw new Error('Sin conexión'); },
  };
  const f = fixture('SignUpScreen', { signUp });
  f.render().input('Correo').onChangeText('ana@example.test');
  f.render().input('Contraseña').onChangeText('secreto-seguro');
  f.render().input('Confirmar contraseña').onChangeText('secreto-seguro');
  await f.render().button('Crear cuenta').onPress();
  assert.equal(f.events[0][1], 'EmailVerification');
  assert.equal(f.events[0][2].codeSent, false);
  assert.equal(f.render().input('Contraseña').value, '');
  assert.equal(f.render().input('Confirmar contraseña').value, '');
  await f.render().button('Continuar registro').onPress();
  assert.equal(creates, 1); assert.equal(deliveries, 2);
  assert.equal(f.events[1][2].codeSent, true);
});

test('Una contraseña rechazada o correo existente muestra el error y permite corregir el formulario', async () => {
  for (const reason of ['Contraseña rechazada', 'Este correo ya existe']) {
    const f = fixture('SignUpScreen', { signUp: { create: async () => { throw { errors: [{ longMessage: reason }] }; } } });
    f.render().input('Correo').onChangeText('ana@example.test');
    f.render().input('Contraseña').onChangeText('test');
    f.render().input('Confirmar contraseña').onChangeText('test');
    await f.render().button('Crear cuenta').onPress();
    assert.match(f.render().text, new RegExp(reason)); assert.equal(f.events.length, 0);
    assert.equal(f.render().button('Crear cuenta').disabled, false);
  }
});

test('Reintentar el guardado local tras el commit no repite la creación del negocio', async () => {
  let posts = 0, saves = 0, syncs = 0, activations = 0;
  const f = fixture('SetupBusinessScreen', {
    post: async () => { posts++; return { data: { success: true, user: { id: 'admin' }, token: 'subtoken', account: { id: 'account' } } }; },
    store: { setSubUser: async () => { if (++saves === 1) throw new Error('SecureStore no disponible'); }, activateSubUser: () => activations++ },
    sync: async () => { syncs++; },
  });
  f.render().input('Nombre del negocio').onChangeText('Tienda');
  f.render().input('WhatsApp').onChangeText('8095550123');
  const handler = f.render().button('Guardar y continuar').onPress;
  await Promise.all([handler(), handler()]);
  assert.equal(posts, 1); assert.equal(saves, 1); assert.equal(syncs, 0);
  assert.equal(f.render().button('Entrar y sincronizar después'), undefined);
  await f.render().button('Reintentar').onPress();
  assert.equal(posts, 1); assert.equal(saves, 2); assert.equal(syncs, 1); assert.equal(activations, 1);
});

test('Reintentar sincronización conserva el registro y la sesión ya guardados', async () => {
  let posts = 0, saves = 0, syncs = 0, activations = 0;
  const f = fixture('SetupBusinessScreen', {
    post: async () => { posts++; return { data: { success: true, user: { id: 'admin' }, token: 'subtoken', account: { id: 'account' } } }; },
    store: { setSubUser: async () => { saves++; }, activateSubUser: () => activations++ },
    sync: async () => { if (++syncs === 1) throw new Error('Sin conexión'); },
  });
  f.render().input('Nombre del negocio').onChangeText('Tienda');
  f.render().input('WhatsApp').onChangeText('8095550123');
  await f.render().button('Guardar y continuar').onPress();
  assert.equal(activations, 0); assert.ok(f.render().button('Entrar y sincronizar después'));
  await f.render().button('Reintentar').onPress();
  assert.equal(posts, 1); assert.equal(saves, 1); assert.equal(syncs, 2); assert.equal(activations, 1);
});

test('Google cancelado no activa sesión y una cuenta existente continúa con la sesión recibida', async () => {
  let activations = 0;
  const f = fixture('SignUpScreen', { oauth: async () => ({ authSessionResult: { type: 'cancel' } }) });
  await f.render().button('Continuar con Google').onPress();
  assert.equal(f.events.length, 0);
  f.state.oauth = async () => ({ createdSessionId: 'google-existing', setActive: async ({ session }) => { assert.equal(session, 'google-existing'); activations++; } });
  await f.render().button('Continuar con Google').onPress();
  assert.equal(activations, 1); assert.equal(f.events[0][0], 'reset');
});

test('Un 409 vuelve a perfiles y exige su acceso habitual', async () => {
  const f = fixture('SetupBusinessScreen', { post: async () => { throw { response: { status: 409 } }; } });
  f.render().input('Nombre del negocio').onChangeText('Tienda');
  f.render().input('WhatsApp').onChangeText('8095550123');
  await f.render().button('Guardar y continuar').onPress();
  assert.equal(f.events[0][0], 'replace'); assert.equal(f.events[0][1], 'SelectUser');
});

test('Un código verificado reintenta setActive sin consumirlo dos veces y bloquea envíos concurrentes', async () => {
  let verifies = 0, activates = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const signUp = { status: 'missing_requirements', async attemptEmailAddressVerification() {
    verifies++; await pending; Object.assign(this, { status: 'complete', createdSessionId: 'verified-session' }); return this;
  } };
  const f = fixture('EmailVerificationScreen', { signUp, route: { params: { mode: 'signup', email: 'ana@example.test' } },
    setActive: async () => { if (++activates === 1) throw new Error('Sin conexión'); },
  });
  for (let i = 0; i < 6; i++) f.render().digits[i].onChangeText('1');
  await f.render().button('Verificar').onPress();
  assert.equal(verifies, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.length, 0);
  await f.render().button('Verificar').onPress();
  assert.equal(verifies, 1); assert.equal(activates, 2); assert.equal(f.events[0][0], 'reset');
});

test('Código incorrecto y fallo de reenvío muestran errores recuperables; reenviar limpia el código', async () => {
  let sends = 0;
  const f = fixture('EmailVerificationScreen', { route: { params: { mode: 'signup', codeSent: false } },
    signUp: { status: 'missing_requirements', attemptEmailAddressVerification: async () => { throw new Error('Código incorrecto'); },
      prepareEmailAddressVerification: async () => { if (++sends === 1) throw new Error('Sin conexión'); } },
  });
  for (let i = 0; i < 6; i++) f.render().digits[i].onChangeText('1');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.render().text, /Código incorrecto/); assert.equal(f.events.length, 0);
  await f.render().button('Reenviar código').onPress();
  assert.match(f.render().text, /Sin conexión/); assert.ok(f.render().button('Reenviar código'));
  await f.render().button('Reenviar código').onPress();
  assert.ok(f.render().digits.every(input => input.value === ''));
  assert.equal(f.render().button('Reenviar código'), undefined); assert.equal(sends, 2);
});

test('Una verificación incompleta nunca avanza a biometría', async () => {
  const f = fixture('EmailVerificationScreen', { route: { params: { mode: 'signin' } },
    signIn: { attemptFirstFactor: async () => ({ status: 'needs_second_factor' }) },
  });
  for (let i = 0; i < 6; i++) f.render().digits[i].onChangeText('1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.length, 0); assert.match(f.render().text, /Faltan pasos/);
});

test('Al reiniciar se espera a Clerk y se retoma la configuración aunque la bienvenida no figure como vista', () => {
  const f = fixture('AppNavigator', { loaded: false, signedIn: false, cells: [true, true], store: { isAuthenticated: false, isLoading: false } });
  assert.equal(f.render().loading, true); assert.equal(f.render().authRoute, undefined);
  f.state.loaded = true; f.state.signedIn = true;
  assert.equal(f.render().authRoute, 'SelectUser');
  f.state.signedIn = false;
  assert.equal(f.render().authRoute, 'Welcome');
  f.state.loaded = false; f.state.store.isAuthenticated = true;
  assert.equal(f.render().main, true); assert.equal(f.render().loading, false);
});
