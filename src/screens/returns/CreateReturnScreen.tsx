import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, ScrollView, Image } from 'react-native';
import { Text, Surface, Searchbar, Button, IconButton, TextInput, Divider, ActivityIndicator } from 'react-native-paper';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { SafeFab } from '../../components/SafeFab';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { db } from '../../database/Database';

interface CreateReturnScreenProps {
  navigation: any;
}

interface SaleSearchResult {
  id: string;
  invoiceCode: string;
  soldAt: string | null;
  type: string;
  totalCents: number;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
  } | null;
}

interface SaleDetailItem {
  saleItemId: string;
  productId: string;
  qty: number;
  returnedQty: number;
  availableQty: number;
  unitPriceCents: number;
  product?: {
    id: string;
    name: string;
    sku?: string | null;
    reference?: string | null;
    saleUnit?: string | null;
  } | null;
}

interface SaleDetail {
  id: string;
  invoiceCode: string;
  soldAt: string | null;
  type: string;
  totalCents: number;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
  } | null;
  items: SaleDetailItem[];
}

interface ReturnDraftItem {
  saleItemId: string;
  productId: string;
  productName: string;
  availableQty: number;
  unitPriceCents: number;
  qty: number;
}

interface CustomerOption {
  localId: string;
  serverId: string;
  name: string;
  phone?: string | null;
}

interface ReturnListItem {
  id: string;
  returnCode: string;
  saleId: string;
  totalCents: number;
  notes?: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  sale?: {
    id: string;
    invoiceCode: string;
    type: string;
    customer?: {
      id: string;
      name: string;
    } | null;
  } | null;
  items?: Array<{
    id: string;
    saleItemId: string;
    productId: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    product?: {
      name?: string | null;
    } | null;
  }>;
}

interface ReturnReceiptPayload {
  returnId?: string;
  returnCode: string;
  returnedAt: number;
  invoiceCode: string;
  customerName: string;
  totalCents: number;
  notes?: string | null;
  items: Array<{
    productName: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
}

type ReturnScreenMode = 'LIST' | 'CREATE';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
const EMPTY_SEARCH_IMAGE = require('../../../assets/lupa.png');

export function CreateReturnScreen({ navigation }: CreateReturnScreenProps) {
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();
  const [screenMode, setScreenMode] = useState<ReturnScreenMode>('LIST');

  const [query, setQuery] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SaleSearchResult[]>([]);
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null);
  const [loadingSale, setLoadingSale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [returnItems, setReturnItems] = useState<ReturnDraftItem[]>([]);
  const [returnsList, setReturnsList] = useState<ReturnListItem[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(true);
  const [refreshingReturns, setRefreshingReturns] = useState(false);
  const [returnsError, setReturnsError] = useState<string | null>(null);

  const totalCents = useMemo(
    () => returnItems.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0),
    [returnItems]
  );
  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(q) ||
        (customer.phone || '').toLowerCase().includes(q)
    );
  }, [customerQuery, customers]);

  const buildHeaders = async () => {
    const clerkToken = await getToken();
    if (!clerkToken || !subUserToken) {
      throw new Error('No hay sesión activa para consultar devoluciones.');
    }
    return {
      Authorization: `Bearer ${clerkToken}`,
      'X-Clerk-Authorization': `Bearer ${clerkToken}`,
      'X-SubUser-Token': subUserToken,
      ...(accountId ? { 'X-Account-Id': accountId } : {}),
    };
  };

  const resetCreateDraft = () => {
    setCustomerQuery('');
    setSelectedCustomer(null);
    setQuery('');
    setSearchResults([]);
    setSelectedSale(null);
    setNotes('');
    setReturnItems([]);
  };

  const loadReturns = async (refresh = false) => {
    try {
      if (refresh) {
        setRefreshingReturns(true);
      } else {
        setLoadingReturns(true);
      }
      setReturnsError(null);
      const headers = await buildHeaders();
      const response = await axios.get(`${API_URL}/api/returns`, { headers });
      setReturnsList(response.data?.data || []);
    } catch (error: any) {
      const message = error?.response?.data?.error || 'No se pudo cargar el listado de devoluciones.';
      console.error('Error cargando devoluciones:', error?.response?.data || error?.message || error);
      setReturnsList([]);
      setReturnsError(message);
    } finally {
      setLoadingReturns(false);
      setRefreshingReturns(false);
    }
  };

  const openCreateMode = () => {
    resetCreateDraft();
    setScreenMode('CREATE');
  };

  const openListMode = () => {
    resetCreateDraft();
    setScreenMode('LIST');
    void loadReturns();
  };

  const buildReceiptFromListedReturn = (item: ReturnListItem): ReturnReceiptPayload => ({
    returnId: item.id,
    returnCode: item.returnCode,
    returnedAt: item.returnedAt ? new Date(item.returnedAt).getTime() : Date.now(),
    invoiceCode: item.sale?.invoiceCode || '-',
    customerName: item.sale?.customer?.name || 'Cliente general',
    totalCents: item.totalCents,
    notes: item.notes || null,
    items: (item.items || []).map((returnItem) => ({
      productName: returnItem.product?.name || 'Producto',
      qty: Number(returnItem.qty) || 0,
      unitPriceCents: Number(returnItem.unitPriceCents) || 0,
      lineTotalCents:
        Number(returnItem.lineTotalCents) ||
        (Number(returnItem.unitPriceCents) || 0) * (Number(returnItem.qty) || 0),
    })),
  });

  useEffect(() => {
    void loadReturns();
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadCustomers = async () => {
      try {
        setLoadingCustomers(true);
        const rows = await db.query<{ local_id: string; server_id: string; name: string; phone?: string | null }>(
          'SELECT local_id, server_id, name, phone FROM customers WHERE server_id IS NOT NULL ORDER BY name'
        );
        if (!mounted) return;
        setCustomers(
          rows.map((row) => ({
            localId: row.local_id,
            serverId: row.server_id,
            name: row.name,
            phone: row.phone || null,
          }))
        );
      } catch (error) {
        console.error('Error cargando clientes para devoluciones:', error);
        if (!mounted) return;
        setCustomers([]);
      } finally {
        if (mounted) setLoadingCustomers(false);
      }
    };

    loadCustomers();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedCustomer) {
      setSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setSearching(true);
        const headers = await buildHeaders();
        const response = await axios.get(`${API_URL}/api/returns/sales`, {
          headers,
          params: { query: query.trim(), customerId: selectedCustomer.serverId },
        });
        setSearchResults(response.data?.data || []);
      } catch (error: any) {
        setSearchResults([]);
        console.error('Error buscando ventas para devolución:', error?.response?.data || error?.message || error);
      } finally {
        setSearching(false);
      }
    }, 320);

    return () => clearTimeout(t);
  }, [query, selectedCustomer]);

  const handleSelectSale = async (saleId: string) => {
    try {
      setLoadingSale(true);
      const headers = await buildHeaders();
      const response = await axios.get(`${API_URL}/api/returns/sales/${saleId}`, { headers });
      const detail: SaleDetail = response.data;
      setSelectedSale(detail);
      setReturnItems([]);
      setNotes('');
      setQuery('');
      setSearchResults([]);
    } catch (error: any) {
      console.error('Error cargando detalle de venta para devolución:', error?.response?.data || error?.message || error);
      Alert.alert('Error', error?.response?.data?.error || 'No se pudo cargar la venta.');
    } finally {
      setLoadingSale(false);
    }
  };

  const addItemToReturn = (item: SaleDetailItem) => {
    if (item.availableQty <= 0) return;

    setReturnItems((prev) => {
      const existing = prev.find((x) => x.saleItemId === item.saleItemId);
      if (existing) {
        if (existing.qty >= existing.availableQty) return prev;
        return prev.map((x) =>
          x.saleItemId === item.saleItemId
            ? { ...x, qty: Math.min(x.qty + 1, x.availableQty) }
            : x
        );
      }
      return [
        ...prev,
        {
          saleItemId: item.saleItemId,
          productId: item.productId,
          productName: item.product?.name || 'Producto',
          availableQty: item.availableQty,
          unitPriceCents: item.unitPriceCents,
          qty: 1,
        },
      ];
    });
  };

  const changeItemQty = (saleItemId: string, nextQty: number) => {
    setReturnItems((prev) =>
      prev.map((item) =>
        item.saleItemId === saleItemId
          ? { ...item, qty: Math.max(1, Math.min(nextQty, item.availableQty)) }
          : item
      )
    );
  };

  const removeDraftItem = (saleItemId: string) => {
    setReturnItems((prev) => prev.filter((x) => x.saleItemId !== saleItemId));
  };

  const handleSave = async () => {
    if (!selectedSale) return;
    if (returnItems.length === 0) {
      Alert.alert('Error', 'Debes agregar al menos un producto a devolver.');
      return;
    }

    try {
      setSaving(true);
      const selectedSaleSnapshot = selectedSale;
      const returnItemsSnapshot = [...returnItems];
      const notesSnapshot = notes.trim();
      const headers = await buildHeaders();
      const payload = {
        saleId: selectedSaleSnapshot.id,
        items: returnItemsSnapshot.map((item) => ({
          saleItemId: item.saleItemId,
          productId: item.productId,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
        })),
        notes: notesSnapshot || null,
      };

      const response = await axios.post(`${API_URL}/api/returns`, payload, { headers });
      const returnCode = response.data?.returnCode || 'DEV-LOCAL';
      const receipt: ReturnReceiptPayload = {
        returnId: response.data?.id || undefined,
        returnCode,
        returnedAt: Date.now(),
        invoiceCode: selectedSaleSnapshot.invoiceCode || '-',
        customerName: selectedSaleSnapshot.customer?.name || 'Cliente general',
        totalCents: returnItemsSnapshot.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0),
        notes: notesSnapshot || null,
        items: returnItemsSnapshot.map((item) => ({
          productName: item.productName,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.unitPriceCents * item.qty,
        })),
      };

      openListMode();
      navigation.navigate('ReturnReceipt', { receipt, autoPrint: true });
    } catch (error: any) {
      console.error('Error creando devolución:', error?.response?.data || error?.message || error);
      Alert.alert('Error', error?.response?.data?.error || 'No se pudo crear la devolución.');
    } finally {
      setSaving(false);
    }
  };

  const renderReturnsList = () => {
    if (loadingReturns) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator />
          <Text style={styles.helperText}>Cargando devoluciones...</Text>
        </View>
      );
    }

    if (returnsError) {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.helperText}>{returnsError}</Text>
          <Button mode="text" onPress={() => void loadReturns(true)}>
            Reintentar
          </Button>
        </View>
      );
    }

    if (!returnsList.length) {
      return (
        <View style={styles.emptyState}>
          <Image source={EMPTY_SEARCH_IMAGE} style={styles.emptyImage} resizeMode="contain" />
          <Text style={styles.emptyTitle}>No hay devoluciones</Text>
          <Text style={styles.helperText}>Todavía no se ha registrado ninguna devolución.</Text>
        </View>
      );
    }

    return (
      <View style={styles.listPad}>
        {returnsList.map((item) => (
          <Surface key={item.id} style={styles.returnCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.saleCode}>{item.returnCode}</Text>
              <Text style={styles.saleMeta}>
                {item.sale?.customer?.name || 'Cliente general'} · {item.sale?.invoiceCode || 'Sin factura'}
              </Text>
              <Text style={styles.saleMeta}>
                {item.returnedAt ? new Date(item.returnedAt).toLocaleDateString('es-DO') : '-'}
              </Text>
            </View>
            <View style={styles.returnAmountBox}>
              <Text style={styles.returnAmount}>{formatCurrency(item.totalCents)}</Text>
              <Button
                mode="text"
                compact
                icon="printer"
                contentStyle={styles.reprintButtonContent}
                labelStyle={styles.reprintButtonLabel}
                onPress={() =>
                  navigation.navigate('ReturnReceipt', {
                    receipt: buildReceiptFromListedReturn(item),
                    autoPrint: true,
                  })
                }
              >
                Reimprimir
              </Button>
              {item.cancelledAt ? <Text style={styles.returnCancelled}>Cancelada</Text> : null}
            </View>
          </Surface>
        ))}
      </View>
    );
  };

  const renderSaleSearch = () => (
    <View style={styles.block}>
      {!selectedCustomer ? (
        <>
          <Text style={styles.sectionTitle}>Seleccionar cliente</Text>
          <Searchbar
            placeholder="Buscar cliente..."
            placeholderTextColor="#B8B2C8"
            value={customerQuery}
            onChangeText={setCustomerQuery}
            style={styles.search}
          />

          {loadingCustomers ? (
            <View style={styles.centerBox}>
              <ActivityIndicator />
              <Text style={styles.helperText}>Cargando clientes...</Text>
            </View>
          ) : (
            <View style={styles.listPad}>
              {filteredCustomers.map((customer) => (
                <Surface key={customer.localId} style={styles.saleCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.saleCode}>{customer.name}</Text>
                    {customer.phone ? <Text style={styles.saleMeta}>{customer.phone}</Text> : null}
                  </View>
                  <Button
                    mode="contained-tonal"
                    onPress={() => {
                      setSelectedCustomer(customer);
                      setQuery('');
                      setSearchResults([]);
                    }}
                  >
                    Elegir
                  </Button>
                </Surface>
              ))}
              {!filteredCustomers.length ? (
                <View style={styles.centerBox}>
                  <Text style={styles.helperText}>No hay clientes para seleccionar</Text>
                </View>
              ) : null}
            </View>
          )}
        </>
      ) : (
        <>
          <Surface style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Cliente:</Text>
              <Text style={styles.summaryValue}>{selectedCustomer.name}</Text>
            </View>
            <Button
              mode="text"
              onPress={() => {
                setSelectedCustomer(null);
                setQuery('');
                setSearchResults([]);
              }}
            >
              Cambiar cliente
            </Button>
          </Surface>

          <Text style={styles.sectionTitle}>Facturas del cliente</Text>
          <Searchbar
            placeholder="Buscar factura..."
            placeholderTextColor="#B8B2C8"
            value={query}
            onChangeText={setQuery}
            style={styles.search}
          />
        </>
      )}

      {searching ? (
        <View style={styles.centerBox}>
          <ActivityIndicator />
          <Text style={styles.helperText}>Cargando facturas...</Text>
        </View>
      ) : null}

      {!searching && selectedCustomer && searchResults.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={styles.helperText}>No hay facturas para este cliente</Text>
        </View>
      ) : null}

      <View style={styles.listPad}>
        {searchResults.map((item) => (
          <Surface key={item.id} style={styles.saleCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.saleCode}>{item.invoiceCode}</Text>
              <Text style={styles.saleMeta}>
                {item.customer?.name || 'Cliente general'} · {item.soldAt ? new Date(item.soldAt).toLocaleDateString('es-DO') : '-'}
              </Text>
              <Text style={styles.saleMeta}>{formatCurrency(item.totalCents)}</Text>
            </View>
            <Button mode="contained-tonal" onPress={() => handleSelectSale(item.id)}>
              Seleccionar
            </Button>
          </Surface>
        ))}
      </View>
    </View>
  );

  const renderSaleItems = () => (
    <View style={styles.block}>
      <Surface style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Factura:</Text>
          <Text style={styles.summaryValue}>{selectedSale?.invoiceCode}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Cliente:</Text>
          <Text style={styles.summaryValue}>{selectedSale?.customer?.name || 'Cliente general'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total venta:</Text>
          <Text style={styles.summaryValue}>{formatCurrency(selectedSale?.totalCents || 0)}</Text>
        </View>
        <Button mode="text" onPress={() => setSelectedSale(null)}>
          Cambiar venta
        </Button>
      </Surface>

      <Text style={styles.sectionTitle}>Productos de la venta</Text>
      <View style={styles.listPad}>
        {(selectedSale?.items || []).map((item) => (
          <Surface key={item.saleItemId} style={styles.itemCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.product?.name || 'Producto'}</Text>
              <Text style={styles.itemMeta}>
                Vendido: {item.qty} · Devuelto: {item.returnedQty} · Disponible: {item.availableQty}
              </Text>
              <Text style={styles.itemMeta}>{formatCurrency(item.unitPriceCents)}</Text>
            </View>
            <Button
              mode="outlined"
              onPress={() => addItemToReturn(item)}
              disabled={item.availableQty <= 0}
            >
              Agregar
            </Button>
          </Surface>
        ))}
      </View>

      {returnItems.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Productos a devolver</Text>
          <View style={styles.listPad}>
            {returnItems.map((item) => (
              <Surface key={item.saleItemId} style={styles.itemCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.productName}</Text>
                  <Text style={styles.itemMeta}>
                    Máximo: {item.availableQty} · {formatCurrency(item.unitPriceCents)} c/u
                  </Text>
                </View>
                <View style={styles.qtyBox}>
                  <IconButton icon="minus" size={18} onPress={() => changeItemQty(item.saleItemId, item.qty - 1)} />
                  <Text style={styles.qtyText}>{item.qty}</Text>
                  <IconButton icon="plus" size={18} onPress={() => changeItemQty(item.saleItemId, item.qty + 1)} />
                </View>
                <IconButton icon="delete" size={20} iconColor={ui.colors.danger} onPress={() => removeDraftItem(item.saleItemId)} />
              </Surface>
            ))}
          </View>

          <TextInput
            label="Notas (opcional)"
            mode="outlined"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={2}
            style={styles.notesInput}
          />
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {screenMode === 'LIST' ? (
        <ScrollView contentContainerStyle={styles.historyScrollContent}>
          <View style={styles.block}>
            <View style={styles.historyHeader}>
              <Text style={styles.screenTitle}>Devoluciones</Text>
              <Button
                mode="text"
                icon="refresh"
                compact
                loading={refreshingReturns}
                disabled={refreshingReturns}
                onPress={() => void loadReturns(true)}
              >
                Actualizar
              </Button>
            </View>
            {renderReturnsList()}
          </View>
        </ScrollView>
      ) : loadingSale ? (
        <View style={styles.centerFull}>
          <ActivityIndicator />
          <Text style={styles.helperText}>Cargando venta...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.createHeader}>
            <Button mode="text" icon="arrow-left" onPress={openListMode}>
              Volver al listado
            </Button>
          </View>
          {!selectedSale ? renderSaleSearch() : renderSaleItems()}
        </ScrollView>
      )}

      {screenMode === 'LIST' ? (
        <SafeFab
          icon="plus"
          color="#fff"
          style={styles.fab}
          bottomOffset={8}
          rightOffset={18}
          onPress={openCreateMode}
        />
      ) : null}

      {screenMode === 'CREATE' && selectedSale && returnItems.length > 0 ? (
        <BottomDock>
          <Surface style={styles.bottomCard}>
            <Divider style={{ marginBottom: 12 }} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total devolución:</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalCents)}</Text>
            </View>
            <Button
              mode="contained"
              onPress={handleSave}
              loading={saving}
              disabled={saving}
              buttonColor={ui.colors.primary}
              textColor="#fff"
              style={styles.saveBtn}
            >
              Confirmar Devolución
            </Button>
          </Surface>
        </BottomDock>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.background,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 140,
  },
  historyScrollContent: {
    padding: 12,
    paddingBottom: 120,
  },
  block: {
    gap: 8,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  createHeader: {
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: ui.colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: ui.colors.text,
    marginTop: 6,
  },
  search: {
    backgroundColor: ui.colors.surface,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 18,
  },
  emptyImage: {
    width: 190,
    height: 190,
  },
  emptyTitle: {
    marginTop: 6,
    color: ui.colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  helperText: {
    marginTop: 6,
    color: ui.colors.textMuted,
    textAlign: 'center',
  },
  centerFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listPad: {
    paddingBottom: 8,
    gap: 8,
  },
  saleCard: {
    padding: 12,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  returnCard: {
    padding: 12,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  saleCode: {
    fontSize: 15,
    fontWeight: '700',
    color: ui.colors.text,
  },
  saleMeta: {
    marginTop: 2,
    color: ui.colors.textMuted,
    fontSize: 12,
  },
  returnAmountBox: {
    alignItems: 'flex-end',
    minWidth: 96,
  },
  returnAmount: {
    color: ui.colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  reprintButtonContent: {
    height: 28,
  },
  reprintButtonLabel: {
    fontSize: 11,
    marginVertical: 0,
    marginHorizontal: 0,
  },
  returnCancelled: {
    marginTop: 4,
    color: ui.colors.danger,
    fontSize: 11,
    fontWeight: '700',
  },
  summaryCard: {
    padding: 12,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 10,
  },
  summaryLabel: {
    color: ui.colors.textMuted,
  },
  summaryValue: {
    color: ui.colors.text,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  itemCard: {
    padding: 12,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: ui.colors.text,
  },
  itemMeta: {
    marginTop: 2,
    color: ui.colors.textMuted,
    fontSize: 12,
  },
  qtyBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qtyText: {
    minWidth: 26,
    textAlign: 'center',
    fontWeight: '700',
    color: ui.colors.text,
  },
  notesInput: {
    marginTop: 6,
    backgroundColor: ui.colors.surface,
  },
  bottomCard: {
    padding: 12,
    backgroundColor: ui.colors.surface,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  totalLabel: {
    color: ui.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  totalValue: {
    color: ui.colors.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  saveBtn: {
    borderRadius: ui.radius.md,
  },
  fab: {
    backgroundColor: ui.colors.primary,
    shadowColor: ui.colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
