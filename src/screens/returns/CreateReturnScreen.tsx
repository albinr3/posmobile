import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Alert, ScrollView, Image } from 'react-native';
import { Text, Surface, Searchbar, Button, IconButton, TextInput, Divider, ActivityIndicator } from 'react-native-paper';
import { useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { SafeFab } from '../../components/SafeFab';
import { formatCurrency, generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { db } from '../../database/Database';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { useAuthStore } from '../../store/authStore';

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

interface ReturnPolicy {
  canCreateReturn: boolean;
  blockedReason: string | null;
  maxReturnCents: number | null;
  currentBalanceCents: number | null;
  arLocalId?: string | null;
}

interface SaleDetail {
  id: string;
  invoiceCode: string;
  soldAt: string | null;
  type: string;
  totalCents: number;
  returnPolicy: ReturnPolicy;
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
  serverId: string | null;
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

const EMPTY_SEARCH_IMAGE = require('../../../assets/lupa.png');

function parseJsonSafe(value: any): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIsoString(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const ts = num > 1_000_000_000_000 ? num : num * 1000;
  return new Date(ts).toISOString();
}

export function CreateReturnScreen({ navigation }: CreateReturnScreenProps) {
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();
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
  const maxReturnCents = selectedSale?.returnPolicy.maxReturnCents ?? null;
  const isReturnBlocked = selectedSale ? !selectedSale.returnPolicy.canCreateReturn : false;
  const exceedsCreditLimit = maxReturnCents !== null && totalCents > maxReturnCents;
  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(q) ||
        (customer.phone || '').toLowerCase().includes(q)
    );
  }, [customerQuery, customers]);

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

      if (refresh && isOnline) {
        try {
          const clerkToken = await getToken();
          if (clerkToken) {
            syncService.setGetTokenFunction(() => getToken());
            syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
            await syncService.fullSync(clerkToken, { ignoreCooldown: true });
          }
        } catch (syncError) {
          console.error('Error sincronizando devoluciones en refresh:', syncError);
        }
      }

      const returnRows = await db.query<any>(
        `SELECT local_id, server_id, return_code, sale_local_id, sale_server_id, total_cents, notes, returned_at, cancelled_at, data
         FROM returns
         ORDER BY returned_at DESC, rowid DESC`
      );

      const mapped: ReturnListItem[] = [];
      for (const row of returnRows) {
        const parsed = parseJsonSafe(row.data);
        const localId = String(row.local_id);
        const saleLocalId = row.sale_local_id ? String(row.sale_local_id) : null;
        const saleServerId = row.sale_server_id ? String(row.sale_server_id) : null;
        const saleRow = saleLocalId
          ? await db.queryFirst<any>('SELECT local_id, server_id, invoice_code, data FROM sales WHERE local_id = ?', [saleLocalId])
          : saleServerId
            ? await db.queryFirst<any>('SELECT local_id, server_id, invoice_code, data FROM sales WHERE server_id = ?', [saleServerId])
            : null;
        const saleParsed = parseJsonSafe(saleRow?.data);

        const returnItemRows = await db.query<any>(
          `SELECT local_id, sale_item_id, product_local_id, product_server_id, product_name, qty, unit_price_cents, line_total_cents, data
           FROM return_items
           WHERE return_local_id = ?
           ORDER BY rowid ASC`,
          [localId]
        );

        const items = returnItemRows.map((returnItemRow) => {
          const returnItemParsed = parseJsonSafe(returnItemRow.data);
          return {
            id: String(returnItemParsed?.id || returnItemRow.local_id),
            saleItemId: String(returnItemParsed?.saleItemId || returnItemRow.sale_item_id || ''),
            productId: String(
              returnItemParsed?.productId ||
                returnItemRow.product_server_id ||
                returnItemRow.product_local_id ||
                ''
            ),
            qty: Number(returnItemParsed?.qty || returnItemRow.qty || 0),
            unitPriceCents: Number(returnItemParsed?.unitPriceCents || returnItemRow.unit_price_cents || 0),
            lineTotalCents: Number(returnItemParsed?.lineTotalCents || returnItemRow.line_total_cents || 0),
            product: {
              name: String(
                returnItemParsed?.product?.name ||
                  returnItemParsed?.productName ||
                  returnItemRow.product_name ||
                  'Producto'
              ),
            },
          };
        });

        mapped.push({
          id: String(row.server_id || row.local_id),
          returnCode: String(row.return_code || parsed?.returnCode || `DEV-LOCAL-${localId.slice(-6)}`),
          saleId: String(parsed?.saleId || saleServerId || saleLocalId || ''),
          totalCents: Number(parsed?.totalCents || row.total_cents || 0),
          notes: parsed?.notes ? String(parsed.notes) : row.notes ? String(row.notes) : null,
          returnedAt: toIsoString(parsed?.returnedAt || row.returned_at),
          cancelledAt: toIsoString(parsed?.cancelledAt || row.cancelled_at),
          sale: {
            id: String(
              parsed?.sale?.id ||
                parsed?.saleId ||
                saleRow?.server_id ||
                saleRow?.local_id ||
                saleServerId ||
                saleLocalId ||
                ''
            ),
            invoiceCode: String(parsed?.sale?.invoiceCode || saleRow?.invoice_code || saleParsed?.invoiceCode || '-'),
            type: String(parsed?.sale?.type || saleParsed?.type || 'CONTADO'),
            customer: {
              id: String(parsed?.sale?.customer?.id || saleParsed?.customerId || ''),
              name: String(parsed?.sale?.customer?.name || saleParsed?.customerName || 'Cliente general'),
            },
          },
          items,
        });
      }

      setReturnsList(mapped);
    } catch (error: any) {
      const message = 'No se pudo cargar el listado de devoluciones.';
      console.error('Error cargando devoluciones:', error?.message || error);
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
    const unsubscribe = navigation.addListener('focus', () => {
      void loadReturns(true);
    });
    return unsubscribe;
  }, [navigation, isOnline, getToken]);

  useEffect(() => {
    let mounted = true;
    const loadCustomers = async () => {
      try {
        setLoadingCustomers(true);
        const rows = await db.query<{ local_id: string; server_id: string; name: string; phone?: string | null }>(
          'SELECT local_id, server_id, name, phone FROM customers ORDER BY name'
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
        const ids = [selectedCustomer.localId, selectedCustomer.serverId].filter(
          (value): value is string => Boolean(value)
        );
        if (!ids.length) {
          setSearchResults([]);
          return;
        }

        const placeholders = ids.map(() => '?').join(', ');
        const rows = await db.query<any>(
          `SELECT local_id, server_id, invoice_code, customer_id, total_cents, status, created_at, data
           FROM sales
           WHERE customer_id IN (${placeholders})
           ORDER BY created_at DESC, rowid DESC`,
          ids
        );

        const q = query.trim().toLowerCase();
        const localResults: SaleSearchResult[] = rows
          .map((row) => {
            const parsed = parseJsonSafe(row.data);
            const soldAt = toIsoString(parsed?.soldAt || parsed?.createdAt || row.created_at);
            const status = String(parsed?.status || row.status || '').toLowerCase();
            const invoiceCode = String(row.invoice_code || parsed?.invoiceCode || '-');
            return {
              id: String(row.local_id || row.server_id),
              invoiceCode,
              soldAt,
              type: String(parsed?.type || 'CONTADO'),
              totalCents: Number(parsed?.totalCents || row.total_cents || 0),
              status,
            };
          })
          .filter((row) => row.status !== 'cancelled')
          .filter((row) => !q || row.invoiceCode.toLowerCase().includes(q))
          .map((row) => ({
            id: row.id,
            invoiceCode: row.invoiceCode,
            soldAt: row.soldAt,
            type: row.type,
            totalCents: row.totalCents,
            customer: {
              id: selectedCustomer.serverId || selectedCustomer.localId,
              name: selectedCustomer.name,
              phone: selectedCustomer.phone || null,
            },
          }));

        setSearchResults(localResults);
      } catch (error: any) {
        setSearchResults([]);
        console.error('Error buscando ventas para devolución:', error?.message || error);
      } finally {
        setSearching(false);
      }
    }, 320);

    return () => clearTimeout(t);
  }, [query, selectedCustomer]);

  const handleSelectSale = async (saleId: string) => {
    try {
      setLoadingSale(true);
      const saleRow = await db.queryFirst<any>(
        'SELECT local_id, server_id, invoice_code, total_cents, created_at, status, data FROM sales WHERE local_id = ? OR server_id = ? LIMIT 1',
        [saleId, saleId]
      );
      if (!saleRow) {
        Alert.alert('Error', 'No se encontró la venta seleccionada en la base local.');
        return;
      }

      const parsedSale = parseJsonSafe(saleRow.data);
      const saleLocalId = String(saleRow.local_id || saleId);
      const saleServerId = saleRow.server_id ? String(saleRow.server_id) : null;
      const soldAt = toIsoString(parsedSale?.soldAt || parsedSale?.createdAt || saleRow.created_at);
      const saleType = String(parsedSale?.type || 'CONTADO').toUpperCase();

      const returnRows = await db.query<{ sale_item_id: string; returned_qty: number }>(
        `SELECT ri.sale_item_id, SUM(ri.qty) AS returned_qty
         FROM return_items ri
         INNER JOIN returns r ON r.local_id = ri.return_local_id
         WHERE (r.sale_local_id = ? OR r.sale_server_id = ?)
           AND r.cancelled_at IS NULL
         GROUP BY ri.sale_item_id`,
        [saleLocalId, saleServerId || saleId]
      );
      const returnedByItem = new Map<string, number>();
      for (const row of returnRows) {
        returnedByItem.set(String(row.sale_item_id || ''), Number(row.returned_qty || 0));
      }

      const rawItems = Array.isArray(parsedSale?.items) ? parsedSale.items : [];
      const items: SaleDetailItem[] = rawItems
        .map((item: any, index: number) => {
          const saleItemId = String(item?.saleItemId || item?.id || `${saleLocalId}_${index}`);
          const soldQty = Number(item?.qty ?? item?.quantity ?? 0);
          const returnedQty = Number(returnedByItem.get(saleItemId) || 0);
          const availableQty = Math.max(0, soldQty - returnedQty);
          const unitPriceCents = Number(item?.unitPriceCents ?? item?.priceCents ?? item?.price ?? 0);
          const productId = String(item?.productId || '');

          return {
            saleItemId,
            productId,
            qty: soldQty,
            returnedQty,
            availableQty,
            unitPriceCents: Number.isFinite(unitPriceCents) ? unitPriceCents : 0,
            product: {
              id: productId,
              name: String(item?.product?.name || item?.productName || 'Producto'),
              sku: item?.product?.sku ? String(item.product.sku) : null,
              reference: item?.product?.reference ? String(item.product.reference) : null,
              saleUnit: item?.product?.saleUnit ? String(item.product.saleUnit) : null,
            },
          };
        })
        .filter((item: SaleDetailItem) => item.qty > 0);

      let returnPolicy: ReturnPolicy = {
        canCreateReturn: true,
        blockedReason: null,
        maxReturnCents: null,
        currentBalanceCents: null,
        arLocalId: null,
      };

      if (saleType === 'CREDITO') {
        const arRows = await db.query<any>(
          `SELECT local_id, server_id, balance_cents, status, data
           FROM accounts_receivable
           ORDER BY rowid DESC`
        );

        const saleInvoiceCode = String(saleRow.invoice_code || parsedSale?.invoiceCode || '').trim();
        const matchBySaleId = (rowParsed: any) => {
          const rowSaleId = String(rowParsed?.saleId || rowParsed?.sale?.id || '').trim();
          if (!rowSaleId) return false;
          return rowSaleId === saleLocalId || (saleServerId ? rowSaleId === saleServerId : false);
        };
        const matchByInvoice = (rowParsed: any) => {
          if (!saleInvoiceCode) return false;
          const rowInvoice = String(rowParsed?.invoiceCode || rowParsed?.sale?.invoiceCode || '').trim();
          return rowInvoice !== '' && rowInvoice === saleInvoiceCode;
        };

        let arMatch: any | null = null;
        for (const arRow of arRows) {
          const parsedAr = parseJsonSafe(arRow.data);
          if (matchBySaleId(parsedAr)) {
            arMatch = { row: arRow, parsed: parsedAr };
            break;
          }
        }
        if (!arMatch) {
          for (const arRow of arRows) {
            const parsedAr = parseJsonSafe(arRow.data);
            if (matchByInvoice(parsedAr)) {
              arMatch = { row: arRow, parsed: parsedAr };
              break;
            }
          }
        }

        if (!arMatch) {
          returnPolicy = {
            canCreateReturn: false,
            blockedReason: 'Factura a credito sin cuenta por cobrar asociada.',
            maxReturnCents: 0,
            currentBalanceCents: null,
            arLocalId: null,
          };
        } else {
          const balanceCents = Number(arMatch.row?.balance_cents || arMatch.parsed?.balanceCents || 0);
          const status = String(arMatch.row?.status || arMatch.parsed?.status || '').toUpperCase();
          const isPaid = balanceCents <= 0 || status === 'PAGADA' || status === 'PAGADO';

          if (isPaid) {
            returnPolicy = {
              canCreateReturn: false,
              blockedReason: 'Esta factura a credito esta pagada totalmente y no permite devoluciones.',
              maxReturnCents: Math.max(0, balanceCents),
              currentBalanceCents: Math.max(0, balanceCents),
              arLocalId: String(arMatch.row?.local_id || ''),
            };
          } else {
            returnPolicy = {
              canCreateReturn: true,
              blockedReason: null,
              maxReturnCents: Math.max(0, balanceCents),
              currentBalanceCents: Math.max(0, balanceCents),
              arLocalId: String(arMatch.row?.local_id || ''),
            };
          }
        }
      }

      const detail: SaleDetail = {
        id: saleLocalId,
        invoiceCode: String(saleRow.invoice_code || parsedSale?.invoiceCode || '-'),
        soldAt,
        type: saleType,
        totalCents: Number(parsedSale?.totalCents || saleRow.total_cents || 0),
        returnPolicy,
        customer: {
          id: String(parsedSale?.customerId || selectedCustomer?.serverId || selectedCustomer?.localId || ''),
          name: String(parsedSale?.customerName || selectedCustomer?.name || 'Cliente general'),
          phone: selectedCustomer?.phone || null,
        },
        items,
      };

      setSelectedSale(detail);
      setReturnItems([]);
      setNotes('');
      setQuery('');
      setSearchResults([]);

      if (!returnPolicy.canCreateReturn) {
        Alert.alert('Devolucion bloqueada', returnPolicy.blockedReason || 'Esta venta no permite devoluciones.');
      }
    } catch (error: any) {
      console.error('Error cargando detalle de venta para devolución:', error?.message || error);
      Alert.alert('Error', 'No se pudo cargar la venta.');
    } finally {
      setLoadingSale(false);
    }
  };

  const addItemToReturn = (item: SaleDetailItem) => {
    if (isReturnBlocked) {
      Alert.alert('Devolucion bloqueada', selectedSale?.returnPolicy.blockedReason || 'Esta venta no permite devoluciones.');
      return;
    }
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
    if (isReturnBlocked) {
      Alert.alert('Devolucion bloqueada', selectedSale.returnPolicy.blockedReason || 'Esta venta no permite devoluciones.');
      return;
    }
    if (returnItems.length === 0) {
      Alert.alert('Error', 'Debes agregar al menos un producto a devolver.');
      return;
    }
    if (exceedsCreditLimit && maxReturnCents !== null) {
      Alert.alert(
        'Monto excedido',
        `La devolucion no puede exceder el balance pendiente (${formatCurrency(maxReturnCents)}).`
      );
      return;
    }

    try {
      setSaving(true);
      const selectedSaleSnapshot = selectedSale;
      const returnItemsSnapshot = [...returnItems];
      const notesSnapshot = notes.trim();
      const returnLocalId = generateLocalId();
      const returnedAt = Date.now();
      const localCodeSuffix = String(returnedAt).slice(-6);
      const returnCode = `DEV-LOCAL-${localCodeSuffix}`;
      const saleRow = await db.queryFirst<{ server_id?: string }>(
        'SELECT server_id FROM sales WHERE local_id = ? OR server_id = ? LIMIT 1',
        [selectedSaleSnapshot.id, selectedSaleSnapshot.id]
      );
      const saleServerId = saleRow?.server_id ? String(saleRow.server_id) : null;
      const queueItems = returnItemsSnapshot.map((item) => ({
        saleItemId: item.saleItemId,
        productId: item.productId,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
      }));
      const totalReturnCents = returnItemsSnapshot.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0);
      const returnData = {
        localId: returnLocalId,
        returnCode,
        saleId: selectedSaleSnapshot.id,
        saleLocalId: selectedSaleSnapshot.id,
        saleServerId,
        arLocalId: selectedSaleSnapshot.returnPolicy.arLocalId || null,
        totalCents: totalReturnCents,
        notes: notesSnapshot || null,
        returnedAt,
        cancelledAt: null,
        sale: {
          id: saleServerId || selectedSaleSnapshot.id,
          invoiceCode: selectedSaleSnapshot.invoiceCode || '-',
          type: selectedSaleSnapshot.type || 'CONTADO',
          customer: {
            id: selectedSaleSnapshot.customer?.id || '',
            name: selectedSaleSnapshot.customer?.name || 'Cliente general',
          },
        },
        items: returnItemsSnapshot.map((item) => ({
          saleItemId: item.saleItemId,
          productId: item.productId,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.unitPriceCents * item.qty,
          product: {
            name: item.productName,
          },
        })),
      };

      await db.insert('returns', {
        local_id: returnLocalId,
        server_id: null,
        return_code: returnCode,
        sale_local_id: selectedSaleSnapshot.id,
        sale_server_id: saleServerId,
        total_cents: totalReturnCents,
        notes: notesSnapshot || null,
        returned_at: returnedAt,
        cancelled_at: null,
        synced: 0,
        data: JSON.stringify(returnData),
      });

      for (const item of returnItemsSnapshot) {
        const lineTotalCents = item.unitPriceCents * item.qty;
        const productRow = await db.queryFirst<{ local_id?: string; server_id?: string }>(
          'SELECT local_id, server_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
          [item.productId, item.productId]
        );
        await db.insert('return_items', {
          local_id: generateLocalId(),
          return_local_id: returnLocalId,
          sale_item_id: item.saleItemId,
          product_local_id: productRow?.local_id ? String(productRow.local_id) : null,
          product_server_id: productRow?.server_id ? String(productRow.server_id) : null,
          product_name: item.productName,
          qty: item.qty,
          unit_price_cents: item.unitPriceCents,
          line_total_cents: lineTotalCents,
          synced: 0,
          data: JSON.stringify({
            saleItemId: item.saleItemId,
            productId: item.productId,
            qty: item.qty,
            unitPriceCents: item.unitPriceCents,
            lineTotalCents,
            product: { name: item.productName },
          }),
        });
      }

      if (
        String(selectedSaleSnapshot.type || '').toUpperCase() === 'CREDITO' &&
        selectedSaleSnapshot.returnPolicy.arLocalId
      ) {
        const arLocalId = String(selectedSaleSnapshot.returnPolicy.arLocalId);
        const arRow = await db.queryFirst<any>(
          'SELECT total_cents, balance_cents, paid_cents, status, data FROM accounts_receivable WHERE local_id = ? LIMIT 1',
          [arLocalId]
        );
        if (arRow) {
          const currentBalance = Number(arRow.balance_cents || 0);
          const totalArCents = Number(arRow.total_cents || 0);
          const newBalanceCents = Math.max(0, currentBalance - totalReturnCents);
          const newPaidCents = Math.max(0, totalArCents - newBalanceCents);
          const newStatus = newBalanceCents <= 0 ? 'PAGADO' : 'PARCIAL';
          const arParsed = parseJsonSafe(arRow.data);

          await db.update('accounts_receivable', arLocalId, {
            balance_cents: newBalanceCents,
            paid_cents: newPaidCents,
            status: newStatus,
            synced: 0,
            data: JSON.stringify({
              ...(arParsed || {}),
              balanceCents: newBalanceCents,
              paidCents: newPaidCents,
              status: newStatus,
            }),
          });
        }
      }

      await syncService.queueOperation(
        'return',
        'create',
        {
          saleId: selectedSaleSnapshot.id,
          saleServerId,
          arLocalId: selectedSaleSnapshot.returnPolicy.arLocalId || null,
          items: queueItems,
          notes: notesSnapshot || null,
        },
        returnLocalId
      );

      const receipt: ReturnReceiptPayload = {
        returnId: returnLocalId,
        returnCode,
        returnedAt,
        invoiceCode: selectedSaleSnapshot.invoiceCode || '-',
        customerName: selectedSaleSnapshot.customer?.name || 'Cliente general',
        totalCents: totalReturnCents,
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
      console.error('Error creando devolución:', error?.message || error);
      Alert.alert('Error', 'No se pudo crear la devolución.');
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
        {selectedSale?.returnPolicy.currentBalanceCents !== null ? (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Balance pendiente:</Text>
            <Text style={styles.summaryValue}>{formatCurrency(selectedSale?.returnPolicy.currentBalanceCents || 0)}</Text>
          </View>
        ) : null}
        {isReturnBlocked ? (
          <Text style={styles.policyErrorText}>
            {selectedSale?.returnPolicy.blockedReason || 'Esta venta no permite devoluciones.'}
          </Text>
        ) : null}
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
              disabled={item.availableQty <= 0 || isReturnBlocked}
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
                  <IconButton
                    icon="minus"
                    size={18}
                    disabled={isReturnBlocked}
                    onPress={() => changeItemQty(item.saleItemId, item.qty - 1)}
                  />
                  <Text style={styles.qtyText}>{item.qty}</Text>
                  <IconButton
                    icon="plus"
                    size={18}
                    disabled={isReturnBlocked}
                    onPress={() => changeItemQty(item.saleItemId, item.qty + 1)}
                  />
                </View>
                <IconButton
                  icon="delete"
                  size={20}
                  disabled={isReturnBlocked}
                  iconColor={ui.colors.danger}
                  onPress={() => removeDraftItem(item.saleItemId)}
                />
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
            disabled={isReturnBlocked}
            style={styles.notesInput}
          />
          {exceedsCreditLimit && maxReturnCents !== null ? (
            <Text style={styles.policyErrorText}>
              El total de la devolucion ({formatCurrency(totalCents)}) excede el balance pendiente permitido ({formatCurrency(maxReturnCents)}).
            </Text>
          ) : null}
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
              disabled={saving || isReturnBlocked || exceedsCreditLimit}
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
  policyErrorText: {
    marginTop: 8,
    color: ui.colors.danger,
    fontWeight: '700',
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
