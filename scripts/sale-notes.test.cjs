const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in mocks)) throw new Error(`Dependencia no prevista: ${name}`);
    return mocks[name];
  }, console, Date, Math, Number, String, Boolean, Array, Object, Promise });
  return exports;
}

const { normalizeSaleNotes } = load('src/utils/saleNotes.ts');
test('normalización respeta el contrato web y no trunca', () => {
  assert.equal(normalizeSaleNotes(null), null);
  assert.equal(normalizeSaleNotes(' \n '), null);
  assert.equal(normalizeSaleNotes('  línea 1\nlínea <2>  '), 'línea 1\nlínea <2>');
  assert.equal(normalizeSaleNotes('x'.repeat(1000)).length, 1000);
  assert.throws(() => normalizeSaleNotes('x'.repeat(1001)), /1000/);
  assert.throws(() => normalizeSaleNotes(1), /texto/);
});

test('la nota guardada offline llega en el create y no se envía en el update', async () => {
  const { prepareSyncRequestData } = load('src/services/sync/prepareSyncRequestData.ts', {
    axios: {},
    '../../database/Database': { db: { queryFirst: async () => ({ server_id: 'producto-remoto', data: '{}' }) } },
    './syncShared': {},
    '../../utils/productUnits': {},
    '../../utils/tax': { normalizeDiscountPercentBp: x => x },
    '../../utils/legalTip': { normalizeApplyLegalTip: () => false },
  });
  const local = JSON.parse(JSON.stringify({ notes: 'primera\nsegunda <línea>', items: [{ productId: 'local', quantity: 1, priceCents: 100 }] }));
  const create = await prepareSyncRequestData('sale', local, 'create');
  assert.equal(create.notes, local.notes);
  assert.equal((await prepareSyncRequestData('sale', { ...local, notes: null }, 'create')).notes, null);
  assert.equal(Object.hasOwn(await prepareSyncRequestData('sale', local, 'update'), 'notes'), false);
});

test('ticket térmico conserva saltos de línea y omite notas vacías', () => {
  const { buildSaleTicketText } = load('src/services/printing/thermalPrinterService.ts', {
    '@react-native-async-storage/async-storage': { default: {} },
    'expo-file-system/legacy': {},
    '../../utils/helpers': { formatCurrency: n => String(n), formatDateTime: () => 'fecha' },
    '../../utils/paymentMethods': { formatPaymentWithBank: () => 'Efectivo' },
    '../../utils/productUnits': { formatProductQty: n => String(n) },
    './blePrinterService': {},
  });
  const sale = { invoiceCode: 'F1', createdAt: 1, totalCents: 100, items: [], notes: 'línea 1\nlínea 2' };
  assert.match(buildSaleTicketText(sale), /Nota\nlínea 1\nlínea 2/);
  assert.doesNotMatch(buildSaleTicketText({ ...sale, notes: '  ' }), /\nNota\n/);
});
