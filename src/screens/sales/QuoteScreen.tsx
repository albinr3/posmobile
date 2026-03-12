import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, Image } from 'react-native';
import { Text, Icon, Searchbar, IconButton } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuoteCartStore } from '../../store/quoteCartStore';
import { db } from '../../database/Database';
import { Product } from '../../types';
import { ui } from '../../theme/ui';
import { formatProductQty, inferProductKind, inferProductUnit } from '../../utils/productUnits';
import { buildLineId } from '../../store/createCartStore';

interface QuoteScreenProps {
  navigation: any;
  route?: {
    params?: {
      editQuoteLocalId?: string;
      editNonce?: number;
    };
  };
}

interface QuoteProduct extends Product {
  isActive: boolean;
  parsedData?: any;
  reference?: string | null;
}

type ViewMode = 'LISTA' | 'IMAGENES';
const VIEW_MODE_STORAGE_KEY = 'quote_view_mode';

export function QuoteScreen({ navigation, route }: QuoteScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<QuoteProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('IMAGENES');
  const insets = useSafeAreaInsets();
  const lastLoadedEditKeyRef = useRef<string | null>(null);
  const internalNavigationRef = useRef(false);

  const {
    addItem,
    getTotal,
    getItemCount,
    customerId,
    customerName,
    items,
    loadDraft,
    clearEditing,
    editingQuoteLocalId,
    editingQuoteCode,
  } = useQuoteCartStore();

  useEffect(() => {
    let mounted = true;
    const loadSavedViewMode = async () => {
      try {
        const savedViewMode = await AsyncStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (!mounted) return;
        if (savedViewMode === 'LISTA' || savedViewMode === 'IMAGENES') {
          setViewMode(savedViewMode);
        }
      } catch (error) {
        console.error('Error cargando vista de Cotizaciones:', error);
      }
    };

    loadSavedViewMode();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode).catch((error) => {
      console.error('Error guardando vista de Cotizaciones:', error);
    });
  }, [viewMode]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadProducts();
      const quoteLocalId = route?.params?.editQuoteLocalId;
      const editNonce = route?.params?.editNonce || 0;
      const editKey = quoteLocalId ? `${quoteLocalId}:${editNonce}` : null;
      if (quoteLocalId && editKey && lastLoadedEditKeyRef.current !== editKey) {
        lastLoadedEditKeyRef.current = editKey;
        loadQuoteDraft(quoteLocalId);
      }
    }, [route?.params?.editQuoteLocalId, route?.params?.editNonce])
  );

  const loadQuoteDraft = async (quoteLocalId: string) => {
    try {
      const quoteRow = await db.queryFirst<any>('SELECT * FROM quotes WHERE local_id = ?', [quoteLocalId]);
      if (!quoteRow) {
        Alert.alert('Cotización', 'No se encontró la cotización para editar.');
        return;
      }

      let parsedData: any = null;
      try {
        parsedData = quoteRow.data ? JSON.parse(quoteRow.data) : null;
      } catch {
        parsedData = null;
      }

      const rawItems = Array.isArray(parsedData?.items) ? parsedData.items : [];
      const mappedItems = await Promise.all(
        rawItems.map(async (item: any) => {
          const incomingProductId = String(item.productId || '');
          if (!incomingProductId) return null;
          const productRow = await db.queryFirst<{ local_id: string; data?: string }>(
            'SELECT local_id, data FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
            [incomingProductId, incomingProductId]
          );
          const localProductId = productRow?.local_id || incomingProductId;
          let productData: Record<string, unknown> | null = null;
          try {
            productData = productRow?.data ? JSON.parse(productRow.data) : null;
          } catch {
            productData = null;
          }
          const quantity = Number(item.quantity ?? item.qty ?? 1);
          const priceCents = Number(item.priceCents ?? item.unitPriceCents ?? 0);
          if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(priceCents) || priceCents <= 0) return null;
          const recipeAdjustments = Array.isArray(item?.recipeAdjustments) ? item.recipeAdjustments : [];
          const lineId = buildLineId(localProductId, recipeAdjustments);
          return {
            lineId,
            productId: localProductId,
            productName: String(item.productName || 'Producto'),
            quantity,
            priceCents,
            totalCents: quantity * priceCents,
            unit: inferProductUnit({
              ...(productData || {}),
              unit: item?.unit ?? item?.product?.unit,
            }),
            productKind: inferProductKind(productData),
            recipeItems: Array.isArray((productData as any)?.recipeItems) ? (productData as any).recipeItems : [],
            recipeAdjustments,
          };
        })
      );

      loadDraft({
        items: mappedItems.filter(Boolean),
        customerId: parsedData?.customerId ? String(parsedData.customerId) : null,
        customerName: parsedData?.customerName ? String(parsedData.customerName) : null,
        editingQuoteLocalId: String(quoteRow.local_id),
        editingQuoteServerId: quoteRow.server_id ? String(quoteRow.server_id) : null,
        editingQuoteCode: String(quoteRow.quote_code || parsedData?.quoteCode || ''),
      });
      navigation.setParams?.({ editQuoteLocalId: undefined, editNonce: undefined });
    } catch (error) {
      console.error('Error cargando borrador de cotización:', error);
      Alert.alert('Cotización', 'No se pudo cargar la cotización para edición.');
    }
  };

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      if (internalNavigationRef.current) {
        internalNavigationRef.current = false;
        return;
      }
      clearEditing();
    });
    return unsubscribeBlur;
  }, [navigation, clearEditing]);

  const loadProducts = async () => {
    try {
      const result = await db.query<any>('SELECT * FROM products WHERE is_available_for_sale = 1 ORDER BY name');
      const mapped = result.map((row) => {
        let parsedData: Record<string, unknown> | null = null;
        try {
          parsedData = row.data ? JSON.parse(row.data) : null;
        } catch {
          parsedData = null;
        }

        return {
          parsedData,
          localId: row.local_id,
          serverId: row.server_id,
          name: row.name,
          sku: row.sku,
          reference: parsedData?.reference ? String(parsedData.reference) : null,
          priceCents: row.price_cents,
          stock: row.stock,
          unit: inferProductUnit(parsedData),
          productKind: inferProductKind(parsedData),
          recipeItems: Array.isArray(parsedData?.recipeItems) ? parsedData.recipeItems : [],
          imageUrl: row.image_url,
          synced: row.synced === 1,
          isActive: row.is_available_for_sale === 1,
          data: row.data,
        };
      });
      setProducts(mapped);
    } catch (error) {
      console.error('Error cargando productos:', error);
    } finally {
      setLoading(false);
    }
  };

  const getProductImage = (item: QuoteProduct) => {
    const fromParsed = Array.isArray(item.parsedData?.imageUrls) ? item.parsedData.imageUrls[0] : null;
    const fromLocalPending = item.parsedData?.imageUri ? String(item.parsedData.imageUri) : null;
    return fromParsed || fromLocalPending || item.imageUrl || null;
  };

  const filteredProducts = useMemo(
    () =>
      products
        .filter((product) => product.synced && !!product.serverId && product.isActive)
        .filter(
          (product) =>
            product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (product.sku && product.sku.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (product.reference && product.reference.toLowerCase().includes(searchQuery.toLowerCase()))
        ),
    [products, searchQuery]
  );

  const cartQuantityByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.productId, (map.get(item.productId) || 0) + item.quantity);
    }
    return map;
  }, [items]);

  const handleProductPress = (product: QuoteProduct) => {
    if (!product.synced || !product.serverId || !product.isActive) {
      Alert.alert('Producto no disponible', 'Este producto no esta activo o no ha sido sincronizado.');
      return;
    }
    if (product.productKind !== 'RECIPE' && product.stock <= 0) {
      Alert.alert('Sin stock', 'Este producto no tiene stock disponible.');
      return;
    }
    addItem(product);
  };

  const handleScanBarcode = () => {
    internalNavigationRef.current = true;
    navigation.navigate('BarcodeScanner', {
      onScan: (barcode: string) => setSearchQuery(barcode),
    });
  };

  const renderCreateProductCard = () => (
    <TouchableOpacity
      style={[styles.createCard, viewMode === 'LISTA' && styles.createCardList]}
      onPress={() => navigation.navigate('Inventory', { screen: 'AddProduct' })}
    >
      <View style={styles.createIconBubble}>
        <Icon source="plus" size={34} color={ui.colors.textMuted} />
      </View>
      <Text style={styles.createText}>Crear producto</Text>
    </TouchableOpacity>
  );

  const renderProduct = ({ item }: { item: QuoteProduct }) => {
    const isRecipe = item.productKind === 'RECIPE';
    const isOut = !isRecipe && item.stock <= 0;
    const selectedQty = cartQuantityByProduct.get(item.localId) || 0;
    const productImage = getProductImage(item);
    const stockLabel = isRecipe ? 'Receta' : `${formatProductQty(item.stock, item.unit)} disponible`;
    const selectedQtyLabel = formatProductQty(selectedQty, item.unit);

    if (viewMode === 'LISTA') {
      return (
        <View style={styles.listItemWrap}>
          <TouchableOpacity style={[styles.productCard, styles.productCardList]} onPress={() => handleProductPress(item)}>
            {selectedQty > 0 ? (
              <View style={styles.qtyBadge}>
                <Text style={styles.qtyBadgeText}>{selectedQtyLabel}</Text>
              </View>
            ) : null}
            <View style={styles.productInfoListOnly}>
              <View style={styles.listTopRow}>
                <Text style={styles.productNameList} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.productPriceList}>DOP {(item.priceCents / 100).toFixed(2)}</Text>
              </View>
              <View style={styles.listBottomRow}>
                <Text style={styles.skuTextList}>
                  {item.sku ? `SKU ${item.sku}` : 'Sin SKU'}
                  {item.reference ? ` | Ref ${item.reference}` : ''}
                </Text>
                <Text style={[styles.stockText, isOut && styles.stockOut]}>{stockLabel}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity style={styles.productCard} onPress={() => handleProductPress(item)}>
        {selectedQty > 0 ? (
          <View style={styles.qtyBadge}>
            <Text style={styles.qtyBadgeText}>{selectedQtyLabel}</Text>
          </View>
        ) : null}
        <View style={styles.imageBox}>
          {productImage ? (
            <Image source={{ uri: productImage }} style={styles.productImage} resizeMode="cover" />
          ) : (
            <>
              <Text style={styles.imageLetter}>{item.name.charAt(0).toUpperCase()}</Text>
              <Text style={styles.imageCaption}>Sin imagen</Text>
            </>
          )}
          {isOut ? (
            <View style={styles.outBadge}>
              <Text style={styles.outBadgeText}>AGOTADO</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>
            {item.name}
          </Text>
          {item.reference ? (
            <Text style={styles.referenceText} numberOfLines={1}>
              Ref: {item.reference}
            </Text>
          ) : null}
          <Text style={styles.productPrice}>DOP {(item.priceCents / 100).toFixed(2)}</Text>
          <Text style={[styles.stockText, isOut && styles.stockOut]}>{stockLabel}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <>
      <View style={styles.mainContent}>
        <View style={styles.saleCard}>
          <View style={styles.saleHeader}>
            <Text style={styles.saleTitle}>{editingQuoteLocalId ? 'Editar cotización' : 'Cotización'}</Text>
          </View>
          {editingQuoteLocalId ? (
            <Text style={styles.editModeText}>Editando: {editingQuoteCode || editingQuoteLocalId}</Text>
          ) : null}

          <Text style={styles.label}>Cliente</Text>
          <TouchableOpacity
            style={styles.selectLike}
            onPress={() => {
              internalNavigationRef.current = true;
              navigation.navigate('SelectQuoteCustomer');
            }}
          >
            <Text style={styles.selectLikeText}>{customerName || '(General) Cliente general'}</Text>
            <Icon source="chevron-right" size={18} color="#6B7280" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar productos..."
            placeholderTextColor="#B8B2C8"
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
            iconColor="#9CA3AF"
          />
          <TouchableOpacity style={styles.qrBtn} onPress={handleScanBarcode}>
            <Icon source="qrcode-scan" size={22} color="#9CA3AF" />
          </TouchableOpacity>
        </View>

        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.viewButton, viewMode === 'LISTA' && styles.viewButtonActive]}
            onPress={() => setViewMode('LISTA')}
          >
            <IconButton
              icon="format-list-bulleted"
              size={17}
              iconColor={viewMode === 'LISTA' ? ui.colors.primary : '#9CA3AF'}
              style={styles.toggleIcon}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewButton, viewMode === 'IMAGENES' && styles.viewButtonActive]}
            onPress={() => setViewMode('IMAGENES')}
          >
            <IconButton
              icon="view-grid-outline"
              size={17}
              iconColor={viewMode === 'IMAGENES' ? ui.colors.primary : '#9CA3AF'}
              style={styles.toggleIcon}
            />
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        key={viewMode}
        data={filteredProducts}
        renderItem={renderProduct}
        keyExtractor={(item) => item.localId}
        numColumns={viewMode === 'IMAGENES' ? 2 : 1}
        columnWrapperStyle={viewMode === 'IMAGENES' ? styles.row : undefined}
        ListHeaderComponent={renderHeader()}
        ListHeaderComponentStyle={styles.headerContainer}
        contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>Cargando productos...</Text>
            </View>
          ) : (
            <View style={viewMode === 'IMAGENES' ? styles.row : styles.listRow}>{renderCreateProductCard()}</View>
          )
        }
        ListFooterComponent={
          filteredProducts.length > 0 ? <View style={viewMode === 'IMAGENES' ? styles.row : styles.listRow}>{renderCreateProductCard()}</View> : null
        }
      />

      <BottomDock containerStyle={styles.bottomDockContainer} style={styles.bottomBar} maxBottomInset={8}>
        <View style={styles.bottomTop}>
          <Text style={styles.totalLabel}>Total</Text>
          <View style={styles.totalInfo}>
            <Text style={styles.totalAmount}>DOP {(getTotal() / 100).toFixed(2)}</Text>
            <Text style={styles.itemsText}>{items.length} productos</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.chargeButton, getItemCount() === 0 && styles.chargeButtonDisabled]}
          onPress={() => {
            internalNavigationRef.current = true;
            navigation.navigate('QuoteCart', { customerId, customerName });
          }}
          disabled={getItemCount() === 0}
        >
          <Text style={styles.chargeButtonText}>Cotizar</Text>
          <Icon source="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>
      </BottomDock>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  headerContainer: { backgroundColor: '#F3F4F6' },
  mainContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  searchWrap: { position: 'relative', marginBottom: 5 },
  searchbar: { backgroundColor: '#fff', borderRadius: 12, elevation: 1 },
  searchInput: { minHeight: 44, fontSize: 14 },
  qrBtn: { position: 'absolute', right: 14, top: 10 },
  saleCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  saleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  saleTitle: { fontSize: 20, color: '#111827', fontWeight: '700' },
  editModeText: { color: '#4B5563', fontSize: 12, marginBottom: 6, fontWeight: '700' },
  viewToggle: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  viewButton: { borderRadius: 8 },
  viewButtonActive: { backgroundColor: '#fff' },
  toggleIcon: { margin: 0 },
  label: { fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', marginBottom: 6, marginTop: 6 },
  selectLike: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectLikeText: { color: '#111827', fontSize: 14 },
  row: { paddingHorizontal: 14, justifyContent: 'space-between', marginBottom: 12 },
  listRow: { paddingHorizontal: 14, marginBottom: 12 },
  createCard: {
    marginTop: 8,
    width: '48.4%',
    minHeight: 208,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  createCardList: {
    width: '100%',
    minHeight: 120,
    flexDirection: 'row',
  },
  createIconBubble: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  createText: { color: '#6B7280', fontWeight: '600' },
  productCard: {
    width: '48.4%',
    minHeight: 208,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    position: 'relative',
  },
  productCardList: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    marginBottom: 2,
  },
  listItemWrap: {
    paddingHorizontal: 14,
  },
  qtyBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ui.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    zIndex: 3,
  },
  qtyBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  imageBox: {
    height: 122,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productImage: { width: '100%', height: '100%' },
  imageBoxList: {
    width: 112,
    height: '100%',
  },
  imageLetter: { fontSize: 36, color: '#9CA3AF', fontWeight: '700' },
  imageCaption: { color: '#9CA3AF', fontSize: 11, marginTop: 2 },
  outBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#EF4444',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  outBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  productInfo: { padding: 10, alignItems: 'center', flex: 1, justifyContent: 'space-between' },
  productInfoList: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  productInfoListOnly: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 1,
  },
  listBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productNameList: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  productPriceList: {
    color: ui.colors.primary,
    fontWeight: '800',
    fontSize: 14,
  },
  skuTextList: {
    color: '#6B7280',
    fontSize: 12,
  },
  referenceText: { color: '#6B7280', fontSize: 11, marginTop: 4 },
  productName: { textAlign: 'center', color: '#111827', fontWeight: '600', fontSize: 13 },
  productPrice: { color: ui.colors.primary, marginTop: 8, fontWeight: '800' },
  stockText: { color: '#6B7280', fontSize: 11, marginTop: 4 },
  stockOut: { color: '#EF4444', fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { color: '#6B7280' },
  bottomBar: {
    backgroundColor: 'rgba(255,255,255,0.52)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(229,231,235,0.45)',
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 10,
  },
  bottomTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  totalLabel: { color: '#6B7280', fontWeight: '700', fontSize: 12 },
  totalInfo: { alignItems: 'flex-end' },
  totalAmount: { color: '#111827', fontSize: 17, fontWeight: '800', lineHeight: 19 },
  itemsText: { color: '#6B7280', fontSize: 11, lineHeight: 13 },
  chargeButton: {
    height: 46,
    borderRadius: 12,
    backgroundColor: ui.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chargeButtonDisabled: { backgroundColor: '#C4B5FD' },
  chargeButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  bottomDockContainer: {
    backgroundColor: 'transparent',
  },
});
