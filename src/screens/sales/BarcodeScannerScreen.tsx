import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Text, Button, Surface, IconButton, Divider } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { Product } from '../../types';
import { inferProductKind, inferProductUnit } from '../../utils/productUnits';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { useCartStore } from '../../store/cartStore';

interface BarcodeScannerScreenProps {
  navigation: any;
  route?: {
    params?: {
      onScan?: (barcode: string) => void;
      onSubmitScanned?: (items: Array<{ productId: string; qty: number }>) => void;
      scannerMode?: 'SEARCH' | 'CART_SPLIT' | 'PURCHASE_SPLIT';
    };
  };
}

interface ScannerProduct extends Product {
  reference?: string | null;
}

interface ScannedItem {
  product: ScannerProduct;
  qty: number;
}

export function BarcodeScannerScreen({ navigation, route }: BarcodeScannerScreenProps) {
  const SCAN_COOLDOWN_MS = 900;
  const SAME_CODE_COOLDOWN_MS = 4000;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<ScannerProduct[]>([]);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [scanMessage, setScanMessage] = useState('Escanea un código para agregar al carrito');
  const scanCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanAtRef = useRef<number>(0);
  const lastBarcodeRef = useRef<string>('');
  const lastBarcodeAtRef = useRef<number>(0);
  const scannerMode: 'SEARCH' | 'CART_SPLIT' | 'PURCHASE_SPLIT' =
    route?.params?.scannerMode === 'CART_SPLIT'
      ? 'CART_SPLIT'
      : route?.params?.scannerMode === 'PURCHASE_SPLIT'
        ? 'PURCHASE_SPLIT'
        : 'SEARCH';
  const { addItem } = useCartStore();

  useEffect(() => {
    return () => {
      if (scanCooldownRef.current) {
        clearTimeout(scanCooldownRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (scannerMode !== 'CART_SPLIT' && scannerMode !== 'PURCHASE_SPLIT') return;

    const loadProducts = async () => {
      try {
        setLoadingProducts(true);
        const rows = await db.query<any>('SELECT * FROM products WHERE is_available_for_sale = 1 ORDER BY name');
        const mapped: ScannerProduct[] = rows.map((row) => {
          let parsedData: Record<string, unknown> | null = null;
          try {
            parsedData = row.data ? JSON.parse(row.data) : null;
          } catch {
            parsedData = null;
          }

          return {
            localId: row.local_id,
            serverId: row.server_id,
            name: row.name,
            sku: row.sku,
            reference: parsedData?.reference ? String(parsedData.reference) : null,
            priceCents: row.price_cents,
            stock: row.stock,
            unit: inferProductUnit(parsedData),
            productKind: inferProductKind(parsedData),
            synced: row.synced === 1,
            isActive: row.is_available_for_sale === 1,
            imageUrl: row.image_url,
            data: row.data,
          };
        });
        if (scannerMode === 'CART_SPLIT') {
          setAvailableProducts(mapped.filter((product) => product.synced && !!product.serverId && product.isActive));
        } else {
          setAvailableProducts(mapped);
        }
      } catch (error) {
        console.error('Error cargando productos para escaner:', error);
        setAvailableProducts([]);
      } finally {
        setLoadingProducts(false);
      }
    };

    loadProducts();
  }, [scannerMode]);

  const normalizeCode = (value: unknown) => String(value || '').trim().toLowerCase();

  const findProductByCode = (barcode: string): ScannerProduct | null => {
    const code = normalizeCode(barcode);
    if (!code) return null;

    const exactSku = availableProducts.find((product) => normalizeCode(product.sku) === code);
    if (exactSku) return exactSku;

    const exactReference = availableProducts.find((product) => normalizeCode(product.reference) === code);
    if (exactReference) return exactReference;

    return (
      availableProducts.find(
        (product) =>
          normalizeCode(product.name).includes(code) ||
          normalizeCode(product.sku).includes(code) ||
          normalizeCode(product.reference).includes(code)
      ) || null
    );
  };

  const openScanWindow = () => {
    setScanned(true);
    if (scanCooldownRef.current) {
      clearTimeout(scanCooldownRef.current);
    }
    scanCooldownRef.current = setTimeout(() => setScanned(false), SCAN_COOLDOWN_MS);
  };

  const handleSplitScan = (barcode: string) => {
    const product = findProductByCode(barcode);
    if (!product) {
      setScanMessage(`No se encontro producto para: ${barcode}`);
      openScanWindow();
      return;
    }

    if (product.productKind !== 'RECIPE' && product.stock <= 0) {
      setScanMessage(`${product.name} no tiene stock`);
      openScanWindow();
      return;
    }

    setScannedItems((prev) => {
      const existing = prev.find((entry) => entry.product.localId === product.localId);
      if (existing) {
        return prev.map((entry) =>
          entry.product.localId === product.localId
            ? { ...entry, qty: entry.qty + 1 }
            : entry
        );
      }
      return [...prev, { product, qty: 1 }];
    });
    setScanMessage(`Agregado: ${product.name}`);
    openScanWindow();
  };

  const handleBarCodeScanned = (scanningResult: BarcodeScanningResult) => {
    const { data } = scanningResult;
    const normalizedData = normalizeCode(data);
    if (!normalizedData) return;

    const now = Date.now();
    if (now - lastScanAtRef.current < SCAN_COOLDOWN_MS) return;

    if (
      lastBarcodeRef.current === normalizedData &&
      now - lastBarcodeAtRef.current < SAME_CODE_COOLDOWN_MS
    ) {
      if (scannerMode === 'CART_SPLIT') {
        setScanMessage('Ese codigo ya fue leido. Espera 4 segundos para repetir.');
      }
      return;
    }

    lastScanAtRef.current = now;
    lastBarcodeRef.current = normalizedData;
    lastBarcodeAtRef.current = now;

    if (scanned) return;

    if (scannerMode === 'CART_SPLIT') {
      handleSplitScan(data);
      return;
    }

    setScanned(true);
    if (route?.params?.onScan) {
      route.params.onScan(data);
    }
    navigation.goBack();
  };

  const updateScannedQty = (productLocalId: string, delta: number) => {
    setScannedItems((prev) =>
      prev
        .map((entry) =>
          entry.product.localId === productLocalId
            ? { ...entry, qty: Math.max(0, entry.qty + delta) }
            : entry
        )
        .filter((entry) => entry.qty > 0)
    );
  };

  const totalItems = useMemo(
    () => scannedItems.reduce((sum, entry) => sum + entry.qty, 0),
    [scannedItems]
  );

  const totalCents = useMemo(
    () => scannedItems.reduce((sum, entry) => sum + entry.qty * entry.product.priceCents, 0),
    [scannedItems]
  );

  const handleAddScannedToCart = () => {
    if (scannedItems.length === 0) {
      navigation.goBack();
      return;
    }

    if (scannerMode === 'CART_SPLIT') {
      scannedItems.forEach((entry) => {
        addItem(entry.product, entry.qty);
      });
    } else if (scannerMode === 'PURCHASE_SPLIT') {
      route?.params?.onSubmitScanned?.(
        scannedItems.map((entry) => ({
          productId: entry.product.localId,
          qty: entry.qty,
        }))
      );
    }
    navigation.goBack();
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text>Cargando cámara...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.permissionText}>
            Necesitamos acceso a la cámara para escanear códigos de barras
          </Text>
          <Button mode="contained" onPress={requestPermission} style={styles.permissionButton}>
            Permitir Cámara
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (scannerMode === 'CART_SPLIT' || scannerMode === 'PURCHASE_SPLIT') {
    return (
      <SafeAreaView style={styles.splitContainer}>
        <View style={styles.cameraSplitWrap}>
          <CameraView
            style={styles.camera}
            facing="back"
            enableTorch={torch}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
            }}
          >
            <View style={styles.overlay}>
              <View style={styles.header}>
                <IconButton
                  icon="arrow-left"
                  iconColor="#fff"
                  size={28}
                  onPress={() => navigation.goBack()}
                />
                <Text style={styles.headerText}>
                  {scannerMode === 'PURCHASE_SPLIT' ? 'Escanear para compra' : 'Escanear y agregar'}
                </Text>
                <IconButton
                  icon={torch ? 'flashlight-off' : 'flashlight'}
                  iconColor="#fff"
                  size={28}
                  onPress={() => setTorch(!torch)}
                />
              </View>

              <View style={styles.scanArea}>
                <View style={styles.scanFrame}>
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />
                </View>
              </View>
            </View>
          </CameraView>
        </View>

        <Surface style={styles.cartPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>Items escaneados</Text>
              <Text style={styles.panelSubtitle}>{totalItems} items</Text>
            </View>
            <Text style={styles.panelTotal}>{formatCurrency(totalCents)}</Text>
          </View>
          <Text style={styles.scanMessage}>{scanMessage}</Text>
          <Divider style={styles.panelDivider} />

          <FlatList
            data={scannedItems}
            keyExtractor={(entry) => entry.product.localId}
            contentContainerStyle={{ paddingBottom: 12 }}
            ListEmptyComponent={
              <Text style={styles.emptyListText}>
                {loadingProducts ? 'Cargando productos...' : 'Aun no has escaneado productos.'}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.scannedRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scannedName} numberOfLines={1}>{item.product.name}</Text>
                  <Text style={styles.scannedPrice}>{formatCurrency(item.product.priceCents)}</Text>
                </View>
                <View style={styles.qtyControls}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => updateScannedQty(item.product.localId, -1)}>
                    <Text style={styles.qtyBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyValue}>{item.qty}</Text>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => updateScannedQty(item.product.localId, 1)}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />

          <Button
            mode="contained"
            onPress={handleAddScannedToCart}
            disabled={scannedItems.length === 0}
            buttonColor={ui.colors.primary}
            style={styles.addButton}
            contentStyle={styles.addButtonContent}
          >
            {scannerMode === 'PURCHASE_SPLIT' ? 'Agregar a compra' : 'Agregar al carrito'}
          </Button>
        </Surface>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={torch}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
        }}
      >
        <View style={styles.overlay}>
          <View style={styles.header}>
            <IconButton
              icon="arrow-left"
              iconColor="#fff"
              size={28}
              onPress={() => navigation.goBack()}
            />
            <Text style={styles.headerText}>Escanear Código</Text>
            <IconButton
              icon={torch ? 'flashlight-off' : 'flashlight'}
              iconColor="#fff"
              size={28}
              onPress={() => setTorch(!torch)}
            />
          </View>

          <View style={styles.scanArea}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Apunta la cámara hacia el código de barras
            </Text>
            {scanned && (
              <Button 
                mode="contained" 
                onPress={() => setScanned(false)}
                style={styles.rescanButton}
              >
                Escanear de nuevo
              </Button>
            )}
          </View>
        </View>
      </CameraView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  splitContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraSplitWrap: {
    flex: 0.7,
    minHeight: 170,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  permissionButton: {
    marginTop: 10,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  headerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scanArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 280,
    height: 200,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#1a73e8',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  rescanButton: {
    marginTop: 16,
  },
  cartPanel: {
    flex: 1.3,
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  panelSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  panelTotal: {
    fontSize: 22,
    fontWeight: '800',
    color: ui.colors.primary,
  },
  scanMessage: {
    fontSize: 12,
    color: '#4B5563',
    marginTop: 6,
  },
  panelDivider: {
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: '#E5E7EB',
  },
  emptyListText: {
    textAlign: 'center',
    color: '#6B7280',
    marginTop: 18,
  },
  scannedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 10,
  },
  scannedName: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '600',
  },
  scannedPrice: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  qtyValue: {
    minWidth: 18,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  addButton: {
    borderRadius: 12,
    marginTop: 8,
  },
  addButtonContent: {
    height: 48,
  },
});
