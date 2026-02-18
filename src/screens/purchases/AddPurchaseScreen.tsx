import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Menu, Icon, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { formatCurrency, generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';

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
}

interface PurchaseStoredItem {
  id?: string | null;
  productId: string;
  productServerId?: string | null;
  productName?: string;
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

  if (input.salePriceCents !== null && input.salePriceCents !== undefined && Number.isFinite(Number(input.salePriceCents))) {
    const salePriceCents = Math.max(0, Math.round(Number(input.salePriceCents)));
    const saleNoItbisCents =
      appliedItbisRateBp > 0 ? Math.round(salePriceCents / (1 + appliedItbisRateBp / 10000)) : salePriceCents;
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
    appliedItbisRateBp > 0 ? Math.round(saleNoItbisCents * (1 + appliedItbisRateBp / 10000)) : saleNoItbisCents;

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
  const [updateProductCost, setUpdateProductCost] = useState(true);
  const [updateProductPrice, setUpdateProductPrice] = useState(true);
  const [items, setItems] = useState<PurchaseFormItem[]>([createEmptyItem()]);

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [supplierMenuVisible, setSupplierMenuVisible] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [persistedLocalId, setPersistedLocalId] = useState<string | null>(null);
  const [persistedServerId, setPersistedServerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();
  const { isOnline } = useSyncStore();
  const isOnlineRef = useRef(isOnline);
  const getTokenRef = useRef(getToken);
  const subUserTokenRef = useRef(subUserToken);
  const accountIdRef = useRef(accountId);
  isOnlineRef.current = isOnline;
  getTokenRef.current = getToken;
  subUserTokenRef.current = subUserToken;
  accountIdRef.current = accountId;

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
      data: string | null;
    }>(
      `SELECT local_id, server_id, name, discount_percent_bp, charges_itbis, itbis_rate_bp, data
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
      data: string | null;
    }>(
      `SELECT local_id, server_id, name, sku, cost_cents, price_cents, data
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
        } as ProductOption;
      })
      .filter((product) => product.name.length > 0);

    setSuppliers(nextSuppliers);
    setProducts(nextProducts);

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
      const parsedItems = normalizeStoredItems(parsed?.items);
      const serverId =
        asString(row.server_id) || asString(parsed?.serverId) || asString(parsed?.id);
      const supplierFromPayloadId = asString(parsed?.supplierId);
      const supplierFromPayloadServerId = asString(parsed?.supplierServerId);
      const supplierNameFromPayload = asString(parsed?.supplierName) || asString(row.supplier_name) || '';

      const matchedSupplier =
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
      setUpdateProductCost(asBoolean(parsed?.updateProductCost, true));
      setUpdateProductPrice(asBoolean(parsed?.updateProductPrice, true));

      if (parsedItems.length === 0) {
        setItems([createEmptyItem()]);
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
          qty: String(Number(item.qty || 0)),
          unitCost: String(Number(item.unitCostCents || 0) / 100),
          discountPercent:
            item.discountPercentBp !== null && item.discountPercentBp !== undefined
              ? String(Number(item.discountPercentBp) / 100)
              : defaultDiscountPercent,
          saleMarginPercent:
            item.saleMarginBp !== null && item.saleMarginBp !== undefined
              ? String(Number(item.saleMarginBp) / 100)
              : DEFAULT_SALE_MARGIN_PERCENT,
          salePrice:
            item.salePriceCents !== null && item.salePriceCents !== undefined && Number(item.salePriceCents) > 0
              ? String(Number(item.salePriceCents) / 100)
              : '',
        } as PurchaseFormItem;
      });

      setItems(mappedItems.length > 0 ? mappedItems : [createEmptyItem()]);
    },
    [isEditMode, navigation, purchaseId, resolveLocalProductId]
  );

  const syncBestEffort = useCallback(async (): Promise<boolean> => {
    if (!isOnlineRef.current) return false;

    const clerkToken = await getTokenRef.current();
    const currentSubUserToken = useAuthStore.getState().subUserToken;
    if (!clerkToken || !currentSubUserToken) return false;

    syncService.setGetTokenFunction(() => getTokenRef.current());
    syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
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
          let catalog = await loadLocalCatalogsRef.current();
          if (isOnlineRef.current) {
            const synced = await syncBestEffort();
            if (synced) {
              catalog = await loadLocalCatalogsRef.current();
            }
          }
          if (!isMounted) return;

          if (isEditMode) {
            await loadLocalPurchaseForEditRef.current(catalog);
          } else {
            setPersistedLocalId(null);
            setPersistedServerId(null);
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

  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);
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
    const purchaseIncludesItbis = selectedSupplier ? Boolean(selectedSupplier.chargesItbis) : true;
    const purchaseItbisForSupplier = getPurchaseItbisRateBp(selectedSupplier);
    const saleMarginBp = normalizeMarginBp(parseNumberFromInput(nextItem.saleMarginPercent) * 100);
    const salePriceCents = Math.max(0, toCents(nextItem.salePrice));

    const pricing = resolvePurchaseSalePricingMobile({
      unitCostCents,
      discountPercentBp: itemDiscountBp,
      purchaseIncludesItbis,
      purchaseItbisRateBp: purchaseItbisForSupplier,
      productItbisRateBp: product?.itbisRateBp ?? 0,
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
      const targetItem = emptyIdx >= 0 ? prev[emptyIdx] : createEmptyItem();

      const patch: Partial<PurchaseFormItem> = {
        productId: product.id,
        productName: product.name,
        unitCost: (product.costCents / 100).toString(),
        ...(targetItem.discountPercent.trim().length === 0 && selectedSupplierDiscountPercent
          ? { discountPercent: selectedSupplierDiscountPercent }
          : {}),
        ...(targetItem.saleMarginPercent.trim().length === 0 && DEFAULT_SALE_MARGIN_PERCENT
          ? { saleMarginPercent: DEFAULT_SALE_MARGIN_PERCENT }
          : {}),
      };

      if (emptyIdx >= 0) {
        return prev.map((x, i) => (i === emptyIdx ? recalcItemPricing(x, 'margin', patch) : x));
      }

      return [...prev, recalcItemPricing(createEmptyItem(), 'margin', patch)];
    });
  };

  const totalCents = useMemo(() => {
    const supplierDiscountBp = selectedSupplier?.discountPercentBp || 0;
    const supplierChargesItbis = selectedSupplier ? Boolean(selectedSupplier.chargesItbis) : true;
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
      options: { updateCost: boolean; updatePrice: boolean }
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
        await db.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [delta, localProductId]);
      }

      if (!options.updateCost && !options.updatePrice) return;

      for (const [localProductId, pricing] of latestPricingByProduct.entries()) {
        const row = await db.queryFirst<{ data: string | null }>(
          `SELECT data
           FROM products
           WHERE local_id = ?
           LIMIT 1`,
          [localProductId]
        );

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
          await db.update('products', localProductId, patch);
        }
      }
    },
    [resolveLocalProductId]
  );

  const handleSave = async () => {
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
        defaultSaleMarginBp,
        saleMarginBp: parsedSalePriceCents !== undefined ? undefined : parsedSaleMarginBp,
        salePriceCents: parsedSalePriceCents,
      });

      return {
        productId: String(item.productId || ''),
        productServerId: matchedProduct?.serverId || null,
        productName: item.productName || matchedProduct?.name || 'Producto',
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

    setLoading(true);
    try {
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
        notes: notes.trim() || null,
        totalCents: computedTotalCents,
        purchasedAt,
        cancelledAt,
        itemsCount: normalizedItems.length,
        items: normalizedItems,
        updateProductCost,
        updateProductPrice,
      };

      await applyPurchaseEffectsLocally(previousItems, normalizedItems, {
        updateCost: updateProductCost,
        updatePrice: updateProductPrice,
      });

      const rowPatch = {
        server_id: serverId,
        supplier_name: selectedSupplier.name,
        total_cents: computedTotalCents,
        purchased_at: purchasedAt,
        cancelled_at: cancelledAt,
        synced: 0,
        data: JSON.stringify(purchaseData),
      };

      if (isEditMode) {
        await db.update('purchases', localId, rowPatch);
      } else {
        await db.insert('purchases', {
          local_id: localId,
          ...rowPatch,
        });
      }

      const queuePayload = {
        ...(serverId ? { id: serverId } : {}),
        supplierId: selectedSupplier.id,
        supplierServerId: selectedSupplier.serverId,
        supplierName: selectedSupplier.name,
        notes: notes.trim() || null,
        updateProductCost,
        updateProductPrice,
        items: normalizedItems.map((item) => ({
          productId: item.productId,
          productServerId: item.productServerId || null,
          qty: item.qty,
          unitCostCents: item.unitCostCents,
          ...(typeof item.discountPercentBp === 'number' ? { discountPercentBp: item.discountPercentBp } : {}),
          ...(typeof item.saleMarginBp === 'number' ? { saleMarginBp: item.saleMarginBp } : {}),
          ...(typeof item.salePriceCents === 'number' ? { salePriceCents: item.salePriceCents } : {}),
          purchaseIncludesItbis: item.purchaseIncludesItbis !== false,
        })),
      };

      syncService.setGetTokenFunction(getToken);
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);

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
      Alert.alert('Error', isEditMode ? 'No se pudo guardar la compra' : 'No se pudo crear la compra');
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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Proveedor y Notas</Text>
          <Menu
            visible={supplierMenuVisible}
            onDismiss={() => setSupplierMenuVisible(false)}
            anchor={
              <TouchableOpacity style={styles.selectLike} onPress={() => setSupplierMenuVisible(true)}>
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
                  recalcAllItemsForSupplier(supplier);
                  setSupplierMenuVisible(false);
                }}
              />
            ))}
          </Menu>

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

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchLabel}>Actualizar costo de productos</Text>
              <Text style={styles.switchDescription}>Si activas esto, el costo de cada producto se actualizará con el costo neto de esta compra.</Text>
            </View>
            <Switch value={updateProductCost} onValueChange={setUpdateProductCost} color={ui.colors.primary} />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchLabel}>Actualizar precio de venta</Text>
              <Text style={styles.switchDescription}>Si activas esto, el precio de venta se recalculará con la lógica de márgenes del sistema.</Text>
            </View>
            <Switch value={updateProductPrice} onValueChange={setUpdateProductPrice} color={ui.colors.primary} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Productos</Text>
            <Button mode="outlined" compact onPress={addItem} textColor={ui.colors.primary} style={styles.addItemButton}>
              Agregar
            </Button>
          </View>

          <TextInput
            label="Buscar producto"
            value={productSearchQuery}
            onChangeText={setProductSearchQuery}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

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
                <Text style={styles.selectedProduct}>Producto: {item.productName}</Text>
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
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total estimado</Text>
          <Text style={styles.totalValue}>{formatCurrency(totalCents)}</Text>
        </View>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading || loadingInitialData}
          buttonColor={ui.colors.primary}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          {isEditMode ? 'Guardar Cambios' : 'Guardar Compra'}
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
