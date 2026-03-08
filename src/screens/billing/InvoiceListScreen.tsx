import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Alert, TouchableOpacity, Share } from 'react-native';
import { Searchbar, Text, Chip, Icon } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { formatPaymentWithBank } from '../../utils/paymentMethods';
import { syncService } from '../../services/sync/SyncService';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';

interface InvoiceListItem {
  localId: string;
  invoiceCode: string;
  customerName: string | null;
  paymentMethod: string | null;
  transferBankName?: string | null;
  paymentSplits?: Array<{ method: string; amountCents: number; transferBankName?: string | null }>;
  status: string;
  totalCents: number;
  createdAt: number;
  synced: boolean;
}
interface InvoiceListScreenProps {
  navigation: any;
}

const INVOICE_AUTO_SYNC_MIN_INTERVAL_MS = 60_000;

const resolveSaleCreatedAt = (rowCreatedAt: unknown, parsedData: any): number => {
  const candidates = [
    rowCreatedAt,
    parsedData?.createdAt,
    parsedData?.soldAt,
    parsedData?.date,
  ];

  for (const candidate of candidates) {
    const asNumber = Number(candidate);
    if (Number.isFinite(asNumber)) return asNumber;
    if (typeof candidate === 'string' && candidate.trim()) {
      const asDate = new Date(candidate).getTime();
      if (Number.isFinite(asDate)) return asDate;
    }
    if (candidate instanceof Date) {
      const ts = candidate.getTime();
      if (Number.isFinite(ts)) return ts;
    }
  }

  return Date.now();
};

const getInvoicePaymentSummary = (invoice: Pick<InvoiceListItem, 'paymentMethod' | 'transferBankName' | 'paymentSplits'>) => {
  if (invoice.paymentMethod === 'DIVIDIR_PAGO' && Array.isArray(invoice.paymentSplits) && invoice.paymentSplits.length > 0) {
    return invoice.paymentSplits
      .map((split) => `${formatPaymentWithBank(split.method, split.transferBankName)} ${formatCurrency(split.amountCents)}`)
      .join(' + ');
  }
  return formatPaymentWithBank(invoice.paymentMethod, invoice.transferBankName);
};

export function InvoiceListScreen({ navigation }: InvoiceListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'cancelled'>('all');
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();
  const { isOnline } = useSyncStore();
  const getTokenRef = useRef(getToken);
  const subUserTokenRef = useRef(subUserToken);
  const isOnlineRef = useRef(isOnline);
  const isSyncingOnFocusRef = useRef(false);
  const lastAutoSyncAtRef = useRef(0);
  getTokenRef.current = getToken;
  subUserTokenRef.current = subUserToken;
  isOnlineRef.current = isOnline;

  useFocusEffect(
    useCallback(() => {
      if (isSyncingOnFocusRef.current) return;
      isSyncingOnFocusRef.current = true;
      let active = true;

      const syncAndLoad = async () => {
        try {
          setLoading(true);
          await loadInvoices();
          if (!active || !isOnlineRef.current) return;

          const clerkToken = await getTokenRef.current();
          if (!clerkToken || !subUserTokenRef.current) return;

          const now = Date.now();
          const canAutoSync = now - lastAutoSyncAtRef.current >= INVOICE_AUTO_SYNC_MIN_INTERVAL_MS;
          if (!canAutoSync) return;

          syncService.setTokenGetter(() => getTokenRef.current());
          syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
          await syncService.fullSync(clerkToken, { ignoreCooldown: true });
          lastAutoSyncAtRef.current = Date.now();

          if (active) {
            await loadInvoices();
          }
        } catch (error) {
          console.error('Error sincronizando facturas:', error);
        } finally {
          if (active) {
            isSyncingOnFocusRef.current = false;
          }
        }
      };

      syncAndLoad();
      return () => {
        active = false;
        isSyncingOnFocusRef.current = false;
      };
    }, [])
  );

  const loadInvoices = async () => {
    try {
      const rows = await db.query<any>('SELECT * FROM sales ORDER BY created_at DESC');
      const mapped: InvoiceListItem[] = rows.map((row) => {
        const parsedData = (() => {
          try {
            return row.data ? JSON.parse(row.data) : null;
          } catch {
            return null;
          }
        })();

        const normalizedStatus = String(row.status || parsedData?.status || 'pending').toLowerCase();
        return {
          localId: String(row.local_id),
          invoiceCode: String(row.invoice_code || parsedData?.invoiceCode || '-'),
          customerName: parsedData?.customerName ? String(parsedData.customerName) : null,
          paymentMethod: parsedData?.paymentMethod ? String(parsedData.paymentMethod) : null,
          transferBankName: parsedData?.transferBankName ? String(parsedData.transferBankName) : null,
          paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : [],
          status: normalizedStatus,
          totalCents: Number(row.total_cents || parsedData?.totalCents || 0),
          createdAt: resolveSaleCreatedAt(row.created_at, parsedData),
          synced: row.synced === 1,
        };
      });
      mapped.sort((a, b) => b.createdAt - a.createdAt);
      setInvoices(mapped);
    } catch (error) {
      console.error('Error cargando facturas:', error);
      setInvoices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (isOnlineRef.current) {
        const clerkToken = await getTokenRef.current();
        if (clerkToken && subUserTokenRef.current) {
          syncService.setTokenGetter(() => getTokenRef.current());
          syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
          await syncService.fullSync(clerkToken, { ignoreCooldown: true });
          lastAutoSyncAtRef.current = Date.now();
        }
      }
    } catch (error) {
      console.error('Error sincronizando facturas en refresco:', error);
    }
    await loadInvoices();
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      invoice.invoiceCode.toLowerCase().includes(q) ||
      (invoice.customerName || '').toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (statusFilter === 'all') return true;
    return invoice.status === statusFilter;
  });

  const totalAmount = filteredInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);

  const getStatusLabel = (status: string) => {
    if (status === 'completed') return 'Completada';
    if (status === 'cancelled') return 'Cancelada';
    return 'Pendiente';
  };

  const getPaymentLabel = (method: string | null) => {
    return formatPaymentWithBank(method, null);
  };

  const queueSaleUpdateBestEffort = async (localId: string, payload: any) => {
    try {
      const row = await db.queryFirst<{ server_id?: string }>('SELECT server_id FROM sales WHERE local_id = ?', [localId]);
      if (!row?.server_id) return;
      await syncService.queueOperation('sale', 'update', { ...payload, id: row.server_id }, localId);
    } catch (error) {
      console.warn('No se pudo encolar actualización de factura:', error);
    }
  };

  const resolveLocalProductId = async (rawProductId: string): Promise<string | null> => {
    if (!rawProductId) return null;
    const row = await db.queryFirst<{ local_id: string }>(
      'SELECT local_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
      [rawProductId, rawProductId]
    );
    return row?.local_id || null;
  };

  const getLogoDataUri = async () => {
    try {
      const logoAsset = Asset.fromModule(require('../../../assets/movoLogoDark.png'));
      if (!logoAsset.localUri) {
        await logoAsset.downloadAsync();
      }
      const logoPath = logoAsset.localUri || logoAsset.uri;
      if (!logoPath) return null;
      const base64 = await LegacyFileSystem.readAsStringAsync(logoPath, { encoding: 'base64' as any });
      if (!base64) return null;
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn('No se pudo cargar logo para impresión:', error);
      return null;
    }
  };

  const handlePrintInvoice = async (invoice: InvoiceListItem) => {
    try {
      const logoDataUri = await getLogoDataUri();

      const row = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [invoice.localId]);
      if (!row) {
        Alert.alert('Factura', 'No se encontró la factura.');
        return;
      }
      let parsedData: any = null;
      try {
        parsedData = row.data ? JSON.parse(row.data) : null;
      } catch {
        parsedData = null;
      }

      const items = Array.isArray(parsedData?.items) ? parsedData.items : [];
      const totalCents = Number(row.total_cents || parsedData?.totalCents || 0);
      const createdAt = resolveSaleCreatedAt(row.created_at, parsedData);
      const invoiceCode = String(row.invoice_code || parsedData?.invoiceCode || invoice.invoiceCode || '-');
      const customerName = parsedData?.customerName || invoice.customerName || '(General) Cliente general';
      const paymentMethodLabel = getInvoicePaymentSummary({
        paymentMethod: parsedData?.paymentMethod || invoice.paymentMethod,
        transferBankName: parsedData?.transferBankName || invoice.transferBankName,
        paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : invoice.paymentSplits,
      });
      const subtotalCents = Math.round(totalCents / 1.18);
      const itbisCents = totalCents - subtotalCents;

      const itemsRows = items
        .map(
          (item: any) => `
            <div class="item">
              <div><strong>${String(item.productName || 'Producto')}</strong></div>
              <div class="row">
                <span>${Number(item.quantity || 0)} x ${formatCurrency(Number(item.priceCents || 0))}</span>
                <span><strong>${formatCurrency(Number(item.totalCents || 0))}</strong></span>
              </div>
            </div>
          `
        )
        .join('');

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: 80mm auto; margin: 0; }
              body { font-family: Arial, sans-serif; margin: 0; }
              .ticket { width: 80mm; padding: 10px; font-size: 13px; color: #000; }
              .brand { text-align: center; margin-bottom: 6px; }
              .logo { height: 28px; width: auto; }
              .row { display: flex; justify-content: space-between; margin: 3px 0; }
              .sep { border-top: 1px dashed #444; margin: 7px 0; }
              .item { border-bottom: 1px dashed #d1d5db; padding-bottom: 6px; margin-bottom: 6px; }
              .total { font-size: 17px; font-weight: 800; margin-top: 6px; }
              .cancelled { color: #dc2626; font-weight: 800; text-align: center; margin-top: 7px; }
            </style>
          </head>
          <body>
            <div class="ticket">
              <div class="brand">
                ${
                  logoDataUri
                    ? `<img src="${logoDataUri}" class="logo" />`
                    : '<div style="font-weight:800;">MOVOpos</div>'
                }
              </div>
              <div class="row"><span>Factura:</span><span><strong>${invoiceCode}</strong></span></div>
              <div class="row"><span>Fecha:</span><span>${formatDateTime(createdAt)}</span></div>
              <div style="margin-top:4px;"><strong>Cliente:</strong> ${customerName}</div>
              <div style="margin-top:4px;"><strong>Método:</strong> ${paymentMethodLabel}</div>
              <div class="sep"></div>
              <div>${itemsRows}</div>
              <div class="row"><span>Subtotal</span><span>${formatCurrency(subtotalCents)}</span></div>
              <div class="row"><span>ITBIS (18%)</span><span>${formatCurrency(itbisCents)}</span></div>
              <div class="row total"><span>TOTAL</span><span>${formatCurrency(totalCents)}</span></div>
              ${String(row.status || '').toLowerCase() === 'cancelled' ? '<div class="cancelled">FACTURA CANCELADA</div>' : ''}
            </div>
          </body>
        </html>
      `;

      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error reimprimiendo factura:', error);
      Alert.alert('Error', 'No se pudo abrir la impresión de la factura.');
    }
  };

  const handleShareInvoicePdf = async (invoice: InvoiceListItem) => {
    try {
      const logoDataUri = await getLogoDataUri();

      const row = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [invoice.localId]);
      if (!row) {
        Alert.alert('Factura', 'No se encontró la factura.');
        return;
      }
      let parsedData: any = null;
      try {
        parsedData = row.data ? JSON.parse(row.data) : null;
      } catch {
        parsedData = null;
      }

      const items = Array.isArray(parsedData?.items) ? parsedData.items : [];
      const totalCents = Number(row.total_cents || parsedData?.totalCents || 0);
      const createdAt = resolveSaleCreatedAt(row.created_at, parsedData);
      const invoiceCode = String(row.invoice_code || parsedData?.invoiceCode || invoice.invoiceCode || '-');
      const customerName = parsedData?.customerName || invoice.customerName || '(General) Cliente general';
      const paymentMethodLabel = getInvoicePaymentSummary({
        paymentMethod: parsedData?.paymentMethod || invoice.paymentMethod,
        transferBankName: parsedData?.transferBankName || invoice.transferBankName,
        paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : invoice.paymentSplits,
      });
      const subtotalCents = Math.round(totalCents / 1.18);
      const itbisCents = totalCents - subtotalCents;

      const itemsRows = items
        .map(
          (item: any) => `
            <div class="item">
              <div><strong>${String(item.productName || 'Producto')}</strong></div>
              <div class="row">
                <span>${Number(item.quantity || 0)} x ${formatCurrency(Number(item.priceCents || 0))}</span>
                <span><strong>${formatCurrency(Number(item.totalCents || 0))}</strong></span>
              </div>
            </div>
          `
        )
        .join('');

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: 80mm auto; margin: 0; }
              body { font-family: Arial, sans-serif; margin: 0; }
              .ticket { width: 80mm; padding: 10px; font-size: 13px; color: #000; }
              .brand { text-align: center; margin-bottom: 6px; }
              .logo { height: 28px; width: auto; }
              .row { display: flex; justify-content: space-between; margin: 3px 0; }
              .sep { border-top: 1px dashed #444; margin: 7px 0; }
              .item { border-bottom: 1px dashed #d1d5db; padding-bottom: 6px; margin-bottom: 6px; }
              .total { font-size: 17px; font-weight: 800; margin-top: 6px; }
              .cancelled { color: #dc2626; font-weight: 800; text-align: center; margin-top: 7px; }
            </style>
          </head>
          <body>
            <div class="ticket">
              <div class="brand">
                ${
                  logoDataUri
                    ? `<img src="${logoDataUri}" class="logo" />`
                    : '<div style="font-weight:800;">MOVOpos</div>'
                }
              </div>
              <div class="row"><span>Factura:</span><span><strong>${invoiceCode}</strong></span></div>
              <div class="row"><span>Fecha:</span><span>${formatDateTime(createdAt)}</span></div>
              <div style="margin-top:4px;"><strong>Cliente:</strong> ${customerName}</div>
              <div style="margin-top:4px;"><strong>Método:</strong> ${paymentMethodLabel}</div>
              <div class="sep"></div>
              <div>${itemsRows}</div>
              <div class="row"><span>Subtotal</span><span>${formatCurrency(subtotalCents)}</span></div>
              <div class="row"><span>ITBIS (18%)</span><span>${formatCurrency(itbisCents)}</span></div>
              <div class="row total"><span>TOTAL</span><span>${formatCurrency(totalCents)}</span></div>
              ${String(row.status || '').toLowerCase() === 'cancelled' ? '<div class="cancelled">FACTURA CANCELADA</div>' : ''}
            </div>
          </body>
        </html>
      `;

      const pdf = await Print.printToFileAsync({ html });
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (sharingAvailable) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Factura ${invoiceCode}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Share.share({
          title: `Factura ${invoiceCode}`,
          message: `Factura ${invoiceCode}`,
          url: pdf.uri,
        });
      }
    } catch (error) {
      console.error('Error compartiendo factura PDF:', error);
      Alert.alert('Error', 'No se pudo compartir la factura en PDF.');
    }
  };

  const handleOpenEdit = async (invoice: InvoiceListItem) => {
    try {
      const row = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [invoice.localId]);
      if (!row) {
        Alert.alert('Factura', 'No se encontró la factura.');
        return;
      }

      const status = String(row.status || '').toLowerCase();
      if (status === 'cancelled') {
        Alert.alert('Factura', 'No puedes editar una factura cancelada.');
        return;
      }

      (navigation as any).navigate('Home', {
        screen: 'POS',
        params: {
          screen: 'POSMain',
          params: { editSaleLocalId: invoice.localId, editNonce: Date.now() },
        },
      });
    } catch (error) {
      console.error('Error abriendo edición en POS:', error);
      Alert.alert('Error', 'No se pudo abrir la factura en edición.');
    }
  };

  const handleCancelInvoice = (invoice: InvoiceListItem) => {
    if (invoice.status === 'cancelled') {
      Alert.alert('Factura', 'Esta factura ya está cancelada.');
      return;
    }
    Alert.alert('Cancelar factura', `¿Seguro que deseas cancelar ${invoice.invoiceCode}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, cancelar',
        style: 'destructive',
        onPress: async () => {
          try {
            const row = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [invoice.localId]);
            if (!row) {
              Alert.alert('Factura', 'No se encontró la factura.');
              return;
            }

            let parsedData: any = null;
            try {
              parsedData = row.data ? JSON.parse(row.data) : null;
            } catch {
              parsedData = null;
            }

            const updatedData = {
              ...(parsedData || {}),
              status: 'cancelled',
              cancel: true,
              cancelledAt: Date.now(),
            };

            const saleInvoiceCode = String(row.invoice_code || parsedData?.invoiceCode || invoice.invoiceCode || '');
            const saleServerId = row.server_id ? String(row.server_id) : null;

            const saleItems = Array.isArray(parsedData?.items) ? parsedData.items : [];
            for (const item of saleItems) {
              const quantity = Number(item?.quantity ?? item?.qty ?? 0);
              if (!Number.isFinite(quantity) || quantity <= 0) continue;
              const localProductId = await resolveLocalProductId(String(item?.productId || ''));
              if (!localProductId) continue;
              await db.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [quantity, localProductId]);
            }

            await db.update('sales', invoice.localId, {
              status: 'cancelled',
              data: JSON.stringify(updatedData),
              synced: 0,
            });

            const arRows = await db.query<any>(
              `SELECT local_id, total_cents, data
               FROM accounts_receivable
               WHERE status IN ('PENDIENTE', 'PARCIAL')`
            );

            for (const arRow of arRows) {
              let arData: any = null;
              try {
                arData = arRow.data ? JSON.parse(arRow.data) : null;
              } catch {
                arData = null;
              }

              const arInvoiceCode = String(arData?.sale?.invoiceCode || arData?.invoiceCode || '');
              const arSaleServerId = arData?.sale?.id ? String(arData.sale.id) : null;
              const matchesInvoice = saleInvoiceCode && arInvoiceCode && arInvoiceCode === saleInvoiceCode;
              const matchesSaleId = !!(saleServerId && arSaleServerId && arSaleServerId === saleServerId);

              if (!matchesInvoice && !matchesSaleId) continue;

              const totalCents = Number(arRow.total_cents || arData?.totalCents || 0);
              const updatedArData = {
                ...(arData || {}),
                status: 'PAGADO',
                balanceCents: 0,
                paidCents: totalCents,
                cancelledBySale: true,
                cancelledAt: Date.now(),
              };

              await db.update('accounts_receivable', String(arRow.local_id), {
                status: 'PAGADO',
                balance_cents: 0,
                paid_cents: totalCents,
                synced: 0,
                data: JSON.stringify(updatedArData),
              });
            }

            await queueSaleUpdateBestEffort(invoice.localId, updatedData);

            await loadInvoices();
            Alert.alert('Factura', 'Factura cancelada.');
          } catch (error) {
            console.error('Error cancelando factura:', error);
            Alert.alert('Error', 'No se pudo cancelar la factura.');
          }
        },
      },
    ]);
  };

  const getStatusChipStyle = (status: string) => {
    if (status === 'completed') return styles.completedChip;
    if (status === 'cancelled') return styles.cancelledChip;
    return styles.pendingChip;
  };

  const renderInvoice = ({ item }: { item: InvoiceListItem }) => (
    <View style={styles.invoiceCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.invoiceCode}>{item.invoiceCode}</Text>
        <Chip compact style={getStatusChipStyle(item.status)} textStyle={styles.statusChipText}>
          {getStatusLabel(item.status)}
        </Chip>
      </View>

      <Text style={styles.meta}>Cliente: {item.customerName || 'Cliente general'}</Text>
      <Text style={styles.meta}>Método de pago: {getInvoicePaymentSummary(item)}</Text>
      <Text style={styles.meta}>Fecha: {formatDateTime(item.createdAt)}</Text>

      <View style={styles.footerRow}>
        <Text style={styles.syncText}>{item.synced ? 'Sincronizada' : 'Pendiente de sync'}</Text>
        <Text style={styles.totalValue}>{formatCurrency(item.totalCents)}</Text>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionIconButton, styles.printButton]} onPress={() => handlePrintInvoice(item)}>
          <Icon source="printer" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionIconButton, styles.shareButton]} onPress={() => handleShareInvoicePdf(item)}>
          <Icon source="share-variant" size={18} color="#fff" />
        </TouchableOpacity>

        {item.status !== 'cancelled' ? (
          <>
            <TouchableOpacity style={[styles.actionIconButton, styles.editButton]} onPress={() => handleOpenEdit(item)}>
              <Icon source="pencil" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionIconButton, styles.cancelButton]} onPress={() => handleCancelInvoice(item)}>
              <Icon source="trash-can-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.cancelledNote}>Cancelada</Text>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Facturación</Text>
        <Text style={styles.summaryLabel}>Total en vista</Text>
        <Text style={styles.summaryValue}>{formatCurrency(totalAmount)}</Text>
        <Text style={styles.summarySub}>{filteredInvoices.length} facturas</Text>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar por factura o cliente..."
            placeholderTextColor="#B8B2C8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>

        <View style={styles.filterContainer}>
          <Chip
            selected={statusFilter === 'all'}
            onPress={() => setStatusFilter('all')}
            style={[styles.filterChip, statusFilter === 'all' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'all' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Todas
          </Chip>
          <Chip
            selected={statusFilter === 'completed'}
            onPress={() => setStatusFilter('completed')}
            style={[styles.filterChip, statusFilter === 'completed' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'completed' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Completadas
          </Chip>
          <Chip
            selected={statusFilter === 'pending'}
            onPress={() => setStatusFilter('pending')}
            style={[styles.filterChip, statusFilter === 'pending' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'pending' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Pendientes
          </Chip>
          <Chip
            selected={statusFilter === 'cancelled'}
            onPress={() => setStatusFilter('cancelled')}
            style={[styles.filterChip, statusFilter === 'cancelled' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'cancelled' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Canceladas
          </Chip>
        </View>
      </View>

      <FlatList
        data={filteredInvoices}
        renderItem={renderInvoice}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando facturas...' : 'No hay facturas'}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  header: {
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomLeftRadius: ui.radius.xl,
    borderBottomRightRadius: ui.radius.xl,
  },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  summaryLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  summaryValue: { color: '#fff', fontSize: 33, fontWeight: '800', marginTop: 3, marginBottom: 1 },
  summarySub: { color: 'rgba(255,255,255,0.82)', marginTop: 2, fontSize: 12 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: ui.radius.md,
    paddingLeft: 2,
    marginTop: 8,
    marginBottom: 10,
  },
  searchbar: { flex: 1, borderRadius: ui.radius.md, backgroundColor: 'transparent', elevation: 0 },
  searchInput: { minHeight: 40 },
  filterContainer: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterChip: { height: 32, borderRadius: ui.radius.md, backgroundColor: 'rgba(255,255,255,0.2)' },
  filterChipSelected: { backgroundColor: '#fff' },
  filterChipText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },
  filterChipTextSelected: { color: ui.colors.primary, fontWeight: '700' },
  listContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  invoiceCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  invoiceCode: { color: ui.colors.text, fontWeight: '800', fontSize: 15, flex: 1, marginRight: 8 },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  completedChip: { backgroundColor: '#DCFCE7' },
  pendingChip: { backgroundColor: '#FEF3C7' },
  cancelledChip: { backgroundColor: '#FEE2E2' },
  meta: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 2 },
  footerRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncText: { color: ui.colors.textMuted, fontSize: 11, fontWeight: '700' },
  totalValue: { color: ui.colors.text, fontWeight: '800', fontSize: 16 },
  actionsRow: { marginTop: 10, flexDirection: 'row', gap: 20, alignItems: 'center' },
  actionIconButton: {
    width: 46,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printButton: { backgroundColor: '#22C55E' },
  shareButton: { backgroundColor: '#0EA5E9' },
  editButton: { backgroundColor: '#3B82F6' },
  cancelButton: { backgroundColor: '#EF4444' },
  cancelledNote: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  fieldInput: { backgroundColor: '#fff' },
  readOnlyField: { opacity: 0.9 },
  editScroll: { maxHeight: 520 },
  editScrollContent: { paddingBottom: 8 },
  editSection: { marginBottom: 14 },
  sectionHeader: { color: ui.colors.text, fontSize: 14, fontWeight: '800', marginBottom: 8 },
  rowField: { flexDirection: 'row', gap: 8 },
  halfField: { flex: 1 },
  paymentLabel: { marginTop: 12, marginBottom: 8, color: ui.colors.textMuted, fontSize: 12, fontWeight: '700' },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paymentChip: { backgroundColor: '#F3F4F6' },
  paymentChipSelected: { backgroundColor: '#E9D5FF' },
  paymentChipDisabled: { opacity: 0.55 },
  paymentChipText: { color: '#4B5563', fontSize: 12 },
  paymentChipTextSelected: { color: ui.colors.primary, fontWeight: '700' },
  itemEditorCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  itemEditorName: { color: ui.colors.text, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  itemLineTotal: { marginTop: 6, color: ui.colors.textMuted, fontSize: 12, fontWeight: '700' },
  summaryCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: '#F9FAFB',
    padding: 12,
  },
  summaryTitle: { color: ui.colors.text, fontWeight: '800', marginBottom: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  summaryText: { color: ui.colors.textMuted, fontSize: 12 },
  summaryValueText: { color: ui.colors.text, fontWeight: '700', fontSize: 12 },
  summaryTotalText: { color: ui.colors.text, fontWeight: '800', fontSize: 13 },
  summaryTotalValue: { color: ui.colors.primary, fontWeight: '800', fontSize: 15 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
});

