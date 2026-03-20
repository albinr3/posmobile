import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, Image, ScrollView } from 'react-native';
import { Text, Icon, Searchbar, Menu, IconButton, Modal, Portal, Button, Chip } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCartStore } from '../../store/cartStore';
import { db } from '../../database/Database';
import { Product, SaleItem } from '../../types';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { formatProductQty, inferProductUnit, inferProductKind } from '../../utils/productUnits';
import { buildLineId } from '../../store/createCartStore';
import { getSalesSettings } from '../../services/settings/salesSettings';
import { calcDocumentTotalsByTaxMode } from '../../utils/tax';

interface POSScreenProps {
  navigation: any;
  route?: {
    params?: {
      editSaleLocalId?: string;
      editNonce?: number;
    };
  };
}

interface POSProduct extends Product {
  isActive: boolean;
  parsedData?: any;
  reference?: string | null;
}

type SaleType = 'CONTADO' | 'CREDITO';
type ViewMode = 'LISTA' | 'IMAGENES';

const PAYMENT_OPTIONS = [
  { label: 'Efectivo', value: 'EFECTIVO' },
  { label: 'Tarjeta', value: 'TARJETA' },
  { label: 'Transferencia', value: 'TRANSFERENCIA' },
  { label: 'Dividir pago', value: 'DIVIDIR_PAGO' },
];
const VIEW_MODE_STORAGE_KEY = 'pos_view_mode';

export function POSScreen({ navigation, route }: POSScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [scanExactSkuQuery, setScanExactSkuQuery] = useState<string | null>(null);
  const [products, setProducts] = useState<POSProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentMenuVisible, setPaymentMenuVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('IMAGENES');
  const [salePricesIncludeItbis, setSalePricesIncludeItbis] = useState(true);
  const insets = useSafeAreaInsets();
  const hydratedEditSaleRef = useRef<string | null>(null);
  const internalNavigationRef = useRef(false);

  // Recipe modifier state
  const [recipeDialogLineId, setRecipeDialogLineId] = useState<string | null>(null);
  const [recipeDialogMode, setRecipeDialogMode] = useState<'SIN' | 'EXTRA' | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<Record<string, 'SIN' | 'EXTRA'>>({});
  const [recipeApplyScope, setRecipeApplyScope] = useState<'ONE' | 'ALL'>('ALL');

  const {
    addItem,
    removeItem,
    getTotal,
    getItemCount,
    customerId,
    customerName,
    setPaymentMethod,
    setTransferBankName,
    setPaymentSplits,
    paymentMethod,
    items,
    loadInvoiceForEdit,
    editingSaleLocalId,
    editingInvoiceCode,
    clear,
  } = useCartStore();

  const saleType: SaleType = paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO';

  useEffect(() => {
    let mounted = true;
    const loadSavedViewMode = async () => {
      try {
        const salesSettings = await getSalesSettings();
        if (mounted) {
          setSalePricesIncludeItbis(salesSettings.salePricesIncludeItbis !== false);
        }
        const savedViewMode = await AsyncStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (!mounted) return;
        if (savedViewMode === 'LISTA' || savedViewMode === 'IMAGENES') {
          setViewMode(savedViewMode);
          return;
        }

        setViewMode(salesSettings.defaultViewMode === 'list' ? 'LISTA' : 'IMAGENES');
      } catch (error) {
        console.error('Error cargando vista de POS:', error);
      }
    };

    loadSavedViewMode();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode).catch((error) => {
      console.error('Error guardando vista de POS:', error);
    });
  }, [viewMode]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadProducts();
    }, [])
  );

  useEffect(() => {
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      if (internalNavigationRef.current) {
        internalNavigationRef.current = false;
        return;
      }
      clear();
      setSearchQuery('');
      setPaymentMenuVisible(false);
      hydratedEditSaleRef.current = null;
      navigation.setParams?.({ editSaleLocalId: undefined, editNonce: undefined });
    });
    return unsubscribeBlur;
  }, [navigation, clear]);

  useEffect(() => {
    const saleLocalId = route?.params?.editSaleLocalId;
    if (!saleLocalId) return;
    if (hydratedEditSaleRef.current === saleLocalId) return;
    hydratedEditSaleRef.current = saleLocalId;

    const loadInvoiceToCart = async () => {
      try {
        const sale = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [saleLocalId]);
        if (!sale) {
          Alert.alert('Factura', 'No se encontró la factura para editar.');
          return;
        }

        const status = String(sale.status || '').toLowerCase();
        if (status === 'cancelled') {
          Alert.alert('Factura', 'No puedes editar una factura cancelada.');
          return;
        }

        let parsedData: any = null;
        try {
          parsedData = sale.data ? JSON.parse(sale.data) : null;
        } catch {
          parsedData = null;
        }

        const rawItems = Array.isArray(parsedData?.items) ? parsedData.items : [];
        if (!rawItems.length) {
          Alert.alert('Factura', 'Esta factura no tiene productos para editar.');
          return;
        }

        const resolvedItems: SaleItem[] = [];
        for (const rawItem of rawItems) {
          const sourceId = String(rawItem?.productId || '');
          if (!sourceId) continue;

          const productRow = await db.queryFirst<{ local_id: string; name?: string; data?: string }>(
            'SELECT local_id, name, data FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
            [sourceId, sourceId]
          );
          if (!productRow?.local_id) continue;

          let productData: Record<string, unknown> | null = null;
          try {
            productData = productRow.data ? JSON.parse(productRow.data) : null;
          } catch {
            productData = null;
          }

          const quantity = Number(rawItem?.quantity ?? rawItem?.qty ?? 0);
          const unitPriceCents = Number(rawItem?.priceCents ?? rawItem?.unitPriceCents ?? 0);
          if (!Number.isFinite(quantity) || quantity <= 0) continue;
          if (!Number.isFinite(unitPriceCents) || unitPriceCents <= 0) continue;

          resolvedItems.push({
            lineId: buildLineId(productRow.local_id),
            productId: productRow.local_id,
            productName: String(rawItem?.productName || productRow.name || 'Producto'),
            quantity,
            priceCents: unitPriceCents,
            totalCents: Math.round(quantity * unitPriceCents),
            itbisRateBp: Number(rawItem?.itbisRateBp ?? productData?.itbisRateBp ?? 1800),
            unit: inferProductUnit({
              ...(productData || {}),
              unit: rawItem?.unit ?? rawItem?.product?.unit,
            }),
          });
        }

        if (!resolvedItems.length) {
          Alert.alert('Factura', 'No se pudieron mapear los productos de la factura para edición.');
          return;
        }

        const resolvedPaymentMethod = String(parsedData?.paymentMethod || 'EFECTIVO').toUpperCase();
        loadInvoiceForEdit({
          items: resolvedItems,
          customerId: sale.customer_id ? String(sale.customer_id) : null,
          customerName: parsedData?.customerName ? String(parsedData.customerName) : null,
          paymentMethod:
            resolvedPaymentMethod === 'CREDITO' ||
            resolvedPaymentMethod === 'TARJETA' ||
            resolvedPaymentMethod === 'TRANSFERENCIA' ||
            resolvedPaymentMethod === 'DIVIDIR_PAGO'
              ? resolvedPaymentMethod
              : 'EFECTIVO',
          transferBankName: parsedData?.transferBankName ? String(parsedData.transferBankName) : null,
          paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : [],
          saleLocalId,
          invoiceCode: String(sale.invoice_code || parsedData?.invoiceCode || '-'),
        });

        setSearchQuery('');
        navigation.setParams?.({ editSaleLocalId: undefined, editNonce: undefined });
      } catch (error) {
        console.error('Error preparando edición de factura en POS:', error);
        Alert.alert('Error', 'No se pudo abrir la factura en modo edición.');
      }
    };

    loadInvoiceToCart();
  }, [route?.params?.editSaleLocalId, route?.params?.editNonce, loadInvoiceForEdit, navigation]);

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

  const getProductImage = (item: POSProduct) => {
    const fromParsed = Array.isArray(item.parsedData?.imageUrls) ? item.parsedData.imageUrls[0] : null;
    const fromLocalPending = item.parsedData?.imageUri ? String(item.parsedData.imageUri) : null;
    return fromParsed || fromLocalPending || item.imageUrl || null;
  };

  const filteredProducts = useMemo(() => {
    const activeProducts = products.filter((product) => product.synced && !!product.serverId && product.isActive);

    if (scanExactSkuQuery) {
      const exactSkuMatches = activeProducts.filter(
        (product) => (product.sku || '').trim().toLowerCase() === scanExactSkuQuery
      );
      if (exactSkuMatches.length > 0) {
        return exactSkuMatches;
      }
    }

    const normalizedSearch = searchQuery.toLowerCase();
    return activeProducts.filter(
      (product) =>
        product.name.toLowerCase().includes(normalizedSearch) ||
        (product.sku && product.sku.toLowerCase().includes(normalizedSearch)) ||
        (product.reference && product.reference.toLowerCase().includes(normalizedSearch))
    );
  }, [products, searchQuery, scanExactSkuQuery]);

  const cartTotals = useMemo(
    () =>
      calcDocumentTotalsByTaxMode({
        items: items.map((item) => ({
          quantity: item.quantity,
          priceCents: item.priceCents,
          itbisRateBp: item.itbisRateBp ?? 1800,
        })),
        shippingCents: 0,
        salePricesIncludeItbis,
      }),
    [items, salePricesIncludeItbis]
  );

  const cartQuantityByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.productId, (map.get(item.productId) || 0) + item.quantity);
    }
    return map;
  }, [items]);

  const handleProductPress = (product: any) => {
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
      scannerMode: 'CART_SPLIT',
    });
  };

  const setSaleType = (type: SaleType) => {
    if (type === 'CREDITO') {
      setPaymentMethod('CREDITO');
    } else if (paymentMethod === 'CREDITO') {
      setPaymentMethod('EFECTIVO');
    }
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

  const renderProduct = ({ item }: { item: any }) => {
    const isRecipe = (item as any).productKind === 'RECIPE';
    const isOut = !isRecipe && item.stock <= 0;
    const selectedQty = cartQuantityByProduct.get(item.localId) || 0;
    const productImage = getProductImage(item);
    const stockLabel = isRecipe ? 'Receta' : `${formatProductQty(item.stock, item.unit)} disponible`;
    const selectedQtyLabel = formatProductQty(selectedQty, item.unit);

    if (viewMode === 'LISTA') {
      return (
        <View style={styles.listItemWrap}>
          <TouchableOpacity
            style={[styles.productCard, styles.productCardList]}
            onPress={() => handleProductPress(item)}
            onLongPress={() => {
              if (selectedQty > 0) {
                useCartStore.setState({
                  items: useCartStore.getState().items.filter(i => i.productId !== item.localId),
                });
              }
            }}
            delayLongPress={1000}
          >
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
                <Text style={styles.productPriceList}>RD$ {(item.priceCents / 100).toFixed(2)}</Text>
              </View>
              <View style={styles.listBottomRow}>
                <Text style={styles.skuTextList}>
                  {item.sku ? `SKU ${item.sku}` : 'Sin SKU'}
                  {item.reference ? ` | ${item.reference}` : ''}
                </Text>
                <Text style={[styles.stockText, isOut && styles.stockOut]}>{stockLabel}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity
        style={styles.productCard}
        onPress={() => handleProductPress(item)}
        onLongPress={() => {
          if (selectedQty > 0) {
            useCartStore.setState({
              items: useCartStore.getState().items.filter(i => i.productId !== item.localId),
            });
          }
        }}
        delayLongPress={1000}
      >
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
              {item.reference}
            </Text>
          ) : null}
          <Text style={styles.productPrice}>RD$ {(item.priceCents / 100).toFixed(2)}</Text>
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
            <Text style={styles.saleTitle}>{editingSaleLocalId ? `Editando ${editingInvoiceCode || 'factura'}` : 'Venta'}</Text>
          </View>

          <Text style={styles.label}>Cliente</Text>
          <TouchableOpacity
            style={styles.selectLike}
            onPress={() => {
              internalNavigationRef.current = true;
              navigation.navigate('SelectCustomer');
            }}
          >
            <Text style={styles.selectLikeText}>{customerName || '(General) Cliente general'}</Text>
            <Icon source="chevron-right" size={18} color="#6B7280" />
          </TouchableOpacity>

          <Text style={styles.label}>Tipo de venta</Text>
          <View style={styles.typeToggle}>
            <TouchableOpacity style={[styles.typeBtn, saleType === 'CONTADO' && styles.typeBtnOn]} onPress={() => setSaleType('CONTADO')}>
              <Text style={[styles.typeBtnText, saleType === 'CONTADO' && styles.typeBtnTextOn]}>Contado</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.typeBtn, saleType === 'CREDITO' && styles.typeBtnOn]} onPress={() => setSaleType('CREDITO')}>
              <Text style={[styles.typeBtnText, saleType === 'CREDITO' && styles.typeBtnTextOn]}>Crédito</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Método de pago</Text>
          <Menu
            visible={paymentMenuVisible}
            onDismiss={() => setPaymentMenuVisible(false)}
            anchor={
              <TouchableOpacity
                style={[styles.selectLike, saleType === 'CREDITO' && styles.selectDisabled]}
                onPress={() => {
                  if (saleType !== 'CREDITO') setPaymentMenuVisible(true);
                }}
              >
                <Text style={[styles.selectLikeText, saleType === 'CREDITO' && styles.selectDisabledText]}>
                  {saleType === 'CREDITO' ? 'Crédito' : PAYMENT_OPTIONS.find((m) => m.value === paymentMethod)?.label || 'Efectivo'}
                </Text>
                <Icon source="chevron-down" size={18} color="#6B7280" />
              </TouchableOpacity>
            }
          >
            {PAYMENT_OPTIONS.map((option) => (
              <Menu.Item
                key={option.value}
                title={option.label}
                onPress={() => {
                  setPaymentMethod(option.value);
                  if (option.value !== 'TRANSFERENCIA') setTransferBankName(null);
                  if (option.value !== 'DIVIDIR_PAGO') setPaymentSplits([]);
                  setPaymentMenuVisible(false);
                }}
              />
            ))}
          </Menu>
        </View>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar productos..."
            placeholderTextColor="#B8B2C8"
            onChangeText={(value) => {
              setScanExactSkuQuery(null);
              setSearchQuery(value);
            }}
            value={searchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
            iconColor="#9CA3AF"
          />
          <TouchableOpacity style={styles.qrBtn} onPress={handleScanBarcode}>
            <Icon source="qrcode-scan" size={28} color="#6B7280" />
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
            <Text style={styles.totalAmount}>RD$ {(cartTotals.totalCents / 100).toFixed(2)}</Text>
            <Text style={styles.itemsText}>{items.length} productos</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.chargeButton, getItemCount() === 0 && styles.chargeButtonDisabled]}
          onPress={() => {
            internalNavigationRef.current = true;
            navigation.navigate('Cart', { customerId, customerName, editSaleLocalId: editingSaleLocalId });
          }}
          disabled={getItemCount() === 0}
        >
          <Text style={styles.chargeButtonText}>{editingSaleLocalId ? 'Guardar Cambios' : 'Facturar'}</Text>
          <Icon source="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>
      </BottomDock>

      <Portal>
        <Modal
          visible={!!recipeDialogLineId}
          onDismiss={() => { setRecipeDialogLineId(null); setRecipeDialogMode(null); setRecipeDraft({}); setRecipeApplyScope('ALL'); }}
          contentContainerStyle={{
            backgroundColor: '#fff',
            margin: 20,
            borderRadius: 16,
            padding: 20,
            maxHeight: '80%',
          }}
        >
          <ScrollView>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 6 }}>
              Ajustes de receta
            </Text>
            <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 14 }}>
              Marca cada ingrediente como "Sin" o "Extra" según necesites.
            </Text>

            {/* Scope selector - only show when qty > 1 */}
            {(() => {
              const cartItem = items.find(i => i.lineId === recipeDialogLineId);
              if (cartItem && cartItem.quantity > 1) {
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>Aplicar a:</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                          backgroundColor: recipeApplyScope === 'ONE' ? ui.colors.primary : '#F3F4F6',
                        }}
                        onPress={() => setRecipeApplyScope('ONE')}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: recipeApplyScope === 'ONE' ? '#fff' : '#374151' }}>Solo 1 unidad</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                          backgroundColor: recipeApplyScope === 'ALL' ? ui.colors.primary : '#F3F4F6',
                        }}
                        onPress={() => setRecipeApplyScope('ALL')}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: recipeApplyScope === 'ALL' ? '#fff' : '#374151' }}>Todas las unidades</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }
              return null;
            })()}

            {(() => {
              const cartItem = items.find(i => i.lineId === recipeDialogLineId);
              const ingredients = cartItem?.recipeItems ?? [];
              if (ingredients.length === 0) {
                return <Text style={{ color: '#9CA3AF', fontSize: 13 }}>Este producto no tiene insumos definidos.</Text>;
              }
              return ingredients.map((ingredient: any) => {
                const current = recipeDraft[ingredient.ingredientId] as 'SIN' | 'EXTRA' | undefined;
                const hasMod = Boolean(current);
                return (
                  <View
                    key={ingredient.ingredientId}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      borderWidth: 1, borderColor: hasMod ? (current === 'SIN' ? '#F87171' : '#34D399') : '#E5E7EB',
                      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8,
                      backgroundColor: hasMod ? (current === 'SIN' ? '#FEF2F2' : '#ECFDF5') : '#fff',
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontWeight: '600', color: '#111827', fontSize: 14 }}>{ingredient.ingredientName}</Text>
                      {current && (
                        <Text style={{ fontSize: 11, color: current === 'SIN' ? '#DC2626' : '#059669', marginTop: 2, fontWeight: '600' }}>
                          {current === 'SIN' ? '🚫 Sin este ingrediente' : '➕ Extra de este ingrediente'}
                        </Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity
                        style={{
                          paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                          backgroundColor: current === 'SIN' ? '#DC2626' : '#F3F4F6',
                          borderWidth: 1, borderColor: current === 'SIN' ? '#DC2626' : '#E5E7EB',
                        }}
                        onPress={() => {
                          setRecipeDraft(prev => {
                            const next = { ...prev };
                            if (next[ingredient.ingredientId] === 'SIN') {
                              delete next[ingredient.ingredientId];
                            } else {
                              next[ingredient.ingredientId] = 'SIN';
                            }
                            return next;
                          });
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '800', color: current === 'SIN' ? '#fff' : '#6B7280' }}>SIN</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{
                          paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                          backgroundColor: current === 'EXTRA' ? '#059669' : '#F3F4F6',
                          borderWidth: 1, borderColor: current === 'EXTRA' ? '#059669' : '#E5E7EB',
                        }}
                        onPress={() => {
                          setRecipeDraft(prev => {
                            const next = { ...prev };
                            if (next[ingredient.ingredientId] === 'EXTRA') {
                              delete next[ingredient.ingredientId];
                            } else {
                              next[ingredient.ingredientId] = 'EXTRA';
                            }
                            return next;
                          });
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '800', color: current === 'EXTRA' ? '#fff' : '#6B7280' }}>EXTRA</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              });
            })()}

            <TouchableOpacity
              style={{
                marginTop: 10, backgroundColor: ui.colors.primary, borderRadius: 10,
                paddingVertical: 14, alignItems: 'center',
              }}
              onPress={() => {
                const cartItem = items.find(i => i.lineId === recipeDialogLineId);
                if (cartItem) {
                  const adjustments = (cartItem.recipeItems ?? []).flatMap((ingredient: any) => {
                    const adjustmentType = recipeDraft[ingredient.ingredientId];
                    if (!adjustmentType) return [];
                    return [{ ingredientId: ingredient.ingredientId, ingredientName: ingredient.ingredientName, adjustmentType }];
                  });
                  const newLineId = buildLineId(cartItem.productId, adjustments);
                  const { items: currentItems } = useCartStore.getState();
                  const shouldSplit = recipeApplyScope === 'ONE' && cartItem.quantity > 1;

                  if (shouldSplit) {
                    let nextItems = currentItems.map(item =>
                      item.lineId === recipeDialogLineId
                        ? { ...item, quantity: item.quantity - 1, totalCents: (item.quantity - 1) * item.priceCents }
                        : item
                    );
                    const existingNewLine = nextItems.find(i => i.lineId === newLineId);
                    if (existingNewLine) {
                      nextItems = nextItems.map(i =>
                        i.lineId === newLineId
                          ? { ...i, quantity: i.quantity + 1, totalCents: (i.quantity + 1) * i.priceCents }
                          : i
                      );
                    } else {
                      const insertIdx = nextItems.findIndex(i => i.lineId === recipeDialogLineId);
                      const newLine = {
                        ...cartItem,
                        lineId: newLineId,
                        quantity: 1,
                        totalCents: cartItem.priceCents,
                        recipeAdjustments: adjustments,
                      };
                      nextItems.splice(insertIdx + 1, 0, newLine);
                    }
                    useCartStore.setState({ items: nextItems });
                  } else {
                    if (newLineId !== recipeDialogLineId) {
                      const existingTarget = currentItems.find(i => i.lineId === newLineId);
                      if (existingTarget) {
                        useCartStore.setState({
                          items: currentItems
                            .filter(i => i.lineId !== recipeDialogLineId)
                            .map(i => i.lineId === newLineId
                              ? { ...i, quantity: i.quantity + cartItem.quantity, totalCents: (i.quantity + cartItem.quantity) * i.priceCents }
                              : i
                            ),
                        });
                      } else {
                        useCartStore.setState({
                          items: currentItems.map(item =>
                            item.lineId === recipeDialogLineId
                              ? { ...item, lineId: newLineId, recipeAdjustments: adjustments }
                              : item
                          ),
                        });
                      }
                    } else {
                      useCartStore.setState({
                        items: currentItems.map(item =>
                          item.lineId === recipeDialogLineId
                            ? { ...item, recipeAdjustments: adjustments }
                            : item
                        ),
                      });
                    }
                  }
                }
                setRecipeDialogLineId(null);
                setRecipeDialogMode(null);
                setRecipeDraft({});
                setRecipeApplyScope('ALL');
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Aplicar ajustes</Text>
            </TouchableOpacity>
          </ScrollView>
        </Modal>
      </Portal>
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
  qrBtn: {
    position: 'absolute',
    right: 8,
    top: 6,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  saleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  saleTitle: { fontSize: 20, color: '#111827', fontWeight: '700' },
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
  selectDisabled: { backgroundColor: '#F3F4F6' },
  selectDisabledText: { color: '#9CA3AF' },
  typeToggle: { flexDirection: 'row', backgroundColor: '#F3F4F6', padding: 4, borderRadius: 8, gap: 4 },
  typeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 6 },
  typeBtnOn: { backgroundColor: ui.colors.primary },
  typeBtnText: { color: '#6B7280', fontWeight: '700', fontSize: 13 },
  typeBtnTextOn: { color: '#fff' },
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
