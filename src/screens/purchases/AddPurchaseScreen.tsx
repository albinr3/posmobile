import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Menu, Icon, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { db, type DatabaseTransaction } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { cashContextForQueue } from '../../services/cash/cashShiftService';
import { formatCurrency, generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { getSalesSettings } from '../../services/settings/salesSettings';
import { listTreasuryAccounts } from '../../services/treasury/treasuryService';
import { TreasuryAccount } from '../../types';
import { filterTreasuryAccountsByMethod, findTreasuryAccountById } from '../../utils/treasury';
import { useTreasuryUIStore } from '../../store/treasuryUIStore';
import { purchaseCreditService, paymentAccounts, parseAmountCents, proposeDueDate, validDateOnly, type PaymentOptions } from '../../services/purchases/purchaseCreditService';
import { PendingFinancialOperations } from '../../components/PendingFinancialOperations';

interface AddPurchaseScreenProps {
  navigation: any;
  route: any;
}

interface SupplierOption {
  id: string;
  serverId: string | null;
  name: string;
  discountPercentBp: number;
  chargesItbis: boolean;
  itbisRateBp: number | null;
  creditDays: number;
  isActive: boolean;
}

interface ProductOption {
  id: string;
  serverId: string | null;
  name: string;
  sku: string | null;
  reference: string | null;
  costCents: number;
  priceCents: number;
  itbisRateBp: number;
  isActive: boolean;
  synced: boolean;
}

interface PurchaseStoredItem {
  id?: string | null;
  productId: string;
  productServerId?: string | null;
  productName?: string;
  productReference?: string | null;
  qty: number;
  unitCostCents: number;
  discountPercentBp?: number;
  netCostCents?: number;
  salePriceCents?: number;
  saleMarginBp?: number;
  purchaseIncludesItbis?: boolean;
  appliedItbisRateBp?: number;
  lineTotalCents?: number;
}

interface CatalogSnapshot {
  suppliers: SupplierOption[];
  products: ProductOption[];
}

interface PurchaseFormItem {
  key: string;
  productId: string | null;
  productName: string;
  productReference: string | null;
  qty: string;
  unitCost: string;
  discountPercent: string;
  saleMarginPercent: string;
  salePrice: string;
}

const DEFAULT_PURCHASE_ITBIS_RATE_BP = 1800;
const DEFAULT_SALE_MARGIN_PERCENT = '30';

function createEmptyItem(defaultSaleMarginPercent = DEFAULT_SALE_MARGIN_PERCENT): PurchaseFormItem {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    productId: null,
    productName: '',
    productReference: null,
    qty: '1',
    unitCost: '',
    discountPercent: '',
    saleMarginPercent: defaultSaleMarginPercent,
    salePrice: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function normalizeStoredItems(raw: unknown): PurchaseStoredItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const productId = asString(entry.productId);
      if (!productId) return null;
      return {
        id: asString(entry.id),
        productId,
        productServerId: asString(entry.productServerId),
        productName: asString(entry.productName) || undefined,
        productReference: asString(entry.productReference) || undefined,
        qty: asNumber(entry.qty) ?? 0,
        unitCostCents: asNumber(entry.unitCostCents) ?? 0,
        discountPercentBp: asNumber(entry.discountPercentBp) ?? undefined,
        netCostCents: asNumber(entry.netCostCents) ?? undefined,
        salePriceCents: asNumber(entry.salePriceCents) ?? undefined,
        saleMarginBp: asNumber(entry.saleMarginBp) ?? undefined,
        purchaseIncludesItbis:
          typeof entry.purchaseIncludesItbis === 'boolean' ? entry.purchaseIncludesItbis : undefined,
        appliedItbisRateBp: asNumber(entry.appliedItbisRateBp) ?? undefined,
        lineTotalCents: asNumber(entry.lineTotalCents) ?? undefined,
      } as PurchaseStoredItem;
    })
    .filter((item): item is PurchaseStoredItem => item !== null);
}

function purchaseEditFingerprint(value: any): string {
  return JSON.stringify({
    supplierId: value?.supplierId || null, notes: value?.notes || null, dueDate: value?.dueDate || null,
    totalCents: Number(value?.totalCents || 0), paidCents: Number(value?.paidCents || 0),
    items: normalizeStoredItems(value?.items).map(item => ({ id: item.id, productId: item.productId,
      qty: item.qty, unitCostCents: item.unitCostCents, discountPercentBp: item.discountPercentBp,
      salePriceCents: item.salePriceCents, saleMarginBp: item.saleMarginBp })).sort((a, b) => String(a.id || a.productId).localeCompare(String(b.id || b.productId))),
  });
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeDiscountBp = (discountBp: number | null | undefined) => {
  const raw = Number.isFinite(Number(discountBp)) ? Number(discountBp) : 0;
  return clamp(Math.round(raw), 0, 10000);
};
const normalizeItbisRateBp = (rateBp: number | null | undefined) => {
  const raw = Number.isFinite(Number(rateBp)) ? Number(rateBp) : DEFAULT_PURCHASE_ITBIS_RATE_BP;
  return clamp(Math.round(raw), 0, 100000);
};
const normalizeMarginBp = (marginBp: number | null | undefined) => {
  const raw = Number.isFinite(Number(marginBp)) ? Number(marginBp) : 3000;
  return clamp(Math.round(raw), 0, 50000);
};

function resolvePurchaseSalePricingMobile(input: {
  unitCostCents: number;
  discountPercentBp?: number | null;
  purchaseIncludesItbis: boolean;
  purchaseItbisRateBp?: number | null;
  productItbisRateBp?: number | null;
  salePricesIncludeItbis?: boolean;
  defaultSaleMarginBp?: number | null;
  saleMarginBp?: number | null;
  salePriceCents?: number | null;
}) {
  const unitCostCents = Math.max(0, Math.round(Number(input.unitCostCents || 0)));
  const discountPercentBp = normalizeDiscountBp(input.discountPercentBp);
  const purchaseItbisRateBp = normalizeItbisRateBp(input.purchaseItbisRateBp);
  const purchaseIncludesItbis = Boolean(input.purchaseIncludesItbis);
  const discountedCostCents = Math.round(unitCostCents * (1 - discountPercentBp / 10000));

  const netCostCents =
    !purchaseIncludesItbis || purchaseItbisRateBp === 0
      ? discountedCostCents
      : Math.round(discountedCostCents * (1 + purchaseItbisRateBp / 10000));
  const purchaseNoItbisCents =
    !purchaseIncludesItbis || purchaseItbisRateBp === 0
      ? discountedCostCents
      : Math.round(netCostCents / (1 + purchaseItbisRateBp / 10000));

  const saleItbisRateBp = normalizeItbisRateBp(input.productItbisRateBp);
  const appliedItbisRateBp = saleItbisRateBp > 0 ? saleItbisRateBp : 0;
  const salePricesIncludeItbis = input.salePricesIncludeItbis !== false;

  if (input.salePriceCents !== null && input.salePriceCents !== undefined && Number.isFinite(Number(input.salePriceCents))) {
    const salePriceCents = Math.max(0, Math.round(Number(input.salePriceCents)));
    const saleNoItbisCents =
      salePricesIncludeItbis && appliedItbisRateBp > 0
        ? Math.round(salePriceCents / (1 + appliedItbisRateBp / 10000))
        : salePriceCents;
    const rawMarginBp = purchaseNoItbisCents > 0 ? ((saleNoItbisCents / purchaseNoItbisCents) - 1) * 10000 : 0;
    return {
      netCostCents,
      salePriceCents,
      saleMarginBp: normalizeMarginBp(rawMarginBp),
    };
  }

  const saleMarginBp = normalizeMarginBp(input.saleMarginBp ?? input.defaultSaleMarginBp ?? 3000);
  const saleNoItbisCents = Math.round(purchaseNoItbisCents * (1 + saleMarginBp / 10000));
  const salePriceCents =
    salePricesIncludeItbis && appliedItbisRateBp > 0
      ? Math.round(saleNoItbisCents * (1 + appliedItbisRateBp / 10000))
      : saleNoItbisCents;

  return {
    netCostCents,
    salePriceCents,
    saleMarginBp,
  };
}

export function AddPurchaseScreen({ navigation, route }: AddPurchaseScreenProps) {
  const purchaseId = route?.params?.purchaseId;
  const isEditMode = !!purchaseId;

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [purchaseType, setPurchaseType] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [dueDate, setDueDate] = useState('');
  const [initialPayment, setInitialPayment] = useState('0');
  const [creditPaidCents, setCreditPaidCents] = useState(0);
  const [creditBalanceCents, setCreditBalanceCents] = useState(0);
  const [creditHasActivePayments, setCreditHasActivePayments] = useState(false);
  const [creditLiveLoaded, setCreditLiveLoaded] = useState(false);
  const [creditSubmissionPending, setCreditSubmissionPending] = useState(false);
  const [creditPaymentOptions, setCreditPaymentOptions] = useState<PaymentOptions>({ methods: [], accounts: [] });
  const [creditAccountId, setCreditAccountId] = useState<string | null>(null);
  const [creditAccountMenuVisible, setCreditAccountMenuVisible] = useState(false);
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [updateProductCost, setUpdateProductCost] = useState(true);
  const [updateProductPrice, setUpdateProductPrice] = useState(true);
  const [defaultSaleMarginPercent, setDefaultSaleMarginPercent] = useState(DEFAULT_SALE_MARGIN_PERCENT);
  const [salePricesIncludeItbis, setSalePricesIncludeItbis] = useState(true);
  const [items, setItems] = useState<PurchaseFormItem[]>([createEmptyItem(DEFAULT_SALE_MARGIN_PERCENT)]);

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [supplierMenuVisible, setSupplierMenuVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO'>('EFECTIVO');
  const [paymentMethodMenuVisible, setPaymentMethodMenuVisible] = useState(false);
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([]);
  const [treasuryAccountId, setTreasuryAccountId] = useState<string | null>(null);
  const [treasuryMenuVisible, setTreasuryMenuVisible] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [persistedLocalId, setPersistedLocalId] = useState<string | null>(null);
  const [persistedServerId, setPersistedServerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const creditServerFingerprintRef = useRef<string | null>(null);
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();
  const canRegisterSupplierPayments = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canRegisterSupplierPayments === true);
  const canManagePurchases = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canManagePurchases === true);
  const { isOnline } = useSyncStore();
  const requestCreateAccountModal = useTreasuryUIStore((state) => state.requestCreateAccountModal);
  const consumeLastCreatedAccountId = useTreasuryUIStore((state) => state.consumeLastCreatedAccountId);
  const isOnlineRef = useRef(isOnline);
  const getTokenRef = useRef(getToken);
  const subUserTokenRef = useRef(subUserToken);
  const accountIdRef = useRef(accountId);
  isOnlineRef.current = isOnline;
  getTokenRef.current = getToken;
  subUserTokenRef.current = subUserToken;
  accountIdRef.current = accountId;

  useEffect(() => {
    const created = consumeLastCreatedAccountId();
    if (created) {
      setTreasuryAccountId(created);
    }
  }, [consumeLastCreatedAccountId]);

  useEffect(() => {
    if (!treasuryAccounts.length) return;
    const allowed = filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), paymentMethod);
    const selected = findTreasuryAccountById(allowed, treasuryAccountId);
    if (!selected) {
      setTreasuryAccountId(allowed[0]?.localId || null);
    }
  }, [paymentMethod, treasuryAccountId, treasuryAccounts]);

  useEffect(() => {
    const allowed = paymentAccounts(creditPaymentOptions, paymentMethod);
    if (!allowed.some(account => account.id === creditAccountId)) setCreditAccountId(allowed[0]?.id || null);
  }, [creditAccountId, creditPaymentOptions, paymentMethod]);

  const resolveLocalProductId = useCallback(
    (
      rawProductId: string | null | undefined,
      rawProductServerId?: string | null,
      sourceProducts: ProductOption[] = products
    ): string | null => {
      const direct = asString(rawProductId);
      if (direct) {
        const localMatch = sourceProducts.find((product) => product.id === direct);
        if (localMatch) return localMatch.id;
      }

      const serverCandidate = asString(rawProductServerId) || asString(rawProductId);
      if (serverCandidate) {
        const serverMatch = sourceProducts.find((product) => product.serverId === serverCandidate);
        if (serverMatch) return serverMatch.id;
      }

      return null;
    },
    [products]
  );

  const loadLocalCatalogs = useCallback(async (): Promise<CatalogSnapshot> => {
    const supplierRows = await db.query<{
      local_id: string;
      server_id: string | null;
      name: string | null;
      discount_percent_bp: number | null;
      charges_itbis: number | null;
      itbis_rate_bp: number | null;
      is_available_for_sale: number | null;
      data: string | null;
    }>(
      `SELECT local_id, server_id, name, discount_percent_bp, charges_itbis, itbis_rate_bp, is_available_for_sale, data
       FROM suppliers
       ORDER BY name COLLATE NOCASE ASC`
    );

    const nextSuppliers = supplierRows
      .map((row) => {
        const parsed = parseJsonObject(row.data);
        const name = asString(row.name) || asString(parsed?.name) || '';
        return {
          id: String(row.local_id),
          serverId: asString(row.server_id) || asString(parsed?.serverId) || asString(parsed?.id),
          name,
          discountPercentBp: Math.max(
            0,
            Math.round(asNumber(row.discount_percent_bp) ?? asNumber(parsed?.discountPercentBp) ?? 0)
          ),
          chargesItbis: asBoolean(
            asNumber(row.charges_itbis) === 1 ? true : parsed?.chargesItbis,
            false
          ),
          itbisRateBp: asNumber(row.itbis_rate_bp) ?? asNumber(parsed?.itbisRateBp) ?? null,
          creditDays: asNumber(parsed?.creditDays) ?? 0,
          isActive: row.is_available_for_sale !== 0 && parsed?.isActive !== false,
        } as SupplierOption;
      })
      .filter((supplier) => supplier.name.length > 0);

    const productRows = await db.query<{
      local_id: string;
      server_id: string | null;
      name: string | null;
      sku: string | null;
      cost_cents: number | null;
      price_cents: number | null;
      synced: number | null;
      data: string | null;
    }>(
      `SELECT local_id, server_id, name, sku, cost_cents, price_cents, synced, data
       FROM products
       ORDER BY name COLLATE NOCASE ASC`
    );

    const nextProducts = productRows
      .map((row) => {
        const parsed = parseJsonObject(row.data);
        const rawItbisRateBp = asNumber(parsed?.itbisRateBp);
        const rawTaxRate = asNumber(parsed?.taxRate);
        const normalizedItbisRateBp =
          rawItbisRateBp !== null
            ? normalizeItbisRateBp(rawItbisRateBp)
            : rawTaxRate !== null
              ? normalizeItbisRateBp(rawTaxRate <= 100 ? rawTaxRate * 100 : rawTaxRate)
              : DEFAULT_PURCHASE_ITBIS_RATE_BP;

        let isActive = true;
        if (parsed && typeof parsed.isActive === 'boolean') isActive = parsed.isActive;
        if (parsed && typeof parsed.active === 'boolean') isActive = parsed.active;

        return {
          id: String(row.local_id),
          serverId: asString(row.server_id) || asString(parsed?.serverId) || asString(parsed?.id),
          name: asString(row.name) || asString(parsed?.name) || '',
          sku: asString(row.sku) || asString(parsed?.sku),
          reference: asString(parsed?.reference),
          costCents: Math.max(0, Math.round(asNumber(row.cost_cents) ?? asNumber(parsed?.costCents) ?? 0)),
          priceCents: Math.max(0, Math.round(asNumber(row.price_cents) ?? asNumber(parsed?.priceCents) ?? 0)),
          itbisRateBp: normalizedItbisRateBp,
          isActive,
          synced: row.synced === 1,
        } as ProductOption;
      })
      .filter((product) => product.name.length > 0);

    setSuppliers(nextSuppliers);
    setProducts(nextProducts);
    try {
      const nextTreasuryAccounts = await listTreasuryAccounts(false);
      setTreasuryAccounts(nextTreasuryAccounts);
    } catch {
      setTreasuryAccounts([]);
    }

    return {
      suppliers: nextSuppliers,
      products: nextProducts,
    };
  }, []);

  const loadLocalPurchaseForEdit = useCallback(
    async (catalog: CatalogSnapshot) => {
      if (!isEditMode) return;

      const row = await db.queryFirst<{
        local_id: string;
        server_id: string | null;
        supplier_name: string | null;
        data: string | null;
      }>(
        `SELECT local_id, server_id, supplier_name, data
         FROM purchases
         WHERE local_id = ? OR server_id = ?
         LIMIT 1`,
        [purchaseId, purchaseId]
      );

      if (!row) {
        Alert.alert('Error', 'No se encontró la compra que deseas editar.');
        navigation.goBack();
        return;
      }

      const parsed = parseJsonObject(row.data);
      let parsedItems = normalizeStoredItems(parsed?.items);
      const serverId =
        asString(row.server_id) || asString(parsed?.serverId) || asString(parsed?.id);
      const supplierFromPayloadId = asString(parsed?.supplierId);
      const supplierFromPayloadServerId = asString(parsed?.supplierServerId);
      const supplierNameFromPayload = asString(parsed?.supplierName) || asString(row.supplier_name) || '';

      let matchedSupplier =
        catalog.suppliers.find((supplier) => supplier.id === supplierFromPayloadId) ||
        catalog.suppliers.find((supplier) => supplier.serverId === supplierFromPayloadServerId) ||
        catalog.suppliers.find(
          (supplier) =>
            supplierNameFromPayload &&
            supplier.name.toLowerCase() === supplierNameFromPayload.toLowerCase()
        ) ||
        null;

      setPersistedLocalId(String(row.local_id));
      setPersistedServerId(serverId);
      setSupplierId(matchedSupplier?.id || null);
      setSupplierName(matchedSupplier?.name || supplierNameFromPayload);
      setNotes(asString(parsed?.notes) || '');
      const nextType = parsed?.type === 'CREDITO' ? 'CREDITO' : 'CONTADO';
      setPurchaseType(nextType);
      setDueDate(asString(parsed?.dueDate) || '');
      setCreditPaidCents(asNumber(parsed?.paidCents) ?? 0);
      setCreditBalanceCents(asNumber(parsed?.balanceCents) ?? 0);
      setCreditHasActivePayments(false);
      setCreditLiveLoaded(false);
      creditServerFingerprintRef.current = null;
      if (nextType === 'CREDITO' && serverId && isOnlineRef.current) {
        const live = await purchaseCreditService.getPurchase(serverId);
        creditServerFingerprintRef.current = purchaseEditFingerprint(live);
        parsedItems = normalizeStoredItems(live.items).map(item => ({ ...item, productServerId: item.productId }));
        matchedSupplier = live.supplierId ? catalog.suppliers.find(supplier => supplier.serverId === String(live.supplierId)) || null : matchedSupplier;
        setSupplierId(matchedSupplier?.id || null);
        setSupplierName(String(live.supplierName || matchedSupplier?.name || supplierNameFromPayload));
        setNotes(String(live.notes || ''));
        setDueDate(String(live.dueDate || ''));
        setCreditPaidCents(Number(live.paidCents || 0));
        setCreditBalanceCents(Number(live.balanceCents || 0));
        setCreditHasActivePayments(Number(live.paidCents || 0) > 0);
        setCreditLiveLoaded(true);
      }
      const parsedPaymentMethod = String(parsed?.paymentMethod || 'EFECTIVO').toUpperCase();
      setPaymentMethod(parsedPaymentMethod === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : parsedPaymentMethod === 'TARJETA' ? 'TARJETA' : parsedPaymentMethod === 'OTRO' ? 'OTRO' : 'EFECTIVO');
      setTreasuryAccountId(asString(parsed?.treasuryAccountId));
      setUpdateProductCost(asBoolean(parsed?.updateProductCost, true));
      setUpdateProductPrice(asBoolean(parsed?.updateProductPrice, true));

      if (parsedItems.length === 0) {
        setItems([createEmptyItem(defaultSaleMarginPercent)]);
        return;
      }

      const defaultDiscountPercent =
        matchedSupplier && Number(matchedSupplier.discountPercentBp || 0) > 0
          ? String(Number(matchedSupplier.discountPercentBp) / 100)
          : '';

      const mappedItems = parsedItems.map((item, index) => {
        const resolvedProductId = resolveLocalProductId(item.productId, item.productServerId, catalog.products);
        const matchedProduct =
          catalog.products.find((product) => product.id === resolvedProductId) ||
          catalog.products.find((product) => product.serverId === item.productId) ||
          null;

        return {
          key: `${item.id || item.productId}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          productId: resolvedProductId,
          productName: item.productName || matchedProduct?.name || 'Producto',
          productReference: item.productReference || matchedProduct?.reference || null,
          qty: String(Number(item.qty || 0)),
          unitCost: String(Number(item.unitCostCents || 0) / 100),
          discountPercent:
            item.discountPercentBp !== null && item.discountPercentBp !== undefined
              ? String(Number(item.discountPercentBp) / 100)
              : defaultDiscountPercent,
          saleMarginPercent:
            item.saleMarginBp !== null && item.saleMarginBp !== undefined
              ? String(Number(item.saleMarginBp) / 100)
              : defaultSaleMarginPercent,
          salePrice:
            item.salePriceCents !== null && item.salePriceCents !== undefined && Number(item.salePriceCents) > 0
              ? String(Number(item.salePriceCents) / 100)
              : '',
        } as PurchaseFormItem;
      });

      setItems(mappedItems.length > 0 ? mappedItems : [createEmptyItem(defaultSaleMarginPercent)]);
    },
    [defaultSaleMarginPercent, isEditMode, navigation, purchaseId, resolveLocalProductId]
  );

  const syncBestEffort = useCallback(async (): Promise<boolean> => {
    if (!isOnlineRef.current) return false;

    const clerkToken = await getTokenRef.current();
    const currentSubUserToken = useAuthStore.getState().subUserToken;
    if (!clerkToken || !currentSubUserToken) return false;

    syncService.setTokenGetter(() => getTokenRef.current());
    syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
    await syncService.fullSync(clerkToken);
    return true;
  }, []);

  const loadLocalCatalogsRef = useRef(loadLocalCatalogs);
  const loadLocalPurchaseForEditRef = useRef(loadLocalPurchaseForEdit);
  loadLocalCatalogsRef.current = loadLocalCatalogs;
  loadLocalPurchaseForEditRef.current = loadLocalPurchaseForEdit;

  useFocusEffect(
    useCallback(() => {
      const focusLoadKey = `${purchaseId || 'new'}:${accountIdRef.current || ''}:${subUserTokenRef.current || ''}`;
      if (lastFocusLoadKeyRef.current === focusLoadKey) return;
      lastFocusLoadKeyRef.current = focusLoadKey;

      let isMounted = true;
      const loadInitial = async () => {
        setLoadingInitialData(true);
        try {
          const salesSettings = await getSalesSettings();
          const nextDefaultMarginPercent = (Math.max(0, Number(salesSettings.defaultProfitMarginBp || 3000)) / 100).toFixed(2);
          setDefaultSaleMarginPercent(nextDefaultMarginPercent);
          setSalePricesIncludeItbis(salesSettings.salePricesIncludeItbis !== false);

          let catalog = await loadLocalCatalogsRef.current();
          if (isOnlineRef.current) {
            const synced = await syncBestEffort();
            if (synced) {
              catalog = await loadLocalCatalogsRef.current();
            }
            setCreditPaymentOptions(await purchaseCreditService.paymentOptions().catch(() => ({ methods: [], accounts: [] })));
          }
          if (!isMounted) return;

          if (isEditMode) {
            await loadLocalPurchaseForEditRef.current(catalog);
          } else {
            setPersistedLocalId(null);
            setPersistedServerId(null);
            setPurchaseType('CONTADO');
            setDueDate('');
            setInitialPayment('0');
            setItems([createEmptyItem(nextDefaultMarginPercent)]);
          }
        } catch (error) {
          if (!isMounted) return;
          console.error('Error cargando datos locales de compra:', error);
          Alert.alert('Error', 'No se pudo cargar la compra');
          if (isEditMode) navigation.goBack();
        } finally {
          if (isMounted) setLoadingInitialData(false);
        }
      };

      loadInitial();
      return () => {
        lastFocusLoadKeyRef.current = null;
        isMounted = false;
      };
    }, [isEditMode, navigation, purchaseId, syncBestEffort])
  );

  const updateItem = (index: number, patch: Partial<PurchaseFormItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addItem = () => setItems((prev) => [...prev, createEmptyItem(defaultSaleMarginPercent)]);
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const filteredProducts = () => {
    const query = productSearchQuery.trim().toLowerCase();
    const activeProducts = products.filter((product) => product.isActive);
    if (!query) return activeProducts.slice(0, 8);
    return activeProducts
      .filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          String(product.sku || '').toLowerCase().includes(query) ||
          String(product.reference || '').toLowerCase().includes(query)
      )
      .slice(0, 8);
  };

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) || null;
  const selectedSupplierDiscountPercent =
    selectedSupplier && Number(selectedSupplier.discountPercentBp || 0) > 0
      ? String(Number(selectedSupplier.discountPercentBp || 0) / 100)
      : '';

  const parseNumberFromInput = (value: string) => Number((value || '0').replace(',', '.'));
  const toCents = (value: string) => Math.round(parseNumberFromInput(value) * 100);
  const getPurchaseItbisRateBp = (supplier: SupplierOption | null) => {
    if (supplier?.chargesItbis) return supplier.itbisRateBp ?? DEFAULT_PURCHASE_ITBIS_RATE_BP;
    return DEFAULT_PURCHASE_ITBIS_RATE_BP;
  };
  const defaultSaleMarginBp = normalizeMarginBp(parseNumberFromInput(DEFAULT_SALE_MARGIN_PERCENT) * 100);

  const recalcItemPricing = (
    item: PurchaseFormItem,
    mode: 'margin' | 'price',
    patch?: Partial<PurchaseFormItem>
  ): PurchaseFormItem => {
    const nextItem = { ...item, ...(patch || {}) };
    if (!nextItem.productId) return nextItem;

    const product = products.find((p) => p.id === nextItem.productId);
    const unitCostCents = Math.max(0, toCents(nextItem.unitCost));
    const itemDiscountRaw = (nextItem.discountPercent || '').trim();
    const itemDiscountBp =
      itemDiscountRaw.length > 0
        ? normalizeDiscountBp(parseNumberFromInput(nextItem.discountPercent) * 100)
        : normalizeDiscountBp(selectedSupplier?.discountPercentBp || 0);
    const purchaseIncludesItbis = selectedSupplier ? Boolean(selectedSupplier.chargesItbis) : false;
    const purchaseItbisForSupplier = getPurchaseItbisRateBp(selectedSupplier);
    const saleMarginBp = normalizeMarginBp(parseNumberFromInput(nextItem.saleMarginPercent) * 100);
    const salePriceCents = Math.max(0, toCents(nextItem.salePrice));

    const pricing = resolvePurchaseSalePricingMobile({
      unitCostCents,
      discountPercentBp: itemDiscountBp,
      purchaseIncludesItbis,
      purchaseItbisRateBp: purchaseItbisForSupplier,
      productItbisRateBp: product?.itbisRateBp ?? 0,
      salePricesIncludeItbis,
      defaultSaleMarginBp,
      saleMarginBp: mode === 'price' ? undefined : saleMarginBp,
      salePriceCents: mode === 'price' ? salePriceCents : undefined,
    });

    return {
      ...nextItem,
      saleMarginPercent: (pricing.saleMarginBp / 100).toFixed(2),
      salePrice: (pricing.salePriceCents / 100).toFixed(2),
    };
  };

  const recalcAllItemsForSupplier = (nextSupplier: SupplierOption | null) => {
    setItems((prev) =>
      prev.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) return item;

        const itemDiscountRaw = (item.discountPercent || '').trim();
        const discountPercentText =
          itemDiscountRaw.length > 0
            ? item.discountPercent
            : Number(nextSupplier?.discountPercentBp || 0) > 0
            ? String(Number(nextSupplier?.discountPercentBp || 0) / 100)
            : '';

        return recalcItemPricing({ ...item, discountPercent: discountPercentText }, 'margin');
      })
    );
  };

  const addProductFromSearch = (product: ProductOption) => {
    setItems((prev) => {
      const existingIdx = prev.findIndex((x) => x.productId === product.id);
      if (existingIdx >= 0) {
        return prev.map((x, i) => {
          if (i === existingIdx) {
            const nextQty = Math.max(1, Number(x.qty || 0) + 1);
            return { ...x, qty: String(nextQty) };
          }
          return x;
        });
      }

      const emptyIdx = prev.findIndex((x) => !x.productId);
      const targetItem = emptyIdx >= 0 ? prev[emptyIdx] : createEmptyItem(defaultSaleMarginPercent);

      const patch: Partial<PurchaseFormItem> = {
        productId: product.id,
        productName: product.name,
        productReference: product.reference || null,
        unitCost: (product.costCents / 100).toString(),
        ...(targetItem.discountPercent.trim().length === 0 && selectedSupplierDiscountPercent
          ? { discountPercent: selectedSupplierDiscountPercent }
          : {}),
        ...(targetItem.saleMarginPercent.trim().length === 0 && defaultSaleMarginPercent
          ? { saleMarginPercent: defaultSaleMarginPercent }
          : {}),
      };

      if (emptyIdx >= 0) {
        return prev.map((x, i) => (i === emptyIdx ? recalcItemPricing(x, 'margin', patch) : x));
      }

      return [...prev, recalcItemPricing(createEmptyItem(defaultSaleMarginPercent), 'margin', patch)];
    });
  };

  const addScannedProducts = (scannedItems: Array<{ productId: string; qty: number }>) => {
    if (!Array.isArray(scannedItems) || scannedItems.length === 0) return;

    setItems((prev) => {
      let next = [...prev];
      const firstEmptyIdx = next.findIndex((item) => !item.productId);

      scannedItems.forEach((scanned, scannedIndex) => {
        const product = products.find((p) => p.id === scanned.productId);
        if (!product) return;
        const scannedQty = Math.max(1, Math.round(Number(scanned.qty || 0)));

        const existingIdx = next.findIndex((x) => x.productId === product.id);
        if (existingIdx >= 0) {
          const existing = next[existingIdx];
          next[existingIdx] = {
            ...existing,
            qty: String(Math.max(1, Number(existing.qty || 0) + scannedQty)),
          };
          return;
        }

        const targetIdx = scannedIndex === 0 && firstEmptyIdx >= 0 ? firstEmptyIdx : -1;
        const baseItem = targetIdx >= 0 ? next[targetIdx] : createEmptyItem(defaultSaleMarginPercent);
        const patch: Partial<PurchaseFormItem> = {
          productId: product.id,
          productName: product.name,
          productReference: product.reference || null,
          qty: String(scannedQty),
          unitCost: (product.costCents / 100).toString(),
          ...(baseItem.discountPercent.trim().length === 0 && selectedSupplierDiscountPercent
            ? { discountPercent: selectedSupplierDiscountPercent }
            : {}),
          ...(baseItem.saleMarginPercent.trim().length === 0 && defaultSaleMarginPercent
            ? { saleMarginPercent: defaultSaleMarginPercent }
            : {}),
        };

        if (targetIdx >= 0) {
          next[targetIdx] = recalcItemPricing(next[targetIdx], 'margin', patch);
        } else {
          next.push(recalcItemPricing(createEmptyItem(defaultSaleMarginPercent), 'margin', patch));
        }
      });

      return next;
    });
  };

  const handleScanBarcode = () => {
    navigation.navigate('BarcodeScanner', {
      scannerMode: 'PURCHASE_SPLIT',
      onSubmitScanned: (scanned: Array<{ productId: string; qty: number }>) => {
        if (!scanned || scanned.length === 0) return;
        addScannedProducts(scanned);
      },
    });
  };

  const totalCents = useMemo(() => {
    const supplierDiscountBp = selectedSupplier?.discountPercentBp || 0;
    const supplierChargesItbis = selectedSupplier ? Boolean(selectedSupplier.chargesItbis) : false;
    const normalizedPurchaseItbisRateBp = normalizeItbisRateBp(
      supplierChargesItbis
        ? selectedSupplier?.itbisRateBp ?? DEFAULT_PURCHASE_ITBIS_RATE_BP
        : DEFAULT_PURCHASE_ITBIS_RATE_BP
    );

    return items.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const unitCostCents = Math.round(Number((item.unitCost || '0').replace(',', '.')) * 100);
      const itemDiscountRaw = (item.discountPercent || '').trim();
      const itemDiscountBp =
        itemDiscountRaw.length > 0
          ? normalizeDiscountBp(parseNumberFromInput(item.discountPercent) * 100)
          : normalizeDiscountBp(supplierDiscountBp);
      if (!Number.isFinite(qty) || !Number.isFinite(unitCostCents) || qty <= 0 || unitCostCents < 0) return sum;

      const discountRate = itemDiscountBp / 10000;
      const discountedCostCents = Math.round(unitCostCents * (1 - discountRate));
      const netCostCents =
        supplierChargesItbis && normalizedPurchaseItbisRateBp > 0
          ? Math.round(discountedCostCents * (1 + normalizedPurchaseItbisRateBp / 10000))
          : discountedCostCents;

      return sum + Math.round(netCostCents * qty);
    }, 0);
  }, [items, selectedSupplier]);

  const applyPurchaseEffectsLocally = useCallback(
    async (
      previousItems: PurchaseStoredItem[],
      nextItems: PurchaseStoredItem[],
      options: { updateCost: boolean; updatePrice: boolean },
      tx?: DatabaseTransaction
    ) => {
      const stockDeltaByProduct = new Map<string, number>();
      const latestPricingByProduct = new Map<string, { costCents: number; priceCents: number }>();

      const addDelta = (localProductId: string, delta: number) => {
        const current = stockDeltaByProduct.get(localProductId) || 0;
        stockDeltaByProduct.set(localProductId, current + delta);
      };

      for (const item of previousItems) {
        const localProductId = resolveLocalProductId(item.productId, item.productServerId);
        const qty = Number(item.qty || 0);
        if (!localProductId || !Number.isFinite(qty) || qty === 0) continue;
        addDelta(localProductId, -qty);
      }

      for (const item of nextItems) {
        const localProductId = resolveLocalProductId(item.productId, item.productServerId);
        const qty = Number(item.qty || 0);
        if (!localProductId || !Number.isFinite(qty) || qty === 0) continue;
        addDelta(localProductId, qty);
        latestPricingByProduct.set(localProductId, {
          costCents: Math.max(0, Math.round(Number(item.netCostCents ?? item.unitCostCents ?? 0))),
          priceCents: Math.max(0, Math.round(Number(item.salePriceCents ?? 0))),
        });
      }

      for (const [localProductId, delta] of stockDeltaByProduct.entries()) {
        if (!Number.isFinite(delta) || delta === 0) continue;
        await (tx ? tx.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [delta, localProductId]) : db.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [delta, localProductId]));
      }

      if (!options.updateCost && !options.updatePrice) return;

      for (const [localProductId, pricing] of latestPricingByProduct.entries()) {
        const row = await (tx ? tx.queryFirst<{ data: string | null }>(
          `SELECT data FROM products WHERE local_id = ? LIMIT 1`, [localProductId]) : db.queryFirst<{ data: string | null }>(
          `SELECT data
           FROM products
           WHERE local_id = ?
           LIMIT 1`,
          [localProductId]
        ));

        const patch: Record<string, any> = {};
        if (options.updateCost) patch.cost_cents = pricing.costCents;
        if (options.updatePrice) patch.price_cents = pricing.priceCents;

        const parsed = parseJsonObject(row?.data);
        if (parsed) {
          patch.data = JSON.stringify({
            ...parsed,
            ...(options.updateCost ? { costCents: pricing.costCents } : {}),
            ...(options.updatePrice ? { priceCents: pricing.priceCents } : {}),
          });
        }

        if (Object.keys(patch).length > 0) {
          if (tx) await tx.runAsync(`UPDATE products SET ${Object.keys(patch).map(key => `${key} = ?`).join(', ')} WHERE local_id = ?`, [...Object.values(patch), localProductId]);
          else await db.update('products', localProductId, patch);
        }
      }
    },
    [resolveLocalProductId]
  );

  const handleSave = async () => {
    if (loading) return;
    if (creditSubmissionPending) { Alert.alert('Confirmación pendiente', 'Revisa la operación desde Compras antes de registrar otra.'); return; }
    if (!canManagePurchases) { Alert.alert('Sin permiso', 'No tienes permiso para gestionar compras.'); return; }
    if (isEditMode && purchaseType === 'CREDITO' && creditHasActivePayments) {
      if (!isOnlineRef.current || !persistedServerId) { Alert.alert('Error', 'Conéctate y sincroniza la compra antes de editarla.'); return; }
      if (!validDateOnly(dueDate)) { Alert.alert('Error', 'Introduce un vencimiento válido YYYY-MM-DD.'); return; }
      setLoading(true);
      try {
        const current = await purchaseCreditService.getPurchase(persistedServerId);
        if (purchaseEditFingerprint(current) !== creditServerFingerprintRef.current) throw new Error('La compra cambió en el servidor. Vuelve a abrirla antes de guardar.');
        await purchaseCreditService.patchPurchase(persistedServerId, { notes: notes.trim() || null, dueDate });
        await syncBestEffort().catch(error => console.warn('La compra se editó, pero no se pudo refrescar:', error));
        Alert.alert('Éxito', 'Notas y vencimiento actualizados.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } catch (error) { Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo actualizar la compra.'); }
      finally { setLoading(false); }
      return;
    }
    if (!supplierId || !selectedSupplier) {
      Alert.alert('Error', 'Debes seleccionar un proveedor para guardar la compra.');
      return;
    }

    const normalizedItems = items.map((item) => {
      const matchedProduct = products.find((product) => product.id === item.productId) || null;
      const qty = Number(item.qty || 0);
      const unitCostCents = toCents(item.unitCost);
      const discountRaw = (item.discountPercent || '').trim();
      const discountPercent = parseNumberFromInput(discountRaw);
      const hasDiscount = discountRaw.length > 0 && Number.isFinite(discountPercent) && discountPercent > 0;
      const discountPercentBp = hasDiscount ? Math.round(discountPercent * 100) : undefined;
      const resolvedDiscountPercentBp =
        discountPercentBp ?? normalizeDiscountBp(selectedSupplier.discountPercentBp);
      const saleMarginRaw = (item.saleMarginPercent || '').trim();
      const saleMarginPercent = parseNumberFromInput(saleMarginRaw);
      const hasSaleMargin = saleMarginRaw.length > 0 && Number.isFinite(saleMarginPercent) && saleMarginPercent >= 0;
      const parsedSaleMarginBp = hasSaleMargin ? Math.round(saleMarginPercent * 100) : undefined;
      const salePriceRaw = (item.salePrice || '').trim();
      const salePrice = parseNumberFromInput(salePriceRaw);
      const hasSalePrice = salePriceRaw.length > 0 && Number.isFinite(salePrice) && salePrice >= 0;
      const parsedSalePriceCents = hasSalePrice ? Math.round(salePrice * 100) : undefined;

      const pricing = resolvePurchaseSalePricingMobile({
        unitCostCents,
        discountPercentBp: resolvedDiscountPercentBp,
        purchaseIncludesItbis: Boolean(selectedSupplier.chargesItbis),
        purchaseItbisRateBp: getPurchaseItbisRateBp(selectedSupplier),
        productItbisRateBp: matchedProduct?.itbisRateBp ?? 0,
        salePricesIncludeItbis,
        defaultSaleMarginBp,
        saleMarginBp: parsedSalePriceCents !== undefined ? undefined : parsedSaleMarginBp,
        salePriceCents: parsedSalePriceCents,
      });

      return {
        productId: String(item.productId || ''),
        productServerId: matchedProduct?.serverId || null,
        productName: item.productName || matchedProduct?.name || 'Producto',
        productReference: item.productReference || matchedProduct?.reference || null,
        qty,
        unitCostCents,
        discountPercentBp: resolvedDiscountPercentBp,
        netCostCents: pricing.netCostCents,
        salePriceCents: pricing.salePriceCents,
        saleMarginBp: pricing.saleMarginBp,
        purchaseIncludesItbis: Boolean(selectedSupplier.chargesItbis),
        appliedItbisRateBp: matchedProduct?.itbisRateBp ?? 0,
        lineTotalCents: Math.round(pricing.netCostCents * qty),
      } as PurchaseStoredItem;
    });

    if (normalizedItems.some((item) => !item.productId || item.qty <= 0 || item.unitCostCents < 0)) {
      Alert.alert('Error', 'Completa correctamente los productos, cantidades y costos.');
      return;
    }

    if (normalizedItems.some((item) => !products.some((product) => product.id === item.productId))) {
      Alert.alert('Error', 'Hay productos no disponibles localmente. Sincroniza y vuelve a intentarlo.');
      return;
    }

    if (purchaseType === 'CREDITO') {
      if (!isOnlineRef.current) { Alert.alert('Sin conexión', 'Conéctate para registrar o editar una compra a crédito.'); return; }
      if (isEditMode && !creditLiveLoaded) { Alert.alert('Saldo sin confirmar', 'Actualiza la compra desde el servidor antes de editarla.'); return; }
      if (!selectedSupplier.serverId || !selectedSupplier.isActive) { Alert.alert('Error', 'El crédito requiere un proveedor activo y sincronizado.'); return; }
      if (!validDateOnly(dueDate)) { Alert.alert('Error', 'Introduce un vencimiento válido YYYY-MM-DD.'); return; }
      const initialPaymentCents = isEditMode || !initialPayment.trim() ? 0 : parseAmountCents(initialPayment);
      if (!Number.isSafeInteger(initialPaymentCents) || initialPaymentCents < 0 || initialPaymentCents >= totalCents || totalCents <= 0) {
        Alert.alert('Error', 'El abono debe ser menor que el total. Usa Contado para pagar todo.'); return;
      }
      if (initialPaymentCents > 0 && !canRegisterSupplierPayments) { Alert.alert('Sin permiso', 'No tienes permiso para registrar un abono inicial.'); return; }
      if (initialPaymentCents > 0 && (!creditAccountId || !paymentAccounts(creditPaymentOptions, paymentMethod).some(account => account.id === creditAccountId))) {
        Alert.alert('Error', 'Selecciona una cuenta de pago activa en DOP.'); return;
      }
      if (!creditHasActivePayments && normalizedItems.some(item => !item.productServerId)) { Alert.alert('Error', 'Sincroniza los productos antes de registrar o editar crédito.'); return; }
      if (!creditHasActivePayments && normalizedItems.some(item => products.find(product => product.id === item.productId)?.synced !== true)) { Alert.alert('Error', 'Hay productos con cambios locales pendientes. Sincronízalos antes de registrar crédito.'); return; }
      setLoading(true);
      try {
        syncService.setTokenGetter(getToken);
        syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
        const serverId = persistedServerId;
        if (isEditMode && !serverId) throw new Error('Sincroniza la compra antes de editarla.');
        if (isEditMode) {
          const current = await purchaseCreditService.getPurchase(serverId!);
          if (purchaseEditFingerprint(current) !== creditServerFingerprintRef.current) throw new Error('La compra cambió en el servidor. Vuelve a abrirla antes de guardar.');
        }
        let confirmedPurchaseId = serverId;
        if (isEditMode && creditHasActivePayments) {
          await purchaseCreditService.patchPurchase(serverId!, { notes: notes.trim() || null, dueDate });
        } else {
          const body = {
            type: 'CREDITO' as const, supplierId: selectedSupplier.serverId, supplierName: selectedSupplier.name,
            dueDate, notes: notes.trim() || null, updateProductCost, updateProductPrice,
            items: normalizedItems.map(item => ({ productId: item.productServerId!, qty: item.qty,
              unitCostCents: item.unitCostCents, discountPercentBp: item.discountPercentBp,
              saleMarginBp: item.saleMarginBp, salePriceCents: item.salePriceCents,
              purchaseIncludesItbis: item.purchaseIncludesItbis })),
          };
          if (isEditMode) await purchaseCreditService.updatePurchase(serverId!, { ...body, supplierName: undefined });
          else {
            const outcome = await purchaseCreditService.createCreditPurchase({ ...body, initialPaymentCents,
              ...(initialPaymentCents > 0 ? { paymentMethod, treasuryAccountId: creditAccountId! } : {}) });
            if (!outcome.confirmed) {
              setCreditSubmissionPending(true);
              Alert.alert(outcome.rejected ? 'Compra rechazada' : 'Confirmación pendiente', outcome.error || 'Reintenta la misma compra desde el listado antes de registrar otra.', [{ text: 'Ver Compras', onPress: () => navigation.goBack() }]);
              return;
            }
            confirmedPurchaseId = String(outcome.result.id);
          }
        }
        let refreshWarning = '';
        try { await syncService.refreshConfirmedCreditPurchase(confirmedPurchaseId!); }
        catch (error) { refreshWarning = error instanceof Error ? error.message : 'La actualización local está pendiente.'; }
        Alert.alert('Compra confirmada', refreshWarning ? `Registrada en el servidor. ${refreshWarning}` : 'Compra a crédito confirmada en el servidor.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } catch (error) { Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo guardar la compra.'); }
      finally { setLoading(false); }
      return;
    }

    if ((paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA') && !treasuryAccountId) {
      Alert.alert('Error', 'Debes seleccionar una cuenta de tesorería.');
      return;
    }

    setLoading(true);
    try {
      const cashQueueContext = await cashContextForQueue('purchase', isEditMode ? 'update' : 'create', { paymentMethod, treasuryAccountId });
      const now = Date.now();
      const localId = isEditMode ? persistedLocalId || String(purchaseId) : generateLocalId();

      let previousItems: PurchaseStoredItem[] = [];
      let purchasedAt = now;
      let cancelledAt: number | null = null;
      let serverId = persistedServerId;

      if (isEditMode) {
        const existingRow = await db.queryFirst<{
          local_id: string;
          server_id: string | null;
          purchased_at: number | null;
          cancelled_at: number | null;
          data: string | null;
        }>(
          `SELECT local_id, server_id, purchased_at, cancelled_at, data
           FROM purchases
           WHERE local_id = ?
           LIMIT 1`,
          [localId]
        );

        if (!existingRow) {
          Alert.alert('Error', 'No se pudo encontrar la compra para actualizar.');
          setLoading(false);
          return;
        }

        const parsedExisting = parseJsonObject(existingRow.data);
        previousItems = normalizeStoredItems(parsedExisting?.items);
        purchasedAt = Math.round(asNumber(existingRow.purchased_at) ?? asNumber(parsedExisting?.purchasedAt) ?? now);
        cancelledAt = asNumber(existingRow.cancelled_at) ?? asNumber(parsedExisting?.cancelledAt) ?? null;
        serverId = asString(existingRow.server_id) || asString(parsedExisting?.serverId) || asString(parsedExisting?.id) || serverId;
      }

      const computedTotalCents = normalizedItems.reduce((sum, item) => sum + Math.round(Number(item.lineTotalCents || 0)), 0);

      const purchaseData = {
        ...(serverId ? { id: serverId, serverId } : {}),
        localId,
        supplierId: selectedSupplier.id,
        supplierServerId: selectedSupplier.serverId,
        supplierName: selectedSupplier.name,
        paymentMethod,
        treasuryAccountId: treasuryAccountId || null,
        notes: notes.trim() || null,
        totalCents: computedTotalCents,
        purchasedAt,
        cancelledAt,
        itemsCount: normalizedItems.length,
        items: normalizedItems,
        updateProductCost,
        updateProductPrice,
      };

      const rowPatch = {
        server_id: serverId,
        supplier_name: selectedSupplier.name,
        treasury_account_id: treasuryAccountId || null,
        total_cents: computedTotalCents,
        purchased_at: purchasedAt,
        cancelled_at: cancelledAt,
        synced: 0,
        data: JSON.stringify(purchaseData),
      };

      const queuePayload = {
        ...(serverId ? { id: serverId } : {}),
        supplierId: selectedSupplier.id,
        supplierServerId: selectedSupplier.serverId,
        supplierName: selectedSupplier.name,
        paymentMethod,
        treasuryAccountId: treasuryAccountId || null,
        notes: notes.trim() || null,
        updateProductCost,
        updateProductPrice,
        items: normalizedItems.map((item) => ({
          productId: item.productId,
          productServerId: item.productServerId || null,
          ...(item.productReference ? { productReference: item.productReference } : {}),
          qty: item.qty,
          unitCostCents: item.unitCostCents,
          ...(typeof item.discountPercentBp === 'number' ? { discountPercentBp: item.discountPercentBp } : {}),
          ...(typeof item.saleMarginBp === 'number' ? { saleMarginBp: item.saleMarginBp } : {}),
          ...(typeof item.salePriceCents === 'number' ? { salePriceCents: item.salePriceCents } : {}),
          purchaseIncludesItbis: Boolean(item.purchaseIncludesItbis),
        })),
      };

      syncService.setTokenGetter(getToken);
      syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);

      if (!isEditMode) {
        // La compra, el inventario y su pendiente deben quedar en un solo commit,
        // incluso cuando el negocio aún usa el cuadre diario.
        await db.transaction(async tx => {
          await applyPurchaseEffectsLocally(previousItems, normalizedItems, { updateCost: updateProductCost, updatePrice: updateProductPrice }, tx);
          await tx.runAsync('INSERT INTO purchases (local_id, server_id, supplier_name, treasury_account_id, total_cents, purchased_at, cancelled_at, synced, data) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
            [localId, rowPatch.server_id, rowPatch.supplier_name, rowPatch.treasury_account_id, rowPatch.total_cents, rowPatch.purchased_at, rowPatch.cancelled_at, rowPatch.data]);
          await syncService.queueOperationTx(tx, 'purchase', 'create', queuePayload, localId, cashQueueContext);
        });
        void syncService.kickQueue().catch(error => console.warn('La compra quedó en cola; falló la sincronización inmediata:', error));
      } else {
      await applyPurchaseEffectsLocally(previousItems, normalizedItems, {
        updateCost: updateProductCost,
        updatePrice: updateProductPrice,
      });
      if (isEditMode) await db.update('purchases', localId, rowPatch);
      else await db.insert('purchases', { local_id: localId, ...rowPatch });

      if (isEditMode) {
        if (serverId) {
          await db.runAsync(
            "DELETE FROM sync_queue WHERE entity_type = 'purchase' AND action = 'update' AND entity_local_id = ? AND status IN ('pending','error')",
            [localId]
          );
          await syncService.queueOperation('purchase', 'update', queuePayload, localId);
        } else {
          await db.runAsync(
            "DELETE FROM sync_queue WHERE entity_type = 'purchase' AND action = 'update' AND entity_local_id = ? AND status IN ('pending','error')",
            [localId]
          );
          const pendingCreate = await db.queryFirst<{ id: number }>(
            `SELECT id
             FROM sync_queue
             WHERE entity_type = 'purchase'
               AND entity_local_id = ?
               AND action = 'create'
               AND status IN ('pending','error')
             ORDER BY created_at DESC
             LIMIT 1`,
            [localId]
          );

          if (pendingCreate?.id) {
            await db.update(
              'sync_queue',
              String(pendingCreate.id),
              {
                data: JSON.stringify(queuePayload),
                status: 'pending',
                retry_count: 0,
              },
              'id'
            );
          } else {
            await syncService.queueOperation('purchase', 'create', queuePayload, localId);
          }
        }
      } else {
        await db.runAsync(
          "DELETE FROM sync_queue WHERE entity_type = 'purchase' AND entity_local_id = ? AND status IN ('pending','error')",
          [localId]
        );
        await syncService.queueOperation('purchase', 'create', queuePayload, localId);
      }
      }

      setPersistedLocalId(localId);
      setPersistedServerId(serverId || null);

      const successMessage = isOnlineRef.current
        ? isEditMode
          ? 'Compra guardada correctamente.'
          : 'Compra creada correctamente.'
        : isEditMode
          ? 'Compra guardada localmente. Se sincronizará cuando vuelva la conexión.'
          : 'Compra creada localmente. Se sincronizará cuando vuelva la conexión.';

      Alert.alert('Éxito', successMessage, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error) {
      console.error(isEditMode ? 'Error actualizando compra local:' : 'Error creando compra local:', error);
      Alert.alert('Error', error instanceof Error ? error.message : isEditMode ? 'No se pudo guardar la compra' : 'No se pudo crear la compra');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{isEditMode ? 'Editar Compra' : 'Nueva Compra'}</Text>
          <Text style={styles.headerSubtitle}>{isEditMode ? 'Modifica la compra' : 'Registra una compra de inventario'}</Text>
        </View>

        {!isEditMode && <PendingFinancialOperations kind="credit_purchase" onConfirmed={(result) => { if (result?.id) void syncService.refreshConfirmedCreditPurchase(String(result.id)).catch(error => console.warn('Compra confirmada; actualización local pendiente:', error)); }} />}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Proveedor y Notas</Text>
          <Menu
            visible={supplierMenuVisible}
            onDismiss={() => setSupplierMenuVisible(false)}
            anchor={
              <TouchableOpacity style={styles.selectLike} onPress={() => !creditHasActivePayments && setSupplierMenuVisible(true)}>
                <Text style={styles.selectLikeText}>{supplierName || 'Seleccionar proveedor *'}</Text>
                <Icon source="chevron-down" size={18} color="#6B7280" />
              </TouchableOpacity>
            }
          >
            {suppliers.map((supplier) => (
              <Menu.Item
                key={supplier.id}
                title={supplier.name}
                onPress={() => {
                  setSupplierId(supplier.id);
                  setSupplierName(supplier.name);
                  if (purchaseType === 'CREDITO' && !isEditMode) setDueDate(proposeDueDate(supplier.creditDays));
                  recalcAllItemsForSupplier(supplier);
                  setSupplierMenuVisible(false);
                }}
              />
            ))}
          </Menu>

          <Text style={styles.switchLabel}>Condición de compra</Text>
          <Menu visible={typeMenuVisible} onDismiss={() => setTypeMenuVisible(false)} anchor={<TouchableOpacity style={styles.selectLike} onPress={() => !isEditMode && setTypeMenuVisible(true)}>
            <Text style={styles.selectLikeText}>{purchaseType === 'CREDITO' ? 'Crédito' : 'Contado'}</Text><Icon source="chevron-down" size={18} color="#6B7280" />
          </TouchableOpacity>}>
            <Menu.Item title="Contado" onPress={() => { setPurchaseType('CONTADO'); setInitialPayment('0'); setTypeMenuVisible(false); }} />
            <Menu.Item title="Crédito" onPress={() => { setPurchaseType('CREDITO'); setDueDate(dueDate || proposeDueDate(selectedSupplier?.creditDays || 0)); setTypeMenuVisible(false); }} />
          </Menu>
          {purchaseType === 'CREDITO' && <>
            <TextInput label="Vencimiento * (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} mode="outlined" style={styles.input} placeholder="2026-12-01" />
            <Text style={styles.switchDescription}>Plazo del proveedor: {selectedSupplier?.creditDays || 0} días</Text>
            {!isEditMode && (canRegisterSupplierPayments ? <TextInput label="Abono inicial (RD$)" value={initialPayment} onChangeText={setInitialPayment} mode="outlined" keyboardType="decimal-pad" style={styles.input} />
              : <Text style={styles.switchDescription}>El pago inicial requiere permiso de pagos a proveedores.</Text>)}
            <Text>Pendiente: {formatCurrency(isEditMode ? creditBalanceCents : Math.max(0, totalCents - (parseAmountCents(initialPayment) || 0)))}</Text>
            {isEditMode && <Text>Abonado actual: {formatCurrency(creditPaidCents)}</Text>}
            {creditHasActivePayments && <Text style={styles.switchDescription}>Hay pagos activos. Solo puedes cambiar notas y vencimiento.</Text>}
          </>}

          {(purchaseType === 'CONTADO' || (!isEditMode && parseAmountCents(initialPayment) > 0)) && <>
          <Text style={styles.switchLabel}>Método de pago</Text>
          <Menu
            visible={paymentMethodMenuVisible}
            onDismiss={() => setPaymentMethodMenuVisible(false)}
            anchor={
              <TouchableOpacity style={styles.selectLike} onPress={() => setPaymentMethodMenuVisible(true)}>
                <Text style={styles.selectLikeText}>{paymentMethod}</Text>
                <Icon source="chevron-down" size={18} color="#6B7280" />
              </TouchableOpacity>
            }
          >
            {['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO'].map((method) => (
              <Menu.Item
                key={method}
                title={method}
                onPress={() => {
                  setPaymentMethod(method as any);
                  setPaymentMethodMenuVisible(false);
                }}
              />
            ))}
          </Menu>

          <Text style={styles.switchLabel}>Cuenta de tesorería</Text>
          {purchaseType === 'CREDITO' ? <Menu visible={creditAccountMenuVisible} onDismiss={() => setCreditAccountMenuVisible(false)} anchor={<TouchableOpacity style={styles.selectLike} onPress={() => setCreditAccountMenuVisible(true)}>
            <Text style={styles.selectLikeText}>{paymentAccounts(creditPaymentOptions, paymentMethod).find(account => account.id === creditAccountId)?.name || 'Seleccionar cuenta DOP'}</Text><Icon source="chevron-down" size={18} color="#6B7280" />
          </TouchableOpacity>}>
            {paymentAccounts(creditPaymentOptions, paymentMethod).map(account => <Menu.Item key={account.id} title={account.name} onPress={() => { setCreditAccountId(account.id); setCreditAccountMenuVisible(false); }} />)}
          </Menu> :
          <Menu
            visible={treasuryMenuVisible}
            onDismiss={() => setTreasuryMenuVisible(false)}
            anchor={
              <TouchableOpacity style={styles.selectLike} onPress={() => setTreasuryMenuVisible(true)}>
                <Text style={styles.selectLikeText}>
                  {findTreasuryAccountById(
                    filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), paymentMethod),
                    treasuryAccountId
                  )?.name || 'Seleccionar cuenta'}
                </Text>
                <Icon source="chevron-down" size={18} color="#6B7280" />
              </TouchableOpacity>
            }
          >
            {filterTreasuryAccountsByMethod(
              treasuryAccounts.filter((account) => account.isActive),
              paymentMethod
            ).map((account) => (
              <Menu.Item
                key={account.localId}
                title={account.name}
                onPress={() => {
                  setTreasuryAccountId(account.localId);
                  setTreasuryMenuVisible(false);
                }}
              />
            ))}
            <Menu.Item
              title="+ Crear nueva cuenta"
              onPress={() => {
                requestCreateAccountModal(paymentMethod === 'EFECTIVO' ? 'CAJA' : paymentMethod === 'TRANSFERENCIA' ? 'BANCO' : null);
                setTreasuryMenuVisible(false);
                navigation.navigate('TreasuryMenu', { screen: 'Treasury' });
              }}
            />
          </Menu>
          }
          </>}

          <TextInput
            label="Notas"
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

          {!creditHasActivePayments && <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchLabel}>Actualizar costo de productos</Text>
              <Text style={styles.switchDescription}>Si activas esto, el costo de cada producto se actualizará con el costo neto de esta compra.</Text>
            </View>
            <Switch value={updateProductCost} onValueChange={setUpdateProductCost} color={ui.colors.primary} />
          </View>}

          {!creditHasActivePayments && <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchLabel}>Actualizar precio de venta</Text>
              <Text style={styles.switchDescription}>Si activas esto, el precio de venta se recalculará con la lógica de márgenes del sistema.</Text>
            </View>
            <Switch value={updateProductPrice} onValueChange={setUpdateProductPrice} color={ui.colors.primary} />
          </View>}
        </View>

        {!creditHasActivePayments && <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Productos</Text>
            <Button mode="outlined" compact onPress={addItem} textColor={ui.colors.primary} style={styles.addItemButton}>
              Agregar
            </Button>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              label="Buscar producto"
              value={productSearchQuery}
              onChangeText={setProductSearchQuery}
              mode="outlined"
              style={[styles.input, styles.searchInput]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TouchableOpacity style={styles.scanButton} onPress={handleScanBarcode}>
              <Icon source="barcode-scan" size={22} color={ui.colors.primary} />
            </TouchableOpacity>
          </View>

          {productSearchQuery.trim().length > 0 ? (
            <View style={styles.suggestionBox}>
              {filteredProducts().length === 0 ? <Text style={styles.suggestionEmpty}>Sin resultados</Text> : null}
              {filteredProducts().map((product) => (
                <TouchableOpacity
                  key={`search_${product.id}`}
                  style={styles.suggestionItem}
                  onPress={() => {
                    addProductFromSearch(product);
                    setProductSearchQuery('');
                  }}
                >
                  <Text style={styles.suggestionTitle}>{product.name}</Text>
                  <Text style={styles.suggestionMeta}>SKU: {product.sku || '—'} · Ref: {product.reference || '—'}</Text>
                  <Text style={styles.suggestionMeta}>Costo base: {formatCurrency(product.costCents)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {items.map((item, index) => (
            <View key={item.key} style={styles.itemCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemTitle}>Producto #{index + 1}</Text>
                {items.length > 1 ? (
                  <TouchableOpacity style={styles.removeItemButton} onPress={() => removeItem(index)}>
                    <Icon source="close" size={20} color="#fff" />
                  </TouchableOpacity>
                ) : null}
              </View>

              {item.productName ? (
                <>
                  <Text style={styles.selectedProduct}>Producto: {item.productName}</Text>
                  {item.productReference ? <Text style={styles.selectedProductRef}>Ref: {item.productReference}</Text> : null}
                </>
              ) : (
                <Text style={styles.suggestionEmpty}>Selecciona un producto desde la búsqueda superior.</Text>
              )}

              <View style={styles.row}>
                <TextInput
                  label="Cantidad"
                  value={item.qty}
                  onChangeText={(value) => updateItem(index, { qty: value })}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  outlineColor={ui.colors.border}
                  activeOutlineColor={ui.colors.primary}
                />
                <TextInput
                  label="Costo unitario (RD$)"
                  value={item.unitCost}
                  onChangeText={(value) =>
                    setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'margin', { unitCost: value }) : x)))
                  }
                  onBlur={() => setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'margin') : x)))}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  outlineColor={ui.colors.border}
                  activeOutlineColor={ui.colors.primary}
                />
              </View>

              <TextInput
                label="Descuento (%)"
                value={item.discountPercent}
                onChangeText={(value) =>
                  setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'margin', { discountPercent: value }) : x)))
                }
                onBlur={() => setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'margin') : x)))}
                mode="outlined"
                keyboardType="decimal-pad"
                style={styles.input}
                outlineColor={ui.colors.border}
                activeOutlineColor={ui.colors.primary}
              />

              <View style={styles.row}>
                <TextInput
                  label="Ganancia (%)"
                  value={item.saleMarginPercent}
                  onChangeText={(value) =>
                    setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'margin', { saleMarginPercent: value }) : x)))
                  }
                  onBlur={() => setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'margin') : x)))}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  outlineColor={ui.colors.border}
                  activeOutlineColor={ui.colors.primary}
                />
                <TextInput
                  label="Precio de venta (RD$)"
                  value={item.salePrice}
                  onChangeText={(value) =>
                    setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'price', { salePrice: value }) : x)))
                  }
                  onBlur={() => setItems((prev) => prev.map((x, i) => (i === index ? recalcItemPricing(x, 'price') : x)))}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                  outlineColor={ui.colors.border}
                  activeOutlineColor={ui.colors.primary}
                />
              </View>
            </View>
          ))}
        </View>}

        {!creditHasActivePayments && <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total estimado</Text>
          <Text style={styles.totalValue}>{formatCurrency(totalCents)}</Text>
        </View>}

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading || loadingInitialData || creditSubmissionPending}
          buttonColor={ui.colors.primary}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          {creditSubmissionPending ? 'Confirmación pendiente' : creditHasActivePayments ? 'Guardar notas y vencimiento' : isEditMode ? 'Guardar Cambios' : 'Guardar Compra'}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingBottom: 30 },
  header: { marginBottom: 10 },
  headerTitle: { color: ui.colors.text, fontSize: 25, fontWeight: '800' },
  headerSubtitle: { color: ui.colors.textMuted, marginTop: 4 },
  card: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  sectionTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInput: { flex: 1 },
  scanButton: {
    width: 48,
    height: 48,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#EEE1FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  halfInput: { flex: 1 },
  selectLike: {
    minHeight: 56,
    borderRadius: ui.radius.md,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectLikeText: { color: '#111827', fontSize: 14, flex: 1, marginRight: 8 },
  addItemButton: { borderColor: ui.colors.primary, marginBottom: 10 },
  itemCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 10,
    backgroundColor: '#FBFAFD',
  },
  selectedProduct: { color: ui.colors.primary, fontSize: 12, fontWeight: '700', marginBottom: 10 },
  selectedProductRef: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 10, marginTop: -6 },
  suggestionBox: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: '#fff',
    marginBottom: 10,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
  },
  suggestionTitle: { color: ui.colors.text, fontSize: 14, fontWeight: '700' },
  suggestionMeta: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  suggestionEmpty: { color: ui.colors.textMuted, paddingHorizontal: 12, paddingVertical: 12 },
  itemTitle: { color: ui.colors.text, fontWeight: '700' },
  removeItemButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ui.colors.danger,
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  switchTextWrap: { flex: 1, paddingRight: 12 },
  switchLabel: { color: ui.colors.text, fontWeight: '700' },
  switchDescription: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  totalCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: { color: ui.colors.textMuted, fontSize: 13, fontWeight: '700' },
  totalValue: { color: ui.colors.text, fontSize: 22, fontWeight: '800' },
  saveButton: { borderRadius: ui.radius.md },
  saveButtonContent: { height: 50 },
});

