import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Menu, Icon, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface AddPurchaseScreenProps {
  navigation: any;
  route: any;
}

interface SupplierOption {
  id: string;
  name: string;
  discountPercentBp?: number;
  chargesItbis?: boolean;
  itbisRateBp?: number | null;
}

interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
  reference?: string | null;
  costCents: number;
  priceCents: number;
  itbisRateBp: number;
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

function createEmptyItem(defaultSaleMarginPercent = ''): PurchaseFormItem {
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeDiscountBp = (discountBp: number | null | undefined) => {
  const raw = Number.isFinite(Number(discountBp)) ? Number(discountBp) : 0;
  return clamp(Math.round(raw), 0, 10000);
};
const normalizeItbisRateBp = (rateBp: number | null | undefined) => {
  const raw = Number.isFinite(Number(rateBp)) ? Number(rateBp) : 1800;
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
  const [items, setItems] = useState<PurchaseFormItem[]>([createEmptyItem('30')]);
  const [purchaseItbisRateBp, setPurchaseItbisRateBp] = useState(1800);
  const [defaultSaleMarginPercent, setDefaultSaleMarginPercent] = useState('30');

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [supplierMenuVisible, setSupplierMenuVisible] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();

  const resolveHeaders = async () => {
    const clerkToken = await getToken();
    if (!clerkToken || !subUserToken) throw new Error('No hay sesión activa');
    return {
      Authorization: `Bearer ${clerkToken}`,
      'X-Clerk-Authorization': `Bearer ${clerkToken}`,
      'X-SubUser-Token': subUserToken,
      ...(accountId ? { 'X-Account-Id': accountId } : {}),
    };
  };

  const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';

  useFocusEffect(
    useCallback(() => {
      const focusLoadKey = `${purchaseId || 'new'}:${accountId || ''}:${subUserToken || ''}`;
      if (lastFocusLoadKeyRef.current === focusLoadKey) return;
      lastFocusLoadKeyRef.current = focusLoadKey;

      let isMounted = true;
      const loadInitial = async () => {
        setLoadingInitialData(true);
        let resolvedDefaultSaleMarginPercent = '30';
        try {
          const headers = await resolveHeaders();
          const [suppliersResp, productsResp] = await Promise.all([
            axios.get(`${API_URL}/api/suppliers`, { headers }),
            axios.get(`${API_URL}/api/products`, { headers, params: { take: 200 } }),
          ]);

          const suppliersRows = (suppliersResp.data?.data || []).map((s: any) => ({
            id: String(s.id),
            name: String(s.name || ''),
            discountPercentBp: Number(s.discountPercentBp || 0),
            chargesItbis: Boolean(s.chargesItbis),
            itbisRateBp:
              s.itbisRateBp === null || s.itbisRateBp === undefined
                ? null
                : Number(s.itbisRateBp || 0),
          }));
          const productsRows = (productsResp.data?.data || []).map((p: any) => ({
            id: String(p.id),
            name: String(p.name || ''),
            sku: p.sku ? String(p.sku) : null,
            reference: p.reference ? String(p.reference) : null,
            costCents: Number(p.costCents || 0),
            priceCents: Number(p.priceCents || 0),
            itbisRateBp: Number(p.itbisRateBp || 1800),
          }));
          if (!isMounted) return;
          setSuppliers(suppliersRows);
          setProducts(productsRows);
          try {
            const settingsResp = await axios.get(`${API_URL}/api/company-settings`, { headers });
            const nextRate = Number(settingsResp.data?.itbisRateBp);
            const nextMarginBp = Number(settingsResp.data?.defaultProfitMarginBp);
            if (Number.isFinite(nextRate) && nextRate >= 0) {
              setPurchaseItbisRateBp(Math.round(nextRate));
            } else {
              setPurchaseItbisRateBp(1800);
            }
            const normalizedMarginPercent =
              Number.isFinite(nextMarginBp) && nextMarginBp >= 0 ? String(Number(nextMarginBp) / 100) : '30';
            resolvedDefaultSaleMarginPercent = normalizedMarginPercent;
            setDefaultSaleMarginPercent(normalizedMarginPercent);
            if (!isEditMode) {
              setItems((prev) =>
                prev.map((item) =>
                  item.saleMarginPercent.trim().length === 0 ? { ...item, saleMarginPercent: normalizedMarginPercent } : item
                )
              );
            }
          } catch {
            setPurchaseItbisRateBp(1800);
            setDefaultSaleMarginPercent('30');
            resolvedDefaultSaleMarginPercent = '30';
          }

          if (isEditMode) {
            const purchaseResp = await axios.get(`${API_URL}/api/purchases/${purchaseId}`, { headers });
            const purchase = purchaseResp.data || {};
            const purchaseSupplierName = String(purchase.supplierName || '');
            if (!isMounted) return;
            setSupplierName(purchaseSupplierName);
            const matchedSupplier = suppliersRows.find((s: SupplierOption) => s.name.toLowerCase() === purchaseSupplierName.toLowerCase());
            setSupplierId(matchedSupplier?.id || null);
            setNotes(String(purchase.notes || ''));
            setUpdateProductCost(true);

            const loadedItems = Array.isArray(purchase.items) ? purchase.items : [];
            if (loadedItems.length > 0) {
              const defaultDiscountPercent =
                matchedSupplier && Number(matchedSupplier.discountPercentBp || 0) > 0
                  ? String(Number(matchedSupplier.discountPercentBp || 0) / 100)
                  : '';
              setItems(
                loadedItems.map((item: any) => ({
                  key: `${item.id || item.productId}_${Math.random().toString(36).slice(2, 6)}`,
                  productId: String(item.productId || ''),
                  productName: String(item.productName || productsRows.find((p: ProductOption) => p.id === String(item.productId || ''))?.name || ''),
                  qty: String(Number(item.qty || 0)),
                  unitCost: String(Number(item.unitCostCents || 0) / 100),
                  discountPercent: item.discountPercentBp ? String(Number(item.discountPercentBp) / 100) : defaultDiscountPercent,
                  saleMarginPercent:
                    item.saleMarginBp !== null && item.saleMarginBp !== undefined
                      ? String(Number(item.saleMarginBp) / 100)
                      : resolvedDefaultSaleMarginPercent,
                  salePrice:
                    item.salePriceCents !== null && item.salePriceCents !== undefined && Number(item.salePriceCents) > 0
                      ? String(Number(item.salePriceCents) / 100)
                      : '',
                }))
              );
            } else {
              setItems([createEmptyItem(resolvedDefaultSaleMarginPercent)]);
            }
          }
        } catch (error: any) {
          if (!isMounted) return;
          console.error('Error cargando datos de compra:', error);
          const apiError = error?.response?.data?.error;
          Alert.alert('Error', apiError ? String(apiError) : 'No se pudo cargar la compra');
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
    }, [accountId, isEditMode, navigation, purchaseId, subUserToken])
  );

  const updateItem = (index: number, patch: Partial<PurchaseFormItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addItem = () => setItems((prev) => [...prev, createEmptyItem(defaultSaleMarginPercent)]);
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const filteredProducts = () => {
    const query = productSearchQuery.trim().toLowerCase();
    if (!query) return products.slice(0, 8);
    return products
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
    if (supplier?.chargesItbis) return supplier.itbisRateBp ?? purchaseItbisRateBp;
    return purchaseItbisRateBp;
  };
  const defaultSaleMarginBp = normalizeMarginBp(parseNumberFromInput(defaultSaleMarginPercent) * 100);

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
      const targetItem = emptyIdx >= 0 ? prev[emptyIdx] : createEmptyItem(defaultSaleMarginPercent);

      const patch: Partial<PurchaseFormItem> = {
        productId: product.id,
        productName: product.name,
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

  const totalCents = useMemo(() => {
    const supplierDiscountBp = selectedSupplier?.discountPercentBp || 0;
    const supplierChargesItbis = selectedSupplier ? Boolean(selectedSupplier.chargesItbis) : true;
    const normalizedPurchaseItbisRateBp = normalizeItbisRateBp(
      supplierChargesItbis ? selectedSupplier?.itbisRateBp ?? purchaseItbisRateBp : purchaseItbisRateBp
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
  }, [items, purchaseItbisRateBp, selectedSupplier]);

  const handleSave = async () => {
    if (!supplierId || !selectedSupplier) {
      Alert.alert('Error', 'Debes seleccionar un proveedor para guardar la compra.');
      return;
    }

    const normalizedItems = items.map((item) => {
      const qty = Number(item.qty || 0);
      const unitCostCents = toCents(item.unitCost);
      const discountRaw = (item.discountPercent || '').trim();
      const discountPercent = parseNumberFromInput(discountRaw);
      const hasDiscount = discountRaw.length > 0 && Number.isFinite(discountPercent) && discountPercent > 0;
      const discountPercentBp = hasDiscount ? Math.round(discountPercent * 100) : undefined;
      const saleMarginRaw = (item.saleMarginPercent || '').trim();
      const saleMarginPercent = parseNumberFromInput(saleMarginRaw);
      const hasSaleMargin = saleMarginRaw.length > 0 && Number.isFinite(saleMarginPercent) && saleMarginPercent >= 0;
      const saleMarginBp = hasSaleMargin ? Math.round(saleMarginPercent * 100) : undefined;
      const salePriceRaw = (item.salePrice || '').trim();
      const salePrice = parseNumberFromInput(salePriceRaw);
      const hasSalePrice = salePriceRaw.length > 0 && Number.isFinite(salePrice) && salePrice > 0;
      const salePriceCents = hasSalePrice ? Math.round(salePrice * 100) : undefined;
      return {
        productId: item.productId,
        qty,
        unitCostCents,
        discountPercentBp,
        saleMarginBp,
        salePriceCents,
        purchaseIncludesItbis: Boolean(selectedSupplier.chargesItbis),
      };
    });

    if (normalizedItems.some((item) => !item.productId || item.qty <= 0 || item.unitCostCents < 0)) {
      Alert.alert('Error', 'Completa correctamente los productos, cantidades y costos.');
      return;
    }

    setLoading(true);
    try {
      const headers = await resolveHeaders();
      const payload = {
        supplierId: supplierId || null,
        supplierName: supplierName.trim() || null,
        notes: notes.trim() || null,
        updateProductCost,
        updateProductPrice,
        items: normalizedItems,
      };

      if (isEditMode) {
        await axios.put(`${API_URL}/api/purchases/${purchaseId}`, payload, { headers });
      } else {
        await axios.post(`${API_URL}/api/purchases`, payload, { headers });
      }

      Alert.alert('Éxito', isEditMode ? 'Compra actualizada correctamente' : 'Compra creada correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      console.error(isEditMode ? 'Error actualizando compra:' : 'Error creando compra:', error);
      const apiError = error?.response?.data?.error;
      Alert.alert('Error', apiError ? String(apiError) : isEditMode ? 'No se pudo actualizar la compra' : 'No se pudo crear la compra');
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
            <Menu.Item
              title="Sin proveedor"
              onPress={() => {
                setSupplierId(null);
                setSupplierName('');
                recalcAllItemsForSupplier(null);
                setSupplierMenuVisible(false);
              }}
            />
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
