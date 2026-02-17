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
}

interface ProductOption {
  id: string;
  name: string;
  costCents: number;
}

interface PurchaseFormItem {
  key: string;
  productId: string | null;
  productName: string;
  productQuery: string;
  qty: string;
  unitCost: string;
  discountPercent: string;
}

function createEmptyItem(): PurchaseFormItem {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    productId: null,
    productName: '',
    productQuery: '',
    qty: '1',
    unitCost: '',
    discountPercent: '',
  };
}

export function AddPurchaseScreen({ navigation, route }: AddPurchaseScreenProps) {
  const purchaseId = route?.params?.purchaseId;
  const isEditMode = !!purchaseId;

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [updateProductCost, setUpdateProductCost] = useState(true);
  const [items, setItems] = useState<PurchaseFormItem[]>([createEmptyItem()]);

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [supplierMenuVisible, setSupplierMenuVisible] = useState(false);
  const [activeProductSearchIndex, setActiveProductSearchIndex] = useState<number | null>(null);

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
          }));
          const productsRows = (productsResp.data?.data || []).map((p: any) => ({
            id: String(p.id),
            name: String(p.name || ''),
            costCents: Number(p.costCents || 0),
          }));
          if (!isMounted) return;
          setSuppliers(suppliersRows);
          setProducts(productsRows);

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
                  productQuery: '',
                  qty: String(Number(item.qty || 0)),
                  unitCost: String(Number(item.unitCostCents || 0) / 100),
                  discountPercent: item.discountPercentBp ? String(Number(item.discountPercentBp) / 100) : defaultDiscountPercent,
                }))
              );
            } else {
              setItems([createEmptyItem()]);
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

  const addItem = () => setItems((prev) => [...prev, createEmptyItem()]);
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const filteredProducts = (item: PurchaseFormItem) => {
    const query = (item.productQuery || '').trim().toLowerCase();
    if (!query) return products.slice(0, 8);
    return products
      .filter((product) => product.name.toLowerCase().includes(query))
      .slice(0, 8);
  };

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) || null;
  const selectedSupplierDiscountPercent =
    selectedSupplier && Number(selectedSupplier.discountPercentBp || 0) > 0
      ? String(Number(selectedSupplier.discountPercentBp || 0) / 100)
      : '';

  const totalCents = useMemo(() => {
    const supplierDiscountBp = selectedSupplier?.discountPercentBp || 0;
    const supplierChargesItbis = selectedSupplier ? Boolean(selectedSupplier.chargesItbis) : true;

    return items.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const unitCostCents = Math.round(Number((item.unitCost || '0').replace(',', '.')) * 100);
      const itemDiscountRaw = (item.discountPercent || '').trim();
      const itemDiscountBp =
        itemDiscountRaw.length > 0
          ? Math.max(0, Math.round(Number(itemDiscountRaw.replace(',', '.')) * 100))
          : supplierDiscountBp;
      if (!Number.isFinite(qty) || !Number.isFinite(unitCostCents) || qty <= 0 || unitCostCents < 0) return sum;

      const discountedCost = unitCostCents * (1 - itemDiscountBp / 10000);
      const netUnitCost = supplierChargesItbis ? discountedCost * 1.18 : discountedCost;
      return sum + Math.round(netUnitCost * qty);
    }, 0);
  }, [items, selectedSupplier]);

  const handleSave = async () => {
    if (!supplierId) {
      Alert.alert('Error', 'Debes seleccionar un proveedor para guardar la compra.');
      return;
    }

    const normalizedItems = items.map((item) => {
      const qty = Number(item.qty || 0);
      const unitCost = Number((item.unitCost || '0').replace(',', '.'));
      const unitCostCents = Math.round(unitCost * 100);
      const discountRaw = (item.discountPercent || '').trim();
      const discountPercent = Number(discountRaw.replace(',', '.'));
      const hasDiscount = discountRaw.length > 0 && Number.isFinite(discountPercent) && discountPercent > 0;
      const discountPercentBp = hasDiscount ? Math.round(discountPercent * 100) : undefined;
      return {
        productId: item.productId,
        qty,
        unitCostCents,
        discountPercentBp,
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
        supplierId,
        supplierName: supplierName.trim() || null,
        notes: notes.trim() || null,
        updateProductCost,
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
                  const supplierDiscountText =
                    Number(supplier.discountPercentBp || 0) > 0 ? String(Number(supplier.discountPercentBp || 0) / 100) : '';
                  if (supplierDiscountText) {
                    setItems((prev) =>
                      prev.map((item) =>
                        item.discountPercent.trim().length === 0 ? { ...item, discountPercent: supplierDiscountText } : item
                      )
                    );
                  }
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
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Productos</Text>
            <Button mode="outlined" compact onPress={addItem} textColor={ui.colors.primary} style={styles.addItemButton}>
              Agregar
            </Button>
          </View>

          {items.map((item, index) => (
            <View key={item.key} style={styles.itemCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemTitle}>Producto #{index + 1}</Text>
                {items.length > 1 ? (
                  <TouchableOpacity onPress={() => removeItem(index)}>
                    <Icon source="close" size={18} color={ui.colors.danger} />
                  </TouchableOpacity>
                ) : null}
              </View>

              <TextInput
                label="Buscar producto"
                value={item.productQuery}
                onFocus={() => setActiveProductSearchIndex(index)}
                onChangeText={(value) => {
                  updateItem(index, { productQuery: value });
                  setActiveProductSearchIndex(index);
                }}
                mode="outlined"
                style={styles.input}
                outlineColor={ui.colors.border}
                activeOutlineColor={ui.colors.primary}
                right={
                  item.productName ? (
                    <TextInput.Icon
                      icon="close-circle"
                      onPress={() =>
                        updateItem(index, {
                          productId: null,
                          productName: '',
                          productQuery: '',
                        })
                      }
                    />
                  ) : undefined
                }
              />

              {item.productName ? <Text style={styles.selectedProduct}>Seleccionado: {item.productName}</Text> : null}

              {activeProductSearchIndex === index ? (
                <View style={styles.suggestionBox}>
                  {filteredProducts(item).length === 0 ? <Text style={styles.suggestionEmpty}>Sin resultados</Text> : null}
                  {filteredProducts(item).map((product) => (
                    <TouchableOpacity
                      key={`${item.key}_${product.id}`}
                      style={styles.suggestionItem}
                      onPress={() => {
                        updateItem(index, {
                          productId: product.id,
                          productName: product.name,
                          productQuery: product.name,
                          unitCost: (product.costCents / 100).toString(),
                          ...(item.discountPercent.trim().length === 0 && selectedSupplierDiscountPercent
                            ? { discountPercent: selectedSupplierDiscountPercent }
                            : {}),
                        });
                        setActiveProductSearchIndex(null);
                      }}
                    >
                      <Text style={styles.suggestionTitle}>{product.name}</Text>
                      <Text style={styles.suggestionMeta}>Costo base: {formatCurrency(product.costCents)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

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
                  onChangeText={(value) => updateItem(index, { unitCost: value })}
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
                onChangeText={(value) => updateItem(index, { discountPercent: value })}
                mode="outlined"
                keyboardType="decimal-pad"
                style={styles.input}
                outlineColor={ui.colors.border}
                activeOutlineColor={ui.colors.primary}
              />
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
