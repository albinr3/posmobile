import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Image, Modal, FlatList } from 'react-native';
import { TextInput, Button, Text, Icon, Menu, Divider, Switch } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useAuthStore } from '../../store/authStore';
import { PRODUCT_UNIT_OPTIONS, getUnitAbbreviation, type MobileProductKind, unitAllowsDecimals } from '../../utils/productUnits';

interface AddProductScreenProps {
  navigation: any;
}

interface OptionItem {
  id: string;
  name: string;
  internalId?: string | null;
}

type DuplicateSkuInfo = {
  sku: string;
  productName: string;
};

const CREATE_PRODUCT_KIND_OPTIONS: Array<{ value: MobileProductKind; label: string }> = [
  { value: 'BASIC', label: 'Básico' },
  { value: 'MEASURED', label: 'Con medida' },
  { value: 'RECIPE', label: 'Por receta' },
];

export function AddProductScreen({ navigation }: AddProductScreenProps) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [reference, setReference] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string>('');
  const [suppliers, setSuppliers] = useState<OptionItem[]>([]);
  const [categories, setCategories] = useState<OptionItem[]>([]);
  const [supplierMenuVisible, setSupplierMenuVisible] = useState(false);
  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('5');
  const [productKind, setProductKind] = useState<MobileProductKind>('BASIC');
  const [unit, setUnit] = useState('KG');
  const [unitMenuVisible, setUnitMenuVisible] = useState(false);
  const [taxRate, setTaxRate] = useState<'18' | '16' | '0'>('18');
  const [isAvailableForSale, setIsAvailableForSale] = useState(true);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiNextProductId, setApiNextProductId] = useState<string>('Cargando...');
  const [idLoading, setIdLoading] = useState(false);
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const nextIdLoadedRef = useRef(false);
  const catalogsLoadedRef = useRef(false);
  const savingRef = useRef(false);
  const [recipeItems, setRecipeItems] = useState<{ id: string; ingredientId: string; qty: string }[]>([]);
  const [availableIngredients, setAvailableIngredients] = useState<any[]>([]);
  const [ingredientPickerVisible, setIngredientPickerVisible] = useState(false);
  const [currentIngredientId, setCurrentIngredientId] = useState<string | null>(null);
  const [ingredientSearchQuery, setIngredientSearchQuery] = useState('');

  const activeUnit = productKind === 'MEASURED' ? unit : 'UNIDAD';
  const stockStep = unitAllowsDecimals(activeUnit) ? 0.5 : 1;

  const findDuplicateSkuLocally = useCallback(async (rawSku: string): Promise<DuplicateSkuInfo | null> => {
    const normalizedSku = String(rawSku || '').trim();
    if (!normalizedSku) return null;
    const existing = await db.queryFirst<{ name?: string; sku?: string }>(
      `SELECT name, sku
       FROM products
       WHERE sku IS NOT NULL
         AND TRIM(sku) <> ''
         AND LOWER(TRIM(sku)) = LOWER(?)
       LIMIT 1`,
      [normalizedSku]
    );
    if (!existing?.name) return null;
    return {
      sku: existing.sku ? String(existing.sku).trim() : normalizedSku,
      productName: String(existing.name).trim(),
    };
  }, []);

  const findDuplicateSkuInApi = useCallback(async (rawSku: string): Promise<DuplicateSkuInfo | null> => {
    const normalizedSku = String(rawSku || '').trim();
    if (!normalizedSku || !subUserToken) return null;
    const clerkToken = await getToken();
    if (!clerkToken) return null;

    const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
    try {
      const response = await axios.get(`${API_URL}/api/products`, {
        params: { query: normalizedSku, take: 25 },
        headers: {
          Authorization: `Bearer ${clerkToken}`,
          'X-Clerk-Authorization': `Bearer ${clerkToken}`,
          'X-SubUser-Token': subUserToken,
          ...(accountId ? { 'X-Account-Id': accountId } : {}),
        },
        timeout: 10000,
      });
      const list = Array.isArray(response.data?.data)
        ? response.data.data
        : Array.isArray(response.data)
          ? response.data
          : [];
      const match = list.find((item: any) => String(item?.sku || '').trim().toLowerCase() === normalizedSku.toLowerCase());
      if (!match) return null;
      return {
        sku: String(match?.sku || normalizedSku).trim(),
        productName: String(match?.name || '').trim(),
      };
    } catch (error) {
      console.warn('No se pudo validar SKU duplicado contra API:', error);
      return null;
    }
  }, [accountId, getToken, subUserToken]);

  const parseDuplicateSkuFromApiError = useCallback((error: unknown): DuplicateSkuInfo | null => {
    if (!axios.isAxiosError(error)) return null;
    const status = Number(error.response?.status || 0);
    if (status !== 409 && status !== 400 && status !== 422 && status !== 500) return null;

    const responseData = error.response?.data || {};
    const message = String(
      responseData?.error ||
      responseData?.message ||
      error.message ||
      ''
    );
    const lowered = message.toLowerCase();
    const skuMentioned = lowered.includes('sku');
    const duplicateMentioned = lowered.includes('duplic') || lowered.includes('ya existe') || lowered.includes('ya está en uso');
    if (!skuMentioned || !duplicateMentioned) return null;

    const existingProduct =
      responseData?.existingProduct ||
      responseData?.data?.existingProduct ||
      null;
    const apiSku = String(
      existingProduct?.sku ||
      responseData?.sku ||
      ''
    ).trim();
    const apiName = String(
      existingProduct?.name ||
      responseData?.existingProductName ||
      ''
    ).trim();

    const extractedSku = (() => {
      if (apiSku) return apiSku;
      const quotedMatch = message.match(/SKU\s*"([^"]+)"/i) || message.match(/SKU\s*'([^']+)'/i);
      return quotedMatch?.[1] ? String(quotedMatch[1]).trim() : String(sku || '').trim();
    })();

    const extractedName = (() => {
      if (apiName) return apiName;
      const namedProductMatch = message.match(/\(([^)]+)\)/);
      if (namedProductMatch?.[1]) return String(namedProductMatch[1]).trim();
      return '';
    })();

    return {
      sku: extractedSku || String(sku || '').trim(),
      productName: extractedName,
    };
  }, [sku]);

  const resolveNextIdFromResponse = (payload: any): string | null => {
    const source = payload?.data ?? payload;
    const candidates = [
      source?.nextId,
      source?.nextID,
      source?.nextCode,
      source?.nextProductId,
      source?.nextProductCode,
      source?.id,
      source?.code,
      source?.productId,
      source?.productCode,
    ];
    for (const value of candidates) {
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return null;
  };

  const loadNextProductId = useCallback(async (force = false) => {
    if (idLoading && !force) return;
    try {
      setIdLoading(true);
      if (force) setApiNextProductId('Cargando...');
      const clerkToken = await getToken();
      if (!clerkToken || !subUserToken) {
        setApiNextProductId('No disponible');
        return;
      }

      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };
      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const candidates = ['/api/products/next-id', '/api/products/next-code', '/api/products/next'];

      for (const path of candidates) {
        try {
          const response = await axios.get(`${API_URL}${path}`, { headers });
          const nextId = resolveNextIdFromResponse(response.data);
          if (nextId) {
            setApiNextProductId(nextId);
            return;
          }
        } catch {
          // intentar siguiente endpoint candidato
        }
      }

      // Fallback: calcular siguiente correlativo usando listado de productos de la API
      try {
        let cursor: string | undefined;
        let maxProductId = 0;
        let guard = 0;
        do {
          const response = await axios.get(`${API_URL}/api/products`, {
            headers,
            params: {
              take: 200,
              ...(cursor ? { cursor } : {}),
            },
          });
          const payload = response.data?.data || [];
          for (const item of payload) {
            const parsed = Number(item?.productId ?? 0);
            if (Number.isFinite(parsed) && parsed > maxProductId) {
              maxProductId = parsed;
            }
          }
          cursor = response.data?.nextCursor || undefined;
          guard += 1;
        } while (cursor && guard < 50);

        const nextFromList = maxProductId + 1;
        if (nextFromList > 0) {
          setApiNextProductId(`PROD-${String(nextFromList).padStart(4, '0')}`);
          return;
        }
      } catch (fallbackError) {
        console.error('Error fallback obteniendo próximo ID desde /api/products:', fallbackError);
      }

      setApiNextProductId('No disponible');
    } catch (error) {
      console.error('Error obteniendo próximo ID de producto:', error);
      setApiNextProductId('No disponible');
    } finally {
      setIdLoading(false);
    }
  }, [accountId, getToken, idLoading, subUserToken]);

  useEffect(() => {
    if (!subUserToken) return;
    if (nextIdLoadedRef.current) return;
    nextIdLoadedRef.current = true;
    loadNextProductId();
  }, [loadNextProductId, subUserToken]);

  const loadCatalogOptions = useCallback(async () => {
    try {
      setCatalogsLoading(true);
      const clerkToken = await getToken();
      if (!clerkToken || !subUserToken) {
        setSuppliers([]);
        setCategories([]);
        return;
      }
      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };

      const fetchFromCandidates = async (paths: string[]) => {
        for (const path of paths) {
          try {
            const response = await axios.get(`${API_URL}${path}`, { headers });
            return response.data?.data || [];
          } catch (error: any) {
            if (error?.response?.status !== 404) {
              throw error;
            }
          }
        }
        return [];
      };

      const [suppliersRaw, categoriesRaw] = await Promise.all([
        fetchFromCandidates(['/api/suppliers', '/api/providers', '/api/provider']),
        fetchFromCandidates(['/api/categories', '/api/category']),
      ]);

      const suppliersData = (suppliersRaw || []).map((s: any) => ({ id: String(s.id), name: String(s.name || '') }));
      const categoriesData = (categoriesRaw || [])
        .map((c: any) => ({
          id: String(c.id ?? c.categoryId ?? ''),
          name: String(c.name || ''),
          internalId: c.internalId ? String(c.internalId) : null,
        }))
        .filter((c: OptionItem) => !!c.id);
      setSuppliers(suppliersData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Error cargando proveedores/categorias:', error);
      setSuppliers([]);
      setCategories([]);
    } finally {
      setCatalogsLoading(false);
    }
  }, [accountId, getToken, subUserToken]);

  useEffect(() => {
    if (!subUserToken) return;
    if (catalogsLoadedRef.current) return;
    catalogsLoadedRef.current = true;
    loadCatalogOptions();
  }, [loadCatalogOptions, subUserToken]);

  const loadIngredients = useCallback(async () => {
    try {
      const rows = await db.query<any>('SELECT data, local_id FROM products ORDER BY name ASC');
      const ingredients = rows.map(r => {
        const content = JSON.parse(r.data);
        const id = content.id || r.local_id || content.localId;
        return {
          id,
          name: content.name,
          productId: content.productId || '?',
          unit: content.unit
        };
      });
      setAvailableIngredients(ingredients);
    } catch (err) {
      console.error('Error loading ingredients', err);
    }
  }, []);

  useEffect(() => {
    loadIngredients();
  }, [loadIngredients]);

  const openIngredientPicker = useCallback(async (recipeItemId: string) => {
    setCurrentIngredientId(recipeItemId);
    setIngredientSearchQuery('');
    await loadIngredients();
    setIngredientPickerVisible(true);
  }, [loadIngredients]);

  const filteredIngredients = useMemo(
    () => availableIngredients.filter(i => i.name.toLowerCase().includes(ingredientSearchQuery.toLowerCase())),
    [availableIngredients, ingredientSearchQuery]
  );

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se necesita acceso a la galería');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se necesita acceso a la cámara');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };

  const handleSave = async () => {
    // Guard síncrono contra double-tap (el estado React no es lo suficientemente rápido)
    if (savingRef.current) return;

    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }
    if (!price || isNaN(parseFloat(price))) {
      Alert.alert('Error', 'El precio es requerido');
      return;
    }
    if (!cost || isNaN(parseFloat(cost))) {
      Alert.alert('Error', 'El costo es requerido');
      return;
    }

    savingRef.current = true;
    setLoading(true);
    try {
      const normalizedSku = sku.trim();
      if (normalizedSku) {
        const localDuplicate = await findDuplicateSkuLocally(normalizedSku);
        if (localDuplicate) {
          Alert.alert(
            'SKU duplicado',
            `El SKU "${localDuplicate.sku}" ya existe y pertenece al producto "${localDuplicate.productName}".`
          );
          return;
        }

        const apiDuplicate = await findDuplicateSkuInApi(normalizedSku);
        if (apiDuplicate) {
          if (apiDuplicate.productName) {
            Alert.alert(
              'SKU duplicado',
              `El SKU "${apiDuplicate.sku}" ya existe y pertenece al producto "${apiDuplicate.productName}".`
            );
          } else {
            Alert.alert(
              'SKU duplicado',
              `El SKU "${apiDuplicate.sku}" ya existe. Usa otro código o déjalo vacío.`
            );
          }
          return;
        }
      }

      const localId = generateLocalId();
      const costCents = Math.round(parseFloat(cost) * 100);
      const priceCents = Math.round(parseFloat(price) * 100);
      const stockValue = stock ? parseFloat(stock) : 0;

      const productData = {
        localId,
        apiProductId: apiNextProductId !== 'No disponible' && apiNextProductId !== 'Cargando...' ? apiNextProductId : null,
        name: name.trim(),
        sku: sku.trim() || null,
        productKind,
        unit: activeUnit,
        costCents,
        priceCents,
        stock: productKind === 'RECIPE' ? 0 : stockValue,
        reference: reference.trim() || null,
        supplierId,
        categoryId,
        minStock: Number(minStock || 0),
        taxRate: Number(taxRate),
        isAvailableForSale,
        recipeItems,
        imageUri,
        createdAt: Date.now(),
      };

      await db.insert('products', {
        local_id: localId,
        name: productData.name,
        sku: productData.sku,
        cost_cents: costCents,
        price_cents: priceCents,
        stock: stockValue,
        synced: 0,
        is_available_for_sale: isAvailableForSale ? 1 : 0,
        data: JSON.stringify(productData),
      });

      await syncService.queueOperation('product', 'create', productData, localId);
      Alert.alert('Éxito', 'Producto guardado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error) {
      console.error('Error guardando producto:', error);
      const duplicateFromApi = parseDuplicateSkuFromApiError(error);
      if (duplicateFromApi) {
        if (duplicateFromApi.productName) {
          Alert.alert(
            'SKU duplicado',
            `El SKU "${duplicateFromApi.sku}" ya existe y pertenece al producto "${duplicateFromApi.productName}".`
          );
        } else {
          Alert.alert(
            'SKU duplicado',
            `El SKU "${duplicateFromApi.sku}" ya existe. Usa otro código o déjalo vacío.`
          );
        }
      } else {
        Alert.alert('Error', 'No se pudo guardar el producto');
      }
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  };

  const scanBarcode = () => {
    navigation.navigate('BarcodeScanner', {
      onScan: (barcode: string) => setSku(barcode),
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon source="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Nuevo Producto</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}>
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>🧾</Text>
            </View>
            <Text style={styles.sectionTitle}>Información General</Text>
          </View>

          <View style={styles.readOnlyField}>
            <View style={styles.readOnlyTop}>
              <Text style={styles.readOnlyLabel}>ID (Definido por API)</Text>
              <TouchableOpacity onPress={() => loadNextProductId(true)} style={styles.refreshIdBtn}>
                <Icon source="refresh" size={16} color={ui.colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.readOnlyValue}>{apiNextProductId}</Text>
          </View>

          <TextInput
            label="Nombre del Producto *"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

          <View style={styles.row}>
            <View style={styles.half}>
              <Menu
                visible={supplierMenuVisible}
                onDismiss={() => setSupplierMenuVisible(false)}
                anchor={
                  <TouchableOpacity style={styles.selectLike} onPress={() => setSupplierMenuVisible(true)}>
                    <Text style={styles.selectLikeText}>{supplierName || 'Proveedor'}</Text>
                    <Icon source="chevron-down" size={18} color="#6B7280" />
                  </TouchableOpacity>
                }
              >
                {suppliers.length === 0 ? <Menu.Item title={catalogsLoading ? 'Cargando...' : 'Sin proveedores'} onPress={() => {}} /> : null}
                {suppliers.map((item) => (
                  <Menu.Item
                    key={item.id}
                    title={item.name}
                    onPress={() => {
                      setSupplierId(item.id);
                      setSupplierName(item.name);
                      setSupplierMenuVisible(false);
                    }}
                  />
                ))}
                <Divider />
                <Menu.Item
                  leadingIcon="plus"
                  title="Crear nueva"
                  titleStyle={{ color: ui.colors.primary, fontWeight: '600' }}
                  onPress={() => {
                    setSupplierMenuVisible(false);
                    navigation.navigate('AddSupplier');
                  }}
                />
              </Menu>
            </View>
            <View style={styles.half}>
              <Menu
                visible={categoryMenuVisible}
                onDismiss={() => setCategoryMenuVisible(false)}
                anchor={
                  <TouchableOpacity style={styles.selectLike} onPress={() => setCategoryMenuVisible(true)}>
                    <Text style={styles.selectLikeText}>{categoryName || 'Categoría'}</Text>
                    <Icon source="chevron-down" size={18} color="#6B7280" />
                  </TouchableOpacity>
                }
              >
                {categories.length === 0 ? <Menu.Item title={catalogsLoading ? 'Cargando...' : 'Sin categorías'} onPress={() => {}} /> : null}
                {categories.map((item) => (
                  <Menu.Item
                    key={item.id}
                    title={item.name}
                    onPress={() => {
                      setCategoryId(item.id);
                      setCategoryName(item.name);
                      setCategoryMenuVisible(false);
                    }}
                  />
                ))}
                <Divider />
                <Menu.Item
                  leadingIcon="plus"
                  title="Crear nueva"
                  titleStyle={{ color: ui.colors.primary, fontWeight: '600' }}
                  onPress={() => {
                    setCategoryMenuVisible(false);
                    navigation.navigate('AddCategory');
                  }}
                />
              </Menu>
            </View>
          </View>

          <View style={styles.row}>
            <TextInput
              label="SKU / Código"
              value={sku}
              onChangeText={setSku}
              mode="outlined"
              style={[styles.input, styles.half]}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TouchableOpacity style={styles.scanButton} onPress={scanBarcode}>
              <Icon source="barcode-scan" size={18} color={ui.colors.primary} />
              <Text style={styles.scanText}>Escanear</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            label="Referencia"
            value={reference}
            onChangeText={setReference}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>⚖️</Text>
            </View>
            <Text style={styles.sectionTitle}>Tipo y Unidad</Text>
          </View>

          <View style={styles.choiceRow}>
            {CREATE_PRODUCT_KIND_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.choiceChip, productKind === option.value && styles.choiceChipOn]}
                onPress={() => {
                  setProductKind(option.value);
                  if (option.value === 'RECIPE' || option.value === 'BASIC') {
                    setUnit('UNIDAD');
                  }
                }}
              >
                <Text style={[styles.choiceChipText, productKind === option.value && styles.choiceChipTextOn]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {productKind === 'MEASURED' ? (
            <>
              <Menu
                visible={unitMenuVisible}
                onDismiss={() => setUnitMenuVisible(false)}
                anchor={
                  <TouchableOpacity style={[styles.selectLike, styles.inlineSelect]} onPress={() => setUnitMenuVisible(true)}>
                    <Text style={styles.selectLikeText}>Unidad: {getUnitAbbreviation(unit)}</Text>
                    <Icon source="chevron-down" size={18} color="#6B7280" />
                  </TouchableOpacity>
                }
              >
                {PRODUCT_UNIT_OPTIONS.filter((option) => option.value !== 'UNIDAD').map((option) => (
                  <Menu.Item
                    key={option.value}
                    title={option.label}
                    onPress={() => {
                      setUnit(option.value);
                      setUnitMenuVisible(false);
                    }}
                  />
                ))}
              </Menu>
              <Text style={styles.unitHint}>La misma unidad aplica a costo, precio, existencia y stock mínimo.</Text>
            </>
          ) : productKind === 'RECIPE' ? (
            <Text style={styles.unitHint}>Los productos por receta usan unidad fija en und. Su existencia no se maneja directamente.</Text>
          ) : (
            <Text style={styles.unitHint}>Los productos básicos usan unidad fija en und.</Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>💰</Text>
            </View>
            <Text style={styles.sectionTitle}>Precios y Costos</Text>
          </View>

          <TextInput
            label={productKind === 'MEASURED' ? `Precio de Venta por ${getUnitAbbreviation(activeUnit)} (RD$) *` : 'Precio de Venta (RD$) *'}
            value={price}
            onChangeText={setPrice}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            left={<TextInput.Affix text="RD$ " />}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            label={productKind === 'MEASURED' ? `Costo por ${getUnitAbbreviation(activeUnit)} (RD$) *` : 'Costo Unitario (RD$) *'}
            value={cost}
            onChangeText={setCost}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            left={<TextInput.Affix text="RD$ " />}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
        </View>



        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>📦</Text>
            </View>
            <Text style={styles.sectionTitle}>{productKind === 'RECIPE' ? 'Insumos de Receta' : 'Inventario'}</Text>
          </View>

          {productKind === 'RECIPE' ? (
             <View style={{ padding: 14 }}>
               <Text style={{ color: ui.colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 10 }}>
                 Define los insumos que se consumirán por cada unidad vendida.
               </Text>
               <Button mode="outlined" icon="plus" onPress={() => {
                 setRecipeItems([...recipeItems, { id: Date.now().toString(), ingredientId: '', qty: '1' }]);
               }}>Agregar Insumo</Button>

               <View style={{ marginTop: 14, gap: 10 }}>
                 {recipeItems.map((item, index) => {
                   const ingredient = availableIngredients.find(i => i.id === item.ingredientId);
                   return (
                     <View key={item.id} style={{ borderWidth: 1, borderColor: ui.colors.border, borderRadius: ui.radius.md, padding: 10, backgroundColor: '#f9fafb' }}>
                       <Text style={{ fontSize: 12, fontWeight: '600', color: ui.colors.textMuted, marginBottom: 5 }}>Insumo #{index + 1}</Text>
                       <TouchableOpacity
                         style={[styles.selectLike, { minHeight: 44, marginBottom: 10, marginHorizontal: 0 }]}
                         onPress={() => { openIngredientPicker(item.id); }}
                       >
                         <Text style={{ color: ingredient ? ui.colors.text : ui.colors.textMuted, fontSize: 14 }}>
                           {ingredient ? `${ingredient.productId} - ${ingredient.name}` : 'Selecciona un insumo...'}
                         </Text>
                       </TouchableOpacity>
                       <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                         <TextInput
                           label={`Cantidad ${ingredient && ingredient.unit !== 'UNIDAD' ? `(${getUnitAbbreviation(ingredient.unit)})` : ''}`}
                           value={item.qty}
                           onChangeText={(val) => setRecipeItems(recipeItems.map(ri => ri.id === item.id ? { ...ri, qty: val } : ri))}
                           mode="outlined"
                           keyboardType="decimal-pad"
                           style={{ flex: 1, height: 44, backgroundColor: '#fff', fontSize: 14 }}
                           outlineColor={ui.colors.border}
                           activeOutlineColor={ui.colors.primary}
                         />
                         <TouchableOpacity
                           style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: ui.radius.md, borderWidth: 1, borderColor: '#ef4444', backgroundColor: '#fef2f2' }}
                           onPress={() => setRecipeItems(recipeItems.filter(ri => ri.id !== item.id))}
                         >
                           <Icon source="delete" size={20} color="#ef4444" />
                         </TouchableOpacity>
                       </View>
                     </View>
                   );
                 })}
               </View>
             </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.counterLabel}>
                  Existencia Actual {productKind === 'MEASURED' ? `(${getUnitAbbreviation(activeUnit)})` : ''}
                </Text>
                <View style={styles.counterWrap}>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setStock(String(Math.max(0, Math.round((Number(stock || 0) - stockStep) * 100) / 100)))}
                  >
                    <Icon source="minus" size={16} color={ui.colors.textMuted} />
                  </TouchableOpacity>
                  <TextInput
                    value={stock}
                    onChangeText={setStock}
                    mode="flat"
                    keyboardType={unitAllowsDecimals(activeUnit) ? 'decimal-pad' : 'number-pad'}
                    style={styles.counterInput}
                    underlineColor="transparent"
                    activeUnderlineColor="transparent"
                  />
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setStock(String(Math.round((Number(stock || 0) + stockStep) * 100) / 100))}
                  >
                    <Icon source="plus" size={16} color={ui.colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.half}>
                <Text style={styles.counterLabel}>
                  Stock Mínimo {productKind === 'MEASURED' ? `(${getUnitAbbreviation(activeUnit)})` : ''}
                </Text>
                <View style={styles.counterWrap}>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setMinStock(String(Math.max(0, Math.round((Number(minStock || 0) - stockStep) * 100) / 100)))}
                  >
                    <Icon source="minus" size={16} color={ui.colors.textMuted} />
                  </TouchableOpacity>
                  <TextInput
                    value={minStock}
                    onChangeText={setMinStock}
                    mode="flat"
                    keyboardType={unitAllowsDecimals(activeUnit) ? 'decimal-pad' : 'number-pad'}
                    style={styles.counterInput}
                    underlineColor="transparent"
                    activeUnderlineColor="transparent"
                  />
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setMinStock(String(Math.round((Number(minStock || 0) + stockStep) * 100) / 100))}
                  >
                    <Icon source="plus" size={16} color={ui.colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>🧮</Text>
            </View>
            <Text style={styles.sectionTitle}>Impuestos</Text>
          </View>
          <View style={styles.taxChips}>
            {[
              { label: '18% Estándar', value: '18' },
              { label: '16% Reducido', value: '16' },
              { label: 'Exento (0%)', value: '0' },
            ].map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.taxChip, taxRate === option.value && styles.taxChipOn]}
                onPress={() => setTaxRate(option.value as '18' | '16' | '0')}
              >
                <Text style={[styles.taxChipText, taxRate === option.value && styles.taxChipTextOn]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>👀</Text>
            </View>
            <Text style={styles.sectionTitle}>Visibilidad</Text>
          </View>
          <View style={[styles.row, { marginTop: 14, justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ color: ui.colors.text, fontWeight: '700', fontSize: 15 }}>Disponible para venta</Text>
              <Text style={{ color: ui.colors.textMuted, fontSize: 12, marginTop: 4 }}>
                Si se desactiva, no aparecerá en ventas, pero podrá seguir usándose como insumo en recetas.
              </Text>
            </View>
            <Switch
              value={isAvailableForSale}
              onValueChange={setIsAvailableForSale}
              color={ui.colors.primary}
            />
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>🖼️</Text>
            </View>
            <Text style={styles.sectionTitle}>Imagen (Opcional)</Text>
          </View>
          <View style={styles.imageWrap}>
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.productImage} /> : <Text style={styles.imagePlaceholder}>Sin imagen seleccionada</Text>}
          </View>
          <View style={styles.imageButtonsRow}>
            <TouchableOpacity style={styles.smallBtn} onPress={takePhoto}>
              <Text style={styles.smallBtnText}>Cámara</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={pickImage}>
              <Text style={styles.smallBtnText}>Galería</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      <BottomDock style={styles.bottomAction}>
        <Button
          mode="contained"
          icon="content-save"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          buttonColor={ui.colors.primary}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          Guardar Producto
        </Button>
      </BottomDock>

      <Modal
        visible={ingredientPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIngredientPickerVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
            <TouchableOpacity onPress={() => setIngredientPickerVisible(false)} style={{ padding: 5, marginRight: 10 }}>
              <Icon source="close" size={24} color="#000" />
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>Seleccionar Insumo</Text>
          </View>
          <View style={{ padding: 14 }}>
            <TextInput
              placeholder="Buscar por nombre..."
              value={ingredientSearchQuery}
              onChangeText={setIngredientSearchQuery}
              mode="outlined"
              activeOutlineColor={ui.colors.primary}
              left={<TextInput.Icon icon="magnify" />}
              style={{ backgroundColor: '#fff' }}
            />
          </View>
          <FlatList
            data={filteredIngredients}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}
                onPress={() => {
                  if (currentIngredientId) {
                    setRecipeItems(recipeItems.map(ri => ri.id === currentIngredientId ? { ...ri, ingredientId: item.id } : ri));
                  }
                  setIngredientPickerVisible(false);
                  setIngredientSearchQuery('');
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '500', color: '#111827' }}>{item.productId} - {item.name}</Text>
                <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{getUnitAbbreviation(item.unit)}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={{ paddingHorizontal: 20, marginTop: 40 }}>
                <Text style={{ textAlign: 'center', color: '#6b7280' }}>
                  {availableIngredients.length === 0
                    ? 'No hay insumos creados todavía.'
                    : 'No se encontraron insumos.'}
                </Text>
                {availableIngredients.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: '#6b7280', marginTop: 8 }}>
                    Primero debes crear los ingredientes que utilizarás.
                  </Text>
                ) : null}
              </View>
            }
            ListFooterComponent={
              <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16 }}>
                <Divider />
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    minHeight: 56,
                    marginTop: 10,
                    borderRadius: ui.radius.md,
                    borderWidth: 1,
                    borderColor: '#D9C2FF',
                    backgroundColor: '#F5EEFF',
                  }}
                  onPress={() => {
                    setIngredientPickerVisible(false);
                    setIngredientSearchQuery('');
                    navigation.navigate('AddProduct');
                  }}
                >
                  <Icon source="plus" size={22} color={ui.colors.primary} />
                  <Text style={{ color: ui.colors.primary, fontWeight: '800', fontSize: 16 }}>Crear insumo</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  topHeader: {
    backgroundColor: ui.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topHeaderTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  content: { padding: 14, gap: 10 },
  sectionCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F2E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIconText: { fontSize: 14 },
  sectionTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700' },
  readOnlyField: {
    margin: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: '#F8F7FB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  readOnlyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  refreshIdBtn: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  readOnlyLabel: { color: ui.colors.textMuted, fontSize: 11, fontWeight: '600' },
  readOnlyValue: { color: '#6B7280', fontSize: 14, fontWeight: '700', marginTop: 4 },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  half: { flex: 1 },
  selectLike: {
    minHeight: 56,
    borderRadius: ui.radius.md,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineSelect: {
    marginHorizontal: 14,
    marginBottom: 10,
  },
  selectLikeText: { color: '#111827', fontSize: 14 },
  input: { marginHorizontal: 14, marginBottom: 10, backgroundColor: ui.colors.surface },
  scanButton: {
    flex: 1,
    height: 54,
    marginTop: -10,
    borderRadius: ui.radius.md,
    backgroundColor: '#EEE1FF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scanText: { color: ui.colors.primary, fontWeight: '700' },
  counterLabel: { color: ui.colors.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  counterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  counterBtn: {
    width: 36,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrap: {
    margin: 14,
    marginBottom: 10,
    height: 130,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#F7F2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImage: { width: '100%', height: '100%', borderRadius: ui.radius.md },
  imagePlaceholder: { color: ui.colors.textMuted, fontWeight: '600' },
  imageButtonsRow: { marginHorizontal: 14, marginBottom: 14, flexDirection: 'row', gap: 8 },
  counterInput: {
    flex: 1,
    height: 46,
    backgroundColor: 'transparent',
    textAlign: 'center',
  },
  taxRow: { marginTop: 10, flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  smallBtn: {
    flex: 1,
    height: 40,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { color: ui.colors.text, fontWeight: '600' },
  choiceRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  choiceChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  choiceChipOn: { backgroundColor: '#EEE1FF', borderColor: '#D9C2FF' },
  choiceChipText: { color: ui.colors.text, fontWeight: '600' },
  choiceChipTextOn: { color: ui.colors.primary, fontWeight: '800' },
  unitHint: {
    marginHorizontal: 14,
    marginBottom: 14,
    color: ui.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  taxChips: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10, gap: 8 },
  taxChip: {
    height: 38,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  taxChipOn: { backgroundColor: '#EEE1FF', borderColor: '#D9C2FF' },
  taxChipText: { color: ui.colors.text, fontWeight: '600' },
  taxChipTextOn: { color: ui.colors.primary, fontWeight: '800' },
  bottomAction: {
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: 'rgba(247,246,248,0.94)',
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
  },
  saveButton: { borderRadius: ui.radius.lg },
  saveButtonContent: { height: 52 },
});

