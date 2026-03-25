import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Alert, TouchableOpacity, Share } from 'react-native';
import { Searchbar, Text, Chip, Icon } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { useSyncAuth } from '../../hooks/useSyncAuth';
import { useSyncStore } from '../../store/syncStore';
import { formatProductQty } from '../../utils/productUnits';
import { getSalesSettings } from '../../services/settings/salesSettings';
import {
  COMPANY_SETTINGS_SNAPSHOT_KEY,
  PAPER_SIZE_KEY,
  hasConnectedPrinter,
  printSaleTicketDirect,
} from '../../services/printing/thermalPrinterService';
import { calcDocumentTotalsByTaxMode } from '../../utils/tax';
import { customerMatchesQuery, formatCustomerLabel, normalizeCustomerVisualId, parseCustomerVisualIdFromData } from '../../utils/customerLabels';

interface InvoiceListItem {
  localId: string;
  invoiceCode: string;
  customerName: string | null;
  customerVisualId?: number | null;
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
type InvoicePaperSize = '58' | '80' | 'carta';

interface CompanySnapshot {
  name: string;
  phone: string;
  address: string;
  logoUrl?: string | null;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const resolveInvoiceItemName = (item: any): string => {
  const value = String(
    item?.productName ||
    item?.name ||
    item?.description ||
    item?.product?.name ||
    item?.product_description ||
    'Producto'
  ).trim();
  return value || 'Producto';
};

const resolveInvoiceItemReference = (item: any): string => {
  const value = String(
    item?.reference ||
    item?.ref ||
    item?.productRef ||
    item?.product?.reference ||
    item?.product_reference ||
    '-'
  ).trim();
  return value || '-';
};

const resolveInvoiceItemCode = (item: any): string => {
  const value = String(
    item?.sku ||
    item?.code ||
    item?.barcode ||
    item?.productCode ||
    item?.product?.sku ||
    item?.product?.code ||
    '-'
  ).trim();
  return value || '-';
};

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
  const [showItbisBreakdown, setShowItbisBreakdown] = useState(true);
  const { runFullSyncIfAuthenticated } = useSyncAuth();
  const { isOnline } = useSyncStore();
  const isOnlineRef = useRef(isOnline);
  const isSyncingOnFocusRef = useRef(false);
  const lastAutoSyncAtRef = useRef(0);
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

          const now = Date.now();
          const canAutoSync = now - lastAutoSyncAtRef.current >= INVOICE_AUTO_SYNC_MIN_INTERVAL_MS;
          if (!canAutoSync) return;

          const synced = await runFullSyncIfAuthenticated({
            isOnline: isOnlineRef.current,
            ignoreCooldown: true,
          });
          if (!synced) return;

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
    }, [runFullSyncIfAuthenticated])
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getSalesSettings()
        .then((settings) => {
          if (active) setShowItbisBreakdown(settings.showItbisOnReceipts);
        })
        .catch(() => {
          if (active) setShowItbisBreakdown(true);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  const loadInvoices = async () => {
    try {
      const customerRows = await db.query<{ local_id: string; server_id?: string | null; visual_id?: number | null; data?: string | null }>(
        'SELECT local_id, server_id, visual_id, data FROM customers'
      );
      const customerVisualIdByAnyId = new Map<string, number>();
      for (const customer of customerRows) {
        const visualId =
          normalizeCustomerVisualId(customer.visual_id) ??
          parseCustomerVisualIdFromData(customer.data) ??
          null;
        if (!visualId) continue;
        const localId = String(customer.local_id || '').trim();
        const serverId = String(customer.server_id || '').trim();
        if (localId) customerVisualIdByAnyId.set(localId, visualId);
        if (serverId) customerVisualIdByAnyId.set(serverId, visualId);
      }

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
          customerVisualId:
            normalizeCustomerVisualId(parsedData?.customerVisualId) ??
            parseCustomerVisualIdFromData(parsedData) ??
            customerVisualIdByAnyId.get(String(row.customer_id || '').trim()) ??
            null,
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
      const synced = await runFullSyncIfAuthenticated({
        isOnline: isOnlineRef.current,
        ignoreCooldown: true,
      });
      if (synced) {
        lastAutoSyncAtRef.current = Date.now();
      }
    } catch (error) {
      console.error('Error sincronizando facturas en refresco:', error);
    }
    await loadInvoices();
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || invoice.invoiceCode.toLowerCase().includes(q) || customerMatchesQuery({
      query: q,
      name: invoice.customerName,
      visualId: invoice.customerVisualId,
    });
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

  const resolveInvoicePaperSize = async (): Promise<InvoicePaperSize> => {
    const raw = (await AsyncStorage.getItem(PAPER_SIZE_KEY)) || '';
    if (raw === '80' || raw === 'carta') return raw;
    return '58';
  };

  const getCompanySnapshot = async (): Promise<CompanySnapshot> => {
    try {
      const raw = await AsyncStorage.getItem(COMPANY_SETTINGS_SNAPSHOT_KEY);
      if (!raw) return { name: 'MOVOpos', phone: '', address: '', logoUrl: null };
      const parsed = JSON.parse(raw);
      return {
        name: String(parsed?.name || 'MOVOpos').trim() || 'MOVOpos',
        phone: String(parsed?.phone || '').trim(),
        address: String(parsed?.address || '').trim(),
        logoUrl: String(parsed?.logoUrl || '').trim() || null,
      };
    } catch {
      return { name: 'MOVOpos', phone: '', address: '', logoUrl: null };
    }
  };

  const buildThermalInvoiceHtml = (params: {
    paperSize: '58' | '80';
    logoDataUri: string | null;
    invoiceCode: string;
    createdAt: number;
    customerName: string;
    paymentMethodLabel: string;
    items: any[];
    salePricesIncludeItbis: boolean;
    totalCents: number;
    cancelled: boolean;
  }) => {
    const { paperSize, logoDataUri, invoiceCode, createdAt, customerName, paymentMethodLabel, items, salePricesIncludeItbis, totalCents, cancelled } = params;
    const widthMm = paperSize === '80' ? 80 : 58;
    const totals = calcDocumentTotalsByTaxMode({
      items: items.map((item: any) => ({
        quantity: Number(item.quantity || item.qty || 0),
        priceCents: Number(item.priceCents || item.unitPriceCents || 0),
        itbisRateBp: Number(item.itbisRateBp || 1800),
      })),
      shippingCents: 0,
      salePricesIncludeItbis,
    });

    const taxRows = showItbisBreakdown
      ? `<div class="row"><span>Subtotal</span><span>${formatCurrency(totals.subtotalCents)}</span></div><div class="row"><span>ITBIS (${salePricesIncludeItbis ? 'incluido' : 'no incluido'})</span><span>${formatCurrency(totals.itbisCents)}</span></div>`
      : '';

    const itemsRows = items.map((item: any) => {
      const lineTotalCents = calcDocumentTotalsByTaxMode({
        items: [{
          quantity: Number(item.quantity || item.qty || 0),
          priceCents: Number(item.priceCents || item.unitPriceCents || 0),
          itbisRateBp: Number(item.itbisRateBp || 1800),
        }],
        shippingCents: 0,
        salePricesIncludeItbis,
      }).totalCents;
      const itemName = resolveInvoiceItemName(item);
      const itemReference = resolveInvoiceItemReference(item);
      return `<div class="item"><div><strong>${escapeHtml(itemName)} | ${escapeHtml(itemReference)}</strong></div><div class="row"><span>${escapeHtml(formatProductQty(Number(item.quantity || item.qty || 0), item.unit))} x ${formatCurrency(Number(item.priceCents || item.unitPriceCents || 0))}</span><span><strong>${formatCurrency(lineTotalCents)}</strong></span></div></div>`;
    }).join('');

    return `<html><head><meta charset="utf-8" /><style>@page { size: ${widthMm}mm auto; margin: 0; } body { font-family: Arial, sans-serif; margin: 0; color: #000; } .ticket { width: ${widthMm}mm; padding: 10px; font-size: ${paperSize === '80' ? 13 : 12}px; } .brand { text-align: center; margin-bottom: 6px; } .logo { height: 28px; width: auto; } .row { display: flex; justify-content: space-between; margin: 3px 0; gap: 8px; } .sep { border-top: 1px dashed #444; margin: 7px 0; } .item { border-bottom: 1px dashed #d1d5db; padding-bottom: 6px; margin-bottom: 6px; } .total { font-size: ${paperSize === '80' ? 17 : 15}px; font-weight: 800; margin-top: 6px; } .cancelled { color: #dc2626; font-weight: 800; text-align: center; margin-top: 7px; }</style></head><body><div class="ticket"><div class="brand">${logoDataUri ? `<img src="${logoDataUri}" class="logo" />` : '<div style="font-weight:800;">MOVOpos</div>'}</div><div class="row"><span>Factura:</span><span><strong>${escapeHtml(invoiceCode)}</strong></span></div><div class="row"><span>Fecha:</span><span>${escapeHtml(formatDateTime(createdAt))}</span></div><div style="margin-top:4px;"><strong>Cliente:</strong> ${escapeHtml(customerName)}</div><div style="margin-top:4px;"><strong>Método:</strong> ${escapeHtml(paymentMethodLabel)}</div><div class="sep"></div><div>${itemsRows}</div>${taxRows}<div class="row total"><span>TOTAL</span><span>${formatCurrency(totalCents)}</span></div>${cancelled ? '<div class="cancelled">FACTURA CANCELADA</div>' : ''}</div></body></html>`;
  };

  const buildLetterInvoiceHtml = (params: {
    logoDataUri: string | null;
    company: CompanySnapshot;
    invoiceCode: string;
    createdAt: number;
    customerName: string;
    paymentMethodLabel: string;
    saleType: 'CONTADO' | 'CREDITO';
    items: any[];
    salePricesIncludeItbis: boolean;
    totalCents: number;
    cancelled: boolean;
  }) => {
    const { logoDataUri, company, invoiceCode, createdAt, customerName, paymentMethodLabel, saleType, items, salePricesIncludeItbis, totalCents, cancelled } = params;
    const totals = calcDocumentTotalsByTaxMode({
      items: items.map((item: any) => ({
        quantity: Number(item.quantity || item.qty || 0),
        priceCents: Number(item.priceCents || item.unitPriceCents || 0),
        itbisRateBp: Number(item.itbisRateBp || 1800),
      })),
      shippingCents: 0,
      salePricesIncludeItbis,
    });
    const uniqueItbisRates = Array.from(new Set(items.map((item: any) => Number(item.itbisRateBp || 1800)).filter((rate: number) => Number.isFinite(rate) && rate > 0)));
    const itbisLabel = uniqueItbisRates.length === 1
      ? `ITBIS (${(uniqueItbisRates[0] / 100).toFixed(2)}% ${salePricesIncludeItbis ? 'incluido' : 'no incluido'})`
      : `ITBIS (${salePricesIncludeItbis ? 'incluido' : 'no incluido'})`;
    const logoSource = String(company.logoUrl || '').trim() || logoDataUri || '';

    const itemRows = items.map((item: any) => {
      const qty = Number(item.quantity || item.qty || 0);
      const unitPriceCents = Number(item.priceCents || item.unitPriceCents || 0);
      const lineTotalCents = calcDocumentTotalsByTaxMode({
        items: [{ quantity: qty, priceCents: unitPriceCents, itbisRateBp: Number(item.itbisRateBp || 1800) }],
        shippingCents: 0,
        salePricesIncludeItbis,
      }).totalCents;
      const itemCode = resolveInvoiceItemCode(item);
      const itemName = resolveInvoiceItemName(item);
      const itemReference = resolveInvoiceItemReference(item);
      return `<tr><td>${escapeHtml(itemCode)}</td><td>${escapeHtml(itemName)}</td><td>${escapeHtml(itemReference)}</td><td style="text-align:right;">${escapeHtml(String(qty))}</td><td style="text-align:right;">${formatCurrency(unitPriceCents)}</td><td style="text-align:right;">${formatCurrency(lineTotalCents)}</td></tr>`;
    }).join('');

    return `<html><head><meta charset="utf-8" /><style>@page { size: letter; margin: 16mm 12mm; } body { font-family: Arial, sans-serif; margin: 0; color: #111827; font-size: 12px; } .invoice { width: 100%; } .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; } .company { display: flex; align-items: flex-start; gap: 12px; } .logo-wrap { max-height: 72px; overflow: hidden; } .logo { height: 72px; width: auto; object-fit: contain; } .company-name { font-size: 22px; font-weight: 800; color: #111827; } .doc-title { font-size: 28px; font-weight: 800; color: #111827; text-align: right; } .box { margin-top: 18px; border: 1px solid #D1D5DB; border-radius: 8px; padding: 12px; } .muted { color: #4B5563; } table { width: 100%; border-collapse: collapse; margin-top: 16px; } th, td { border-bottom: 1px solid #E5E7EB; padding: 8px 6px; font-size: 12px; vertical-align: top; } th { text-align: left; color: #374151; font-weight: 700; } .totals { margin-top: 16px; display: flex; justify-content: flex-end; } .totals-box { width: 320px; border: 1px solid #D1D5DB; border-radius: 8px; padding: 12px; } .totals-row { display: flex; justify-content: space-between; margin-top: 4px; } .totals-total { margin-top: 10px; border-top: 1px solid #111827; padding-top: 8px; font-size: 16px; font-weight: 800; } .cancelled { margin-top: 10px; border: 2px solid #DC2626; background: #FEF2F2; color: #B91C1C; padding: 8px; text-align: center; font-weight: 800; } .thanks { margin-top: 16px; font-weight: 700; color: #374151; } .signature { margin-top: 42px; text-align: center; } .signature-line { width: 280px; border-top: 1px solid #111827; margin: 0 auto 6px; }</style></head><body><div class="invoice">${cancelled ? '<div class="cancelled">FACTURA CANCELADA</div>' : ''}<div class="top"><div class="company">${logoSource ? `<div class="logo-wrap"><img src="${escapeHtml(logoSource)}" class="logo" /></div>` : ''}<div><div class="company-name">${escapeHtml(company.name || 'MOVOpos')}</div>${company.address ? `<div class="muted">${escapeHtml(company.address)}</div>` : ''}${company.phone ? `<div class="muted">Tel: ${escapeHtml(company.phone)}</div>` : ''}</div></div><div><div class="doc-title">FACTURA</div><div style="margin-top:6px;"><div><strong>No:</strong> ${escapeHtml(invoiceCode)}</div><div><strong>Fecha:</strong> ${escapeHtml(formatDateTime(createdAt))}</div></div></div></div><div class="box"><div><strong>Cliente:</strong> ${escapeHtml(customerName)}</div><div style="margin-top:6px;"><strong>Tipo de venta:</strong> ${saleType === 'CREDITO' ? 'Credito' : 'Contado'}</div>${saleType === 'CONTADO' ? `<div style="margin-top:6px;"><strong>Método de pago:</strong> ${escapeHtml(paymentMethodLabel)}</div>` : ''}</div><table><thead><tr><th>Código</th><th>Descripción</th><th>Referencia</th><th style="text-align:right;">Cant.</th><th style="text-align:right;">Precio</th><th style="text-align:right;">Importe</th></tr></thead><tbody>${itemRows}</tbody></table><div class="totals"><div class="totals-box"><div class="totals-row"><span>Subtotal</span><span>${formatCurrency(showItbisBreakdown ? totals.subtotalCents : (totals.subtotalCents + totals.itbisCents))}</span></div>${showItbisBreakdown ? `<div class="totals-row"><span>${escapeHtml(itbisLabel)}</span><span>${formatCurrency(totals.itbisCents)}</span></div>` : ''}<div class="totals-row totals-total"><span>Total</span><span>${formatCurrency(totalCents)}</span></div></div></div><div class="thanks">Gracias por su compra</div>${saleType === 'CREDITO' ? '<div class="signature"><div class="signature-line"></div><div>Firma del cliente</div></div>' : ''}</div></body></html>`;
  };

  const handlePrintInvoice = async (invoice: InvoiceListItem) => {
    try {
      const paperSize = await resolveInvoicePaperSize();
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
      const customerName = formatCustomerLabel(
        parsedData?.customerName || invoice.customerName || 'Cliente general',
        normalizeCustomerVisualId(parsedData?.customerVisualId) ?? invoice.customerVisualId
      );
      const paymentMethodLabel = getInvoicePaymentSummary({
        paymentMethod: parsedData?.paymentMethod || invoice.paymentMethod,
        transferBankName: parsedData?.transferBankName || invoice.transferBankName,
        paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : invoice.paymentSplits,
      });
      const saleType = String(parsedData?.type || '').toUpperCase() === 'CREDITO'
        ? 'CREDITO'
        : String(parsedData?.paymentMethod || invoice.paymentMethod || '').toUpperCase() === 'CREDITO'
          ? 'CREDITO'
          : 'CONTADO';
      const salePricesIncludeItbis = typeof parsedData?.salePricesIncludeItbis === 'boolean'
        ? parsedData.salePricesIncludeItbis
        : true;

      if (paperSize === 'carta') {
        const [logoDataUri, company] = await Promise.all([getLogoDataUri(), getCompanySnapshot()]);
        const html = buildLetterInvoiceHtml({
          logoDataUri,
          company,
          invoiceCode,
          createdAt,
          customerName,
          paymentMethodLabel,
          saleType,
          items,
          salePricesIncludeItbis,
          totalCents,
          cancelled: String(row.status || '').toLowerCase() === 'cancelled',
        });
        await Print.printAsync({ html });
        return;
      }

      const shouldAttemptPrint = await hasConnectedPrinter();
      if (!shouldAttemptPrint) {
        Alert.alert('Impresión', 'No hay una impresora conectada en Ajustes.');
        return;
      }

      let dueDate: number | null = null;
      if (saleType === 'CREDITO') {
        const arRows = await db.query<any>(
          `SELECT due_date, data
           FROM accounts_receivable
           WHERE due_date IS NOT NULL
           ORDER BY rowid DESC`
        );

        const saleServerId = String(row.server_id || '').trim();
        for (const arRow of arRows) {
          let arData: any = null;
          try {
            arData = arRow?.data ? JSON.parse(arRow.data) : null;
          } catch {
            arData = null;
          }

          const arInvoiceCode = String(arData?.sale?.invoiceCode || arData?.invoiceCode || '').trim();
          const arSaleServerId = String(arData?.sale?.id || '').trim();
          const matchesInvoice = arInvoiceCode && arInvoiceCode === invoiceCode;
          const matchesSaleId = saleServerId && arSaleServerId && arSaleServerId === saleServerId;
          if (!matchesInvoice && !matchesSaleId) continue;

          const parsedDueDate = Number(arRow?.due_date);
          dueDate = Number.isFinite(parsedDueDate) ? parsedDueDate : null;
          if (dueDate) break;
        }
      }
      const printResult = await printSaleTicketDirect({
        invoiceCode,
        createdAt,
        customerName,
        paymentMethod: parsedData?.paymentMethod || invoice.paymentMethod,
        transferBankName: parsedData?.transferBankName || invoice.transferBankName,
        paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : invoice.paymentSplits,
        type: saleType,
        dueDate,
        totalCents,
        salePricesIncludeItbis,
        items: items.map((item: any) => ({
          productName: String(item.productName || 'Producto'),
          quantity: Number(item.quantity || item.qty || 0),
          priceCents: Number(item.priceCents || item.unitPriceCents || 0),
          totalCents: calcDocumentTotalsByTaxMode({
            items: [{
              quantity: Number(item.quantity || item.qty || 0),
                  priceCents: Number(item.priceCents || item.unitPriceCents || 0),
                  itbisRateBp: Number(item.itbisRateBp || 1800),
                }],
                shippingCents: 0,
                salePricesIncludeItbis,
              }).totalCents,
          unit: item.unit || 'UNIDAD',
          reference: String(item.reference || '').trim() || null,
          productId: String(item.productId || '').trim() || null,
        })),
      });

      if (printResult.printed) return;

      if (printResult.reason === 'missing_config') {
        Alert.alert('Impresión', 'No hay impresora térmica conectada. Ve a Ajustes > Impresora.');
        return;
      }

      if (printResult.reason === 'missing_native_module') {
        Alert.alert(
          'Impresión',
          'No se encontró soporte de impresora térmica Bluetooth en esta app. Instala el módulo nativo y genera un nuevo build.'
        );
        return;
      }

      Alert.alert('Impresión', printResult.message || `No se pudo reimprimir ${invoiceCode}.`);
    } catch (error) {
      console.error('Error reimprimiendo factura:', error);
      Alert.alert('Error', 'No se pudo reimprimir la factura.');
    }
  };

  const handleShareInvoicePdf = async (invoice: InvoiceListItem) => {
    try {
      const paperSize = await resolveInvoicePaperSize();
      const [logoDataUri, company] = await Promise.all([getLogoDataUri(), getCompanySnapshot()]);

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
      const customerName = formatCustomerLabel(
        parsedData?.customerName || invoice.customerName || 'Cliente general',
        normalizeCustomerVisualId(parsedData?.customerVisualId) ?? invoice.customerVisualId
      );
      const paymentMethodLabel = getInvoicePaymentSummary({
        paymentMethod: parsedData?.paymentMethod || invoice.paymentMethod,
        transferBankName: parsedData?.transferBankName || invoice.transferBankName,
        paymentSplits: Array.isArray(parsedData?.paymentSplits) ? parsedData.paymentSplits : invoice.paymentSplits,
      });
      const saleType = String(parsedData?.type || '').toUpperCase() === 'CREDITO'
        ? 'CREDITO'
        : String(parsedData?.paymentMethod || invoice.paymentMethod || '').toUpperCase() === 'CREDITO'
          ? 'CREDITO'
          : 'CONTADO';
      const salePricesIncludeItbis = typeof parsedData?.salePricesIncludeItbis === 'boolean'
        ? parsedData.salePricesIncludeItbis
        : true;
      const html = paperSize === 'carta'
        ? buildLetterInvoiceHtml({
          logoDataUri,
          company,
          invoiceCode,
          createdAt,
          customerName,
          paymentMethodLabel,
          saleType,
          items,
          salePricesIncludeItbis,
          totalCents,
          cancelled: String(row.status || '').toLowerCase() === 'cancelled',
        })
        : buildThermalInvoiceHtml({
          paperSize: paperSize === '80' ? '80' : '58',
          logoDataUri,
          invoiceCode,
          createdAt,
          customerName,
          paymentMethodLabel,
          items,
          salePricesIncludeItbis,
          totalCents,
          cancelled: String(row.status || '').toLowerCase() === 'cancelled',
        });

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

      <Text style={styles.meta}>Cliente: {formatCustomerLabel(item.customerName || 'Cliente general', item.customerVisualId)}</Text>
      <Text style={styles.meta}>Método de pago: {getInvoicePaymentSummary(item)}</Text>
      <Text style={styles.meta}>Fecha: {formatDateTime(item.createdAt)}</Text>

      <View style={styles.footerRow}>
        {item.synced ? (
          <Text style={styles.syncText}>Sincronizada</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, gap: 4 }}>
            <Icon source="cloud-off-outline" size={13} color="#DC2626" />
            <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '700' }}>Sin sincronizar</Text>
          </View>
        )}
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
