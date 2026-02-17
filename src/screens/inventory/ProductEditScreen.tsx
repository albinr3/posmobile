import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity, Image } from 'react-native';
import { TextInput, Button, Text, Icon, Menu } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { ui } from '../../theme/ui';
import { useAuthStore } from '../../store/authStore';

interface ProductEditScreenProps {
  navigation: any;
  route: any;
}

interface OptionItem {
  id: string;
  name: string;
}

export function ProductEditScreen({ navigation, route }: ProductEditScreenProps) {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();
  const { productId } = route.params;

  const [localId, setLocalId] = useState<string>('');
  const [serverId, setServerId] = useState<string | null>(null);
  const [currentStock, setCurrentStock] = useState(0);

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
  const [minStock, setMinStock] = useState('0');
  const [taxRate, setTaxRate] = useState<'18' | '16' | '0'>('18');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogsLoading, setCatalogsLoading] = useState(false);
  const hasPendingImageSelectionRef = useRef(false);

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
            if (error?.response?.status !== 404) throw error;
          }
        }
        return [];
      };

      const [suppliersRaw, categoriesRaw] = await Promise.all([
        fetchFromCandidates(['/api/suppliers', '/api/providers', '/api/provider']),
        fetchFromCandidates(['/api/categories', '/api/category']),
      ]);

      const suppliersData = (suppliersRaw || []).map((s: any) => ({ id: String(s.id), name: String(s.name || '') }));
      const categoriesData = (categoriesRaw || []).map((c: any) => ({ id: String(c.id), name: String(c.name || '') }));
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

  const loadProduct = useCallback(async () => {
    try {
      const row = await db.queryFirst<any>('SELECT * FROM products WHERE local_id = ?', [productId]);
      if (!row) {
        Alert.alert('Error', 'Producto no encontrado', [{ text: 'OK', onPress: () => navigation.goBack() }]);
        return;
      }

      let parsed: any = null;
      try {
        parsed = row.data ? JSON.parse(row.data) : null;
      } catch {
        parsed = null;
      }

      const imageFromData = Array.isArray(parsed?.imageUrls) && parsed.imageUrls.length > 0 ? String(parsed.imageUrls[0]) : null;

      setLocalId(row.local_id);
      setServerId(row.server_id ? String(row.server_id) : null);
      setCurrentStock(Number(row.stock || parsed?.stock || 0));
      setName(String(row.name || parsed?.name || ''));
      setSku(String(row.sku || parsed?.sku || ''));
      setReference(String(parsed?.reference || ''));
      setSupplierId(parsed?.supplierId ? String(parsed.supplierId) : null);
      setCategoryId(parsed?.categoryId ? String(parsed.categoryId) : null);
      setCost(((Number(row.cost_cents || parsed?.costCents || 0) || 0) / 100).toString());
      setPrice(((Number(row.price_cents || parsed?.priceCents || 0) || 0) / 100).toString());
      setMinStock(String(parsed?.minStock ?? 0));
      const taxRaw = String(parsed?.itbisRateBp ?? parsed?.taxRate ?? 18);
      setTaxRate(taxRaw === '16' || taxRaw === '0' ? (taxRaw as '16' | '0') : '18');
      if (!hasPendingImageSelectionRef.current) {
        setImageUri(imageFromData || row.image_url || parsed?.imageUri || null);
      }
    } catch (error) {
      console.error('Error cargando producto para edición:', error);
      Alert.alert('Error', 'No se pudo cargar el producto');
    }
  }, [navigation, productId]);

  useFocusEffect(
    useCallback(() => {
      hasPendingImageSelectionRef.current = false;
      loadProduct();
      loadCatalogOptions();
    }, [loadCatalogOptions, loadProduct])
  );

  useEffect(() => {
    if (!supplierId) return;
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (supplier) setSupplierName(supplier.name);
  }, [supplierId, suppliers]);

  useEffect(() => {
    if (!categoryId) return;
    const category = categories.find((item) => item.id === categoryId);
    if (category) setCategoryName(category.name);
  }, [categoryId, categories]);

  const pickImage = async () => {
    try {
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
      if (!result.canceled) {
        hasPendingImageSelectionRef.current = true;
        setImageUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error seleccionando imagen en edición de producto:', error);
      Alert.alert('Error', 'No se pudo abrir la galería');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permisos', 'Se necesita acceso a la cámara');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled) {
        hasPendingImageSelectionRef.current = true;
        setImageUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error tomando foto en edición de producto:', error);
      Alert.alert('Error', 'No se pudo abrir la cámara');
    }
  };

  const scanBarcode = () => {
    navigation.navigate('BarcodeScanner', {
      onScan: (barcode: string) => setSku(barcode),
    });
  };

  const handleSave = async () => {
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

    setLoading(true);
    try {
      const costCents = Math.round(parseFloat(cost) * 100);
      const priceCents = Math.round(parseFloat(price) * 100);
      const isLocalImage = !!imageUri && imageUri.startsWith('file://');
      const imageUrls = imageUri && !isLocalImage ? [imageUri] : [];

      const payload = {
        id: serverId || undefined,
        localId,
        name: name.trim(),
        sku: sku.trim() || null,
        reference: reference.trim() || null,
        supplierId,
        categoryId,
        costCents,
        priceCents,
        stock: currentStock,
        minStock: Number(minStock || 0),
        itbisRateBp: Number(taxRate) * 100,
        imageUri: isLocalImage ? imageUri : null,
        imageUrls,
        updatedAt: Date.now(),
      };

      await db.update(
        'products',
        localId,
        {
          name: payload.name,
          sku: payload.sku,
          cost_cents: payload.costCents,
          price_cents: payload.priceCents,
          stock: currentStock,
          synced: 0,
          data: JSON.stringify(payload),
        },
        'local_id'
      );

      if (serverId) {
        await db.runAsync(
          "DELETE FROM sync_queue WHERE entity_type = 'product' AND action = 'update' AND entity_local_id = ? AND status IN ('pending','error')",
          [localId]
        );
        await syncService.queueOperation('product', 'update', payload, localId);
      } else {
        await db.runAsync(
          "DELETE FROM sync_queue WHERE entity_type = 'product' AND entity_local_id = ? AND status IN ('pending','error')",
          [localId]
        );
        await syncService.queueOperation('product', 'create', payload, localId);
      }

      hasPendingImageSelectionRef.current = false;
      Alert.alert('Éxito', 'Producto actualizado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error) {
      console.error('Error actualizando producto:', error);
      Alert.alert('Error', 'No se pudo actualizar el producto');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Icon source="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topHeaderTitle}>Editar Producto</Text>
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
              <Text style={styles.sectionIconText}>💰</Text>
            </View>
            <Text style={styles.sectionTitle}>Precios y Costos</Text>
          </View>

          <TextInput
            label="Precio de Venta (RD$) *"
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
            label="Costo Unitario (RD$) *"
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

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}>
              <Text style={styles.sectionIconText}>📦</Text>
            </View>
            <Text style={styles.sectionTitle}>Inventario</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.half}>
              <Text style={styles.counterLabel}>Existencia Actual (solo lectura)</Text>
              <View style={styles.counterWrapReadOnly}>
                <Text style={styles.readOnlyStockValue}>{currentStock}</Text>
              </View>
            </View>
            <View style={styles.half}>
              <Text style={styles.counterLabel}>Stock Mínimo</Text>
              <View style={styles.counterWrap}>
                <TouchableOpacity style={styles.counterBtn} onPress={() => setMinStock(String(Math.max(0, Number(minStock || 0) - 1)))}>
                  <Icon source="minus" size={16} color={ui.colors.textMuted} />
                </TouchableOpacity>
                <TextInput
                  value={minStock}
                  onChangeText={setMinStock}
                  mode="flat"
                  keyboardType="number-pad"
                  style={styles.counterInput}
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                />
                <TouchableOpacity style={styles.counterBtn} onPress={() => setMinStock(String(Number(minStock || 0) + 1))}>
                  <Icon source="plus" size={16} color={ui.colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
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
          Guardar Cambios
        </Button>
      </BottomDock>
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
  counterWrapReadOnly: {
    height: 46,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: '#F8F7FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readOnlyStockValue: { color: '#6B7280', fontSize: 16, fontWeight: '800' },
  counterBtn: {
    width: 36,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterInput: {
    flex: 1,
    height: 46,
    backgroundColor: 'transparent',
    textAlign: 'center',
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
