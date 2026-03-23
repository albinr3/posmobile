import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Surface, Button, IconButton, Divider, Menu, Portal, Modal, TextInput, Icon } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency, generateInvoiceCode, generateLocalId } from '../../utils/helpers';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { ui } from '../../theme/ui';
import { getBottomSafeInset } from '../../utils/safeArea';
import { DOMINICAN_BANKS } from '../../constants/dominicanBanks';
import { SalePaymentSplit } from '../../types';
import { formatPaymentWithBank, getPaymentMethodLabel } from '../../utils/paymentMethods';
import { formatProductQty, unitAllowsDecimals } from '../../utils/productUnits';
import { buildLineId } from '../../store/createCartStore';
import { autoPrintSaleTicket } from '../../services/printing/thermalPrinterService';
import { playSaleSuccessSound } from '../../services/feedback/saleFeedbackService';
import { getSalesSettings } from '../../services/settings/salesSettings';
import { calcDocumentTotalsByTaxMode } from '../../utils/tax';
import { formatCustomerLabel, normalizeCustomerVisualId, parseCustomerVisualIdFromData } from '../../utils/customerLabels';

interface CartScreenProps {
  navigation: any;
  route?: {
    params?: {
      customerId?: string | null;
      customerName?: string | null;
      customerVisualId?: number | null;
      editSaleLocalId?: string | null;
    };
  };
}

export function CartScreen({ navigation, route }: CartScreenProps) {
  const insets = useSafeAreaInsets();
  const systemBottomInset = getBottomSafeInset(insets.bottom);
  const {
    items,
    updateQuantity,
    updatePrice,
    removeItem,
    customerId,
    customerName,
    customerVisualId,
    paymentMethod,
    setPaymentMethod,
    transferBankName,
    setTransferBankName,
    paymentSplits,
    setPaymentSplits,
    clear,
    editingSaleLocalId,
    editingInvoiceCode,
    clearEditContext,
  } = useCartStore();
  const [loading, setLoading] = useState(false);
  const completingSaleRef = useRef(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [transferBankMenuVisible, setTransferBankMenuVisible] = useState(false);
  const [splitPaymentModalVisible, setSplitPaymentModalVisible] = useState(false);
  const [splitMethodMenuIndex, setSplitMethodMenuIndex] = useState<number | null>(null);
  const [splitBankMenuIndex, setSplitBankMenuIndex] = useState<number | null>(null);
  const [salePricesIncludeItbis, setSalePricesIncludeItbis] = useState(true);
  const { setCustomer } = useCartStore();
  const { subUser } = useAuthStore();
  const canOverridePrice = !!subUser?.isOwner || (subUser as any)?.canOverridePrice === true || subUser?.role === 'ADMIN';

  const [priceDialogLineId, setPriceDialogLineId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const priceDialogItem = useMemo(
    () => items.find(i => i.lineId === priceDialogLineId),
    [items, priceDialogLineId]
  );

  // Recipe modifier state
  const [recipeDialogLineId, setRecipeDialogLineId] = useState<string | null>(null);
  const [recipeDialogMode, setRecipeDialogMode] = useState<'SIN' | 'EXTRA' | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<Record<string, 'SIN' | 'EXTRA'>>({});
  const [recipeApplyScope, setRecipeApplyScope] = useState<'ONE' | 'ALL'>('ALL');

  const openRecipeDialog = (item: typeof items[0]) => {
    setRecipeDialogLineId(item.lineId);
    setRecipeDialogMode(null);
    setRecipeApplyScope(item.quantity > 1 ? 'ONE' : 'ALL');
    const existing = item.recipeAdjustments ?? [];
    const draft: Record<string, 'SIN' | 'EXTRA'> = {};
    existing.forEach((adj: any) => { draft[adj.ingredientId] = adj.adjustmentType; });
    setRecipeDraft(draft);
  };

  const closeRecipeDialog = () => {
    setRecipeDialogLineId(null);
    setRecipeDialogMode(null);
    setRecipeDraft({});
    setRecipeApplyScope('ALL');
  };

  const applyRecipeAdjustments = () => {
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
          const newLine = { ...cartItem, lineId: newLineId, quantity: 1, totalCents: cartItem.priceCents, recipeAdjustments: adjustments };
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
    closeRecipeDialog();
  };

  const openPriceDialog = (item: typeof items[0]) => {
    if (!canOverridePrice) return;
    setPriceDialogLineId(item.lineId);
    setPriceDraft((item.priceCents / 100).toFixed(2));
    setPriceError(null);
  };

  const closePriceDialog = () => {
    setPriceDialogLineId(null);
    setPriceDraft('');
    setPriceError(null);
  };

  const applyPriceChange = () => {
    const cartItem = items.find(i => i.lineId === priceDialogLineId);
    if (!cartItem) {
      closePriceDialog();
      return;
    }
    const normalized = priceDraft.replace(',', '.').trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPriceError('Ingresa un precio válido.');
      return;
    }
    const nextPriceCents = Math.round(parsed * 100);
    updatePrice(cartItem.lineId, nextPriceCents);
    closePriceDialog();
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getSalesSettings()
        .then((settings) => {
          if (active) setSalePricesIncludeItbis(settings.salePricesIncludeItbis !== false);
        })
        .catch(() => {
          if (active) setSalePricesIncludeItbis(true);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!editingSaleLocalId) return;
      let active = true;
      const loadDocumentMode = async () => {
        try {
          const sale = await db.queryFirst<{ data?: string }>('SELECT data FROM sales WHERE local_id = ?', [editingSaleLocalId]);
          const parsed = sale?.data ? JSON.parse(sale.data) : null;
          if (!active) return;
          if (typeof parsed?.salePricesIncludeItbis === 'boolean') {
            setSalePricesIncludeItbis(parsed.salePricesIncludeItbis);
          }
        } catch {
          // no-op
        }
      };
      void loadDocumentMode();
      return () => {
        active = false;
      };
    }, [editingSaleLocalId])
  );

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

  useFocusEffect(
    useCallback(() => {
      const routeCustomerId = route?.params?.customerId;
      const routeCustomerName = route?.params?.customerName;
      const routeCustomerVisualId = route?.params?.customerVisualId;

      if (
        typeof routeCustomerId !== 'undefined' ||
        typeof routeCustomerName !== 'undefined' ||
        typeof routeCustomerVisualId !== 'undefined'
      ) {
        setCustomer(routeCustomerId ?? null, routeCustomerName ?? null, routeCustomerVisualId ?? null);
      }
    }, [route?.params?.customerId, route?.params?.customerName, route?.params?.customerVisualId, setCustomer])
  );

  const resolveLocalProductId = async (rawProductId: string): Promise<string | null> => {
    if (!rawProductId) return null;
    const row = await db.queryFirst<{ local_id: string }>(
      'SELECT local_id FROM products WHERE local_id = ? OR server_id = ? LIMIT 1',
      [rawProductId, rawProductId]
    );
    return row?.local_id || null;
  };

  const queueSaleUpdateForEdit = async (saleLocalId: string, salePayload: any) => {
    const serverRow = await db.queryFirst<{ server_id?: string }>(
      'SELECT server_id FROM sales WHERE local_id = ?',
      [saleLocalId]
    );

    if (serverRow?.server_id) {
      await syncService.queueOperation('sale', 'update', { ...salePayload, id: serverRow.server_id }, saleLocalId);
      return;
    }

    // Si no tiene server_id aún, actualizar el pending create existente para evitar PUT inválido.
    const pendingCreate = await db.queryFirst<{ id: number }>(
      `SELECT id
       FROM sync_queue
       WHERE entity_type = ? AND entity_local_id = ? AND action = ? AND status = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      ['sale', saleLocalId, 'create', 'pending']
    );

    if (pendingCreate?.id) {
      await db.update('sync_queue', String(pendingCreate.id), { data: JSON.stringify(salePayload) }, 'id');
    }
  };

  const buildLocalArIdForSale = (saleLocalId: string) => `ar_${saleLocalId}`;

  const upsertLocalArForCreditSale = async (params: {
    saleLocalId: string;
    invoiceCode: string;
    createdAt: number;
    customerId: string | null;
    customerName: string | null;
    customerVisualId: number | null;
    totalCents: number;
    dueDate: number | null;
  }) => {
    if (!params.customerId) return;
    const arLocalId = buildLocalArIdForSale(params.saleLocalId);
    const arPayload = {
      localId: arLocalId,
      saleLocalId: params.saleLocalId,
      saleServerId: null,
      customerId: params.customerId,
      customerName: params.customerName || 'Cliente',
      customerVisualId: params.customerVisualId ?? null,
      invoiceCode: params.invoiceCode,
      totalCents: params.totalCents,
      paidCents: 0,
      balanceCents: params.totalCents,
      status: 'PENDIENTE',
      dueDate: params.dueDate,
      createdAt: params.createdAt,
    };

    const arRow = {
      customer_id: params.customerId,
      customer_visual_id: params.customerVisualId ?? null,
      customer_name: params.customerName || 'Cliente',
      total_cents: params.totalCents,
      paid_cents: 0,
      balance_cents: params.totalCents,
      status: 'PENDIENTE',
      due_date: params.dueDate,
      synced: 0,
      data: JSON.stringify(arPayload),
    };

    const exists = await db.queryFirst<{ local_id?: string }>(
      'SELECT local_id FROM accounts_receivable WHERE local_id = ? LIMIT 1',
      [arLocalId]
    );
    if (exists?.local_id) {
      await db.update('accounts_receivable', arLocalId, arRow, 'local_id');
      return;
    }

    await db.insert('accounts_receivable', {
      local_id: arLocalId,
      ...arRow,
    });
  };

  const removeLocalArDraftForSale = async (saleLocalId: string) => {
    const arLocalId = buildLocalArIdForSale(saleLocalId);
    await db.runAsync(
      'DELETE FROM accounts_receivable WHERE local_id = ? AND server_id IS NULL',
      [arLocalId]
    );
  };

  const paymentMethods = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Tarjeta', value: 'TARJETA' },
    { label: 'Transferencia', value: 'TRANSFERENCIA' },
    { label: 'Dividir pago', value: 'DIVIDIR_PAGO' },
    { label: 'Crédito', value: 'CREDITO' },
  ];
  const splitMethodOptions = useMemo(
    () => [
      { label: 'Efectivo', value: 'EFECTIVO' },
      { label: 'Tarjeta', value: 'TARJETA' },
      { label: 'Transferencia', value: 'TRANSFERENCIA' },
      { label: 'Otro', value: 'OTRO' },
    ],
    []
  );

  const handlePaymentMethodSelect = (nextMethod: string) => {
    setPaymentMethod(nextMethod);
    if (nextMethod !== 'TRANSFERENCIA') {
      setTransferBankName(null);
    }
    if (nextMethod !== 'DIVIDIR_PAGO') {
      setPaymentSplits([]);
    }
    setMenuVisible(false);
  };

  const addPaymentSplit = () => {
    setPaymentSplits([...paymentSplits, { method: 'EFECTIVO', amountCents: 0, transferBankName: null }]);
  };

  const updatePaymentSplit = (index: number, patch: Partial<SalePaymentSplit>) => {
    setPaymentSplits(
      paymentSplits.map((split, splitIndex) => {
        if (splitIndex !== index) return split;
        const nextSplit = { ...split, ...patch };
        if (nextSplit.method !== 'TRANSFERENCIA') {
          nextSplit.transferBankName = null;
        }
        return nextSplit;
      })
    );
  };

  const removePaymentSplit = (index: number) => {
    setPaymentSplits(paymentSplits.filter((_, splitIndex) => splitIndex !== index));
  };

  const totalSplitCents = useMemo(
    () => paymentSplits.reduce((sum, split) => sum + Number(split.amountCents || 0), 0),
    [paymentSplits]
  );

  const splitDifferenceCents = cartTotals.totalCents - totalSplitCents;

  const handleCompleteSale = async () => {
    if (completingSaleRef.current) return;
    completingSaleRef.current = true;
    setLoading(true);
    try {
      if (items.length === 0) return;
    let creditDueDate: number | null = null;
    let selectedCustomerId = customerId;
    let selectedCustomerName = customerName;
    let selectedCustomerVisualId = customerVisualId;

    if (!selectedCustomerId) {
      const defaultCustomer = await db.queryFirst<{ local_id: string; name: string; visual_id?: number | null; data?: string | null }>(
        `SELECT local_id, name, visual_id, data
         FROM customers
         WHERE LOWER(TRIM(name)) = 'cliente general'
         ORDER BY CASE WHEN server_id IS NOT NULL THEN 0 ELSE 1 END, rowid ASC
         LIMIT 1`
      );
      if (!defaultCustomer?.local_id) {
        Alert.alert(
          'Cliente requerido',
          'No se encontró el cliente "Cliente general". Sin ese cliente no se puede registrar la venta.'
        );
        return;
      }
      selectedCustomerId = String(defaultCustomer.local_id);
      selectedCustomerName = String(defaultCustomer.name || 'Cliente general');
      selectedCustomerVisualId =
        normalizeCustomerVisualId(defaultCustomer.visual_id) ??
        parseCustomerVisualIdFromData(defaultCustomer.data) ??
        null;
      setCustomer(selectedCustomerId, selectedCustomerName, selectedCustomerVisualId);
    }

    if (selectedCustomerId && !selectedCustomerVisualId) {
      const customerRow = await db.queryFirst<{ visual_id?: number | null; data?: string | null }>(
        'SELECT visual_id, data FROM customers WHERE local_id = ? OR server_id = ? LIMIT 1',
        [selectedCustomerId, selectedCustomerId]
      );
      selectedCustomerVisualId =
        normalizeCustomerVisualId(customerRow?.visual_id) ??
        parseCustomerVisualIdFromData(customerRow?.data) ??
        null;
      if (selectedCustomerVisualId) {
        setCustomer(selectedCustomerId, selectedCustomerName ?? null, selectedCustomerVisualId);
      }
    }

    if (paymentMethod === 'CREDITO') {
      const customerRow = await db.queryFirst<{ data?: string; name?: string }>(
        'SELECT data, name FROM customers WHERE local_id = ?',
        [selectedCustomerId]
      );

      let creditEnabled = false;
      let creditDays = 0;
      try {
        const customerData = customerRow?.data ? JSON.parse(customerRow.data) : null;
        const rawCreditEnabled = customerData?.creditEnabled ?? customerData?.credit_enabled ?? false;
        const rawCreditDays = Number(customerData?.creditDays ?? customerData?.credit_days ?? 0);
        creditDays = Number.isFinite(rawCreditDays) ? Math.max(0, Math.round(rawCreditDays)) : 0;
        creditEnabled = rawCreditEnabled === true || rawCreditEnabled === 1 || rawCreditEnabled === '1';
      } catch {
        creditEnabled = false;
        creditDays = 0;
      }

      if (!creditEnabled) {
        Alert.alert(
          'Crédito no habilitado',
          `El cliente ${customerRow?.name || selectedCustomerName || ''} no tiene crédito habilitado.`
        );
        return;
      }

      if (creditDays > 0) {
        creditDueDate = Date.now() + creditDays * 24 * 60 * 60 * 1000;
      }
    }

    if (paymentMethod === 'TRANSFERENCIA' && !transferBankName) {
      Alert.alert('Banco requerido', 'Debes seleccionar el banco de la transferencia.');
      return;
    }

    if (paymentMethod === 'DIVIDIR_PAGO') {
      if (paymentSplits.length === 0) {
        Alert.alert('Pago dividido', 'Debes agregar al menos un método en el pago dividido.');
        return;
      }
      if (totalSplitCents !== cartTotals.totalCents) {
        Alert.alert('Pago dividido', 'La suma de los pagos debe ser igual al total de la venta.');
        return;
      }
      const invalidTransferSplit = paymentSplits.find(
        (split) => split.method === 'TRANSFERENCIA' && !split.transferBankName
      );
      if (invalidTransferSplit) {
        Alert.alert('Pago dividido', 'Cada transferencia debe tener un banco seleccionado.');
        return;
      }
      const invalidAmountSplit = paymentSplits.find((split) => !Number.isFinite(split.amountCents) || split.amountCents <= 0);
      if (invalidAmountSplit) {
        Alert.alert('Pago dividido', 'Cada línea del pago dividido debe tener un monto válido.');
        return;
      }
    }

      let localId = generateLocalId();
      let invoiceCode = generateInvoiceCode();
      const now = Date.now();
      let createdAt = now;
      let resolvedInvoiceCode = invoiceCode;

      const basePayload = {
        customerId: selectedCustomerId,
        customerVisualId: selectedCustomerVisualId ?? null,
        customerName: selectedCustomerName,
        items: items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          priceCents: item.priceCents,
          unitPriceCents: item.priceCents,
          totalCents: calcDocumentTotalsByTaxMode({
            items: [{ quantity: item.quantity, priceCents: item.priceCents, itbisRateBp: item.itbisRateBp ?? 1800 }],
            shippingCents: 0,
            salePricesIncludeItbis,
          }).totalCents,
          itbisRateBp: item.itbisRateBp ?? 1800,
          unit: item.unit || 'UNIDAD',
          wasPriceOverridden: !!item.wasPriceOverridden,
          recipeAdjustments: Array.isArray(item.recipeAdjustments) ? item.recipeAdjustments : [],
        })),
        subtotalCents: cartTotals.subtotalCents,
        itbisCents: cartTotals.itbisCents,
        totalCents: cartTotals.totalCents,
        salePricesIncludeItbis,
        paymentMethod,
        transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
        paymentSplits: paymentMethod === 'DIVIDIR_PAGO' ? paymentSplits : [],
        type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
        shippingCents: 0,
        status: 'completed',
      };

      if (editingSaleLocalId) {
        localId = editingSaleLocalId;
        const existing = await db.queryFirst<any>('SELECT * FROM sales WHERE local_id = ?', [editingSaleLocalId]);
        if (!existing) {
          Alert.alert('Factura', 'No se encontró la factura que estás editando.');
          setLoading(false);
          return;
        }

        resolvedInvoiceCode = String(existing.invoice_code || editingInvoiceCode || '-');
        invoiceCode = resolvedInvoiceCode;
        createdAt = Number(existing.created_at || now);

        let existingData: any = null;
        try {
          existingData = existing.data ? JSON.parse(existing.data) : null;
        } catch {
          existingData = null;
        }

        const documentSalePricesIncludeItbis =
          typeof existingData?.salePricesIncludeItbis === 'boolean'
            ? existingData.salePricesIncludeItbis
            : salePricesIncludeItbis;
        const documentTotals = calcDocumentTotalsByTaxMode({
          items: items.map((item) => ({
            quantity: item.quantity,
            priceCents: item.priceCents,
            itbisRateBp: item.itbisRateBp ?? 1800,
          })),
          shippingCents: 0,
          salePricesIncludeItbis: documentSalePricesIncludeItbis,
        });
        const documentItems = items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          priceCents: item.priceCents,
          unitPriceCents: item.priceCents,
          totalCents: calcDocumentTotalsByTaxMode({
            items: [{ quantity: item.quantity, priceCents: item.priceCents, itbisRateBp: item.itbisRateBp ?? 1800 }],
            shippingCents: 0,
            salePricesIncludeItbis: documentSalePricesIncludeItbis,
          }).totalCents,
          itbisRateBp: item.itbisRateBp ?? 1800,
          unit: item.unit || 'UNIDAD',
          wasPriceOverridden: !!item.wasPriceOverridden,
          recipeAdjustments: Array.isArray(item.recipeAdjustments) ? item.recipeAdjustments : [],
        }));

        const oldItems = Array.isArray(existingData?.items) ? existingData.items : [];

        // Revertir stock anterior
        for (const oldItem of oldItems) {
          const qty = Number(oldItem?.quantity ?? oldItem?.qty ?? 0);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          const localProductId = await resolveLocalProductId(String(oldItem?.productId || ''));
          if (!localProductId) continue;
          await db.runAsync('UPDATE products SET stock = stock + ? WHERE local_id = ?', [qty, localProductId]);
        }

        // Aplicar stock nuevo
        for (const item of items) {
          await db.runAsync('UPDATE products SET stock = stock - ? WHERE local_id = ?', [item.quantity, item.productId]);
        }

        const updatedData = {
          ...(existingData || {}),
          localId: editingSaleLocalId,
          invoiceCode: resolvedInvoiceCode,
          createdAt,
          soldAt: createdAt,
          ...basePayload,
          items: documentItems,
          subtotalCents: documentTotals.subtotalCents,
          itbisCents: documentTotals.itbisCents,
          totalCents: documentTotals.totalCents,
          salePricesIncludeItbis: documentSalePricesIncludeItbis,
          editedAt: now,
        };

        await db.update('sales', editingSaleLocalId, {
          customer_id: selectedCustomerId,
          total_cents: documentTotals.totalCents,
          status: 'completed',
          synced: 0,
          data: JSON.stringify(updatedData),
        });

        if (paymentMethod === 'CREDITO') {
          await upsertLocalArForCreditSale({
            saleLocalId: editingSaleLocalId,
            invoiceCode: resolvedInvoiceCode,
            createdAt,
            customerId: selectedCustomerId,
            customerName: selectedCustomerName || 'Cliente',
            customerVisualId: selectedCustomerVisualId ?? null,
            totalCents: documentTotals.totalCents,
            dueDate: creditDueDate,
          });
        } else {
          await removeLocalArDraftForSale(editingSaleLocalId);
        }

        await queueSaleUpdateForEdit(editingSaleLocalId, {
          salePricesIncludeItbis: documentSalePricesIncludeItbis,
          customerId: selectedCustomerId,
          customerVisualId: selectedCustomerVisualId ?? null,
          type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
          paymentMethod,
          transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
          paymentSplits: paymentMethod === 'DIVIDIR_PAGO' ? paymentSplits : [],
          createdAt,
          soldAt: createdAt,
          items: items.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            quantity: item.quantity,
            unitPriceCents: item.priceCents,
            itbisRateBp: item.itbisRateBp ?? 1800,
            unit: item.unit || 'UNIDAD',
            price: item.priceCents / 100,
            wasPriceOverridden: !!item.wasPriceOverridden,
          })),
          shippingCents: 0,
          status: 'completed',
        });
      } else {
        const saleData = {
          localId,
          invoiceCode,
          customerId: selectedCustomerId,
          customerVisualId: selectedCustomerVisualId ?? null,
          customerName: selectedCustomerName,
          items,
          subtotalCents: cartTotals.subtotalCents,
          itbisCents: cartTotals.itbisCents,
          totalCents: cartTotals.totalCents,
          salePricesIncludeItbis,
          paymentMethod,
          transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
          paymentSplits: paymentMethod === 'DIVIDIR_PAGO' ? paymentSplits : [],
          status: 'completed',
          createdAt: now,
          soldAt: now,
        };

        await db.insert('sales', {
          local_id: localId,
          invoice_code: invoiceCode,
          customer_id: selectedCustomerId,
          total_cents: cartTotals.totalCents,
          status: 'completed',
          created_at: now,
          synced: 0,
          data: JSON.stringify(saleData),
        });

        if (paymentMethod === 'CREDITO') {
          await upsertLocalArForCreditSale({
            saleLocalId: localId,
            invoiceCode,
            createdAt: now,
            customerId: selectedCustomerId,
            customerName: selectedCustomerName || 'Cliente',
            customerVisualId: selectedCustomerVisualId ?? null,
            totalCents: cartTotals.totalCents,
            dueDate: creditDueDate,
          });
        } else {
          await removeLocalArDraftForSale(localId);
        }

        await syncService.queueOperation('sale', 'create', saleData, localId);

        const syncedSale = await db.queryFirst<{ invoice_code?: string }>(
          'SELECT invoice_code FROM sales WHERE local_id = ?',
          [localId]
        );
        resolvedInvoiceCode = syncedSale?.invoice_code || invoiceCode;

        for (const item of items) {
          await db.runAsync('UPDATE products SET stock = stock - ? WHERE local_id = ?', [item.quantity, item.productId]);
        }
      }

      const saleTicketPayload = {
        invoiceCode: resolvedInvoiceCode,
        createdAt,
        customerName: formatCustomerLabel(selectedCustomerName || 'Cliente general', selectedCustomerVisualId),
        paymentMethod,
        transferBankName,
        paymentSplits: paymentMethod === 'DIVIDIR_PAGO' ? paymentSplits : [],
        type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
        dueDate: paymentMethod === 'CREDITO' ? creditDueDate : null,
        totalCents: cartTotals.totalCents,
        salePricesIncludeItbis,
        items: items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          priceCents: item.priceCents,
          totalCents: calcDocumentTotalsByTaxMode({
            items: [{ quantity: item.quantity, priceCents: item.priceCents, itbisRateBp: item.itbisRateBp ?? 1800 }],
            shippingCents: 0,
            salePricesIncludeItbis,
          }).totalCents,
          unit: item.unit || 'UNIDAD',
          reference: item.sku || null,
          productId: item.productId,
          sku: item.sku || null,
        })),
      };

      // No bloquear el cierre de venta por impresión/sonido.
      void playSaleSuccessSound();
      void (async () => {
        const printResult = await autoPrintSaleTicket(saleTicketPayload);
        if (!printResult.printed && printResult.reason === 'missing_native_module') {
          Alert.alert(
            'Impresion',
            'No se encontro soporte de impresora termica Bluetooth en esta app. Instala el modulo nativo y genera un nuevo build.'
          );
        }
      })();

      // Limpiar carrito
      clear();
      clearEditContext();

      // Navegar a recibo
      navigation.navigate('Receipt', { saleId: localId, invoiceCode: resolvedInvoiceCode });
    } catch (error) {
      console.error('Error completando venta:', error);
      Alert.alert('Error', 'No se pudo completar la venta');
    } finally {
      setLoading(false);
      completingSaleRef.current = false;
    }
  };

  const renderItem = ({ item }: { item: typeof items[0] }) => {
    const step = unitAllowsDecimals(item.unit) ? 0.5 : 1;
    const adjustments = item.recipeAdjustments ?? [];
    const hasRecipeItems = Array.isArray(item.recipeItems) && item.recipeItems.length > 0;

    return (
      <Surface style={styles.itemCard}>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={2}>{item.productName}</Text>
          {item.reference ? (
            <Text style={styles.itemReference}>Ref: {item.reference}</Text>
          ) : null}
          <View style={styles.priceRow}>
            <Text style={styles.itemPrice}>{formatCurrency(item.priceCents)} c/u</Text>
            {canOverridePrice ? (
              <TouchableOpacity style={styles.priceEditChip} onPress={() => openPriceDialog(item)}>
                <Icon source="pencil" size={12} color={ui.colors.primary} />
                <Text style={styles.priceEditText}>Editar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {hasRecipeItems && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {adjustments.length === 0 ? (
                <View style={{ backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, color: '#6B7280' }}>Normal</Text>
                </View>
              ) : (
                adjustments.map((adj: any) => (
                  <View key={adj.ingredientId} style={{ backgroundColor: adj.adjustmentType === 'SIN' ? '#FEF2F2' : '#F0FDF4', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 11, color: adj.adjustmentType === 'SIN' ? '#DC2626' : '#16A34A', fontWeight: '600' }}>
                      {adj.adjustmentType === 'SIN' ? 'Sin' : 'Extra'} {adj.ingredientName}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}
          {hasRecipeItems && (
            <TouchableOpacity
              style={{ marginTop: 6, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'flex-start' }}
              onPress={() => openRecipeDialog(item)}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: ui.colors.primary }}>Personalizar</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.quantityContainer}>
          <IconButton
            icon="minus"
            size={20}
            onPress={() => updateQuantity(item.lineId, Math.max(0, Math.round((item.quantity - step) * 100) / 100))}
          />
          <Text style={styles.quantity}>{formatProductQty(item.quantity, item.unit)}</Text>
          <IconButton
            icon="plus"
            size={20}
            onPress={() => updateQuantity(item.lineId, Math.round((item.quantity + step) * 100) / 100)}
          />
        </View>
        <View style={styles.itemTotal}>
          <Text style={styles.itemTotalText}>{formatCurrency(item.totalCents)}</Text>
          <IconButton
            icon="delete"
            size={20}
            iconColor={ui.colors.danger}
            onPress={() => removeItem(item.lineId)}
          />
        </View>
      </Surface>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.lineId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>El carrito está vacío</Text>
            <Button mode="contained" onPress={() => navigation.goBack()}>
              Agregar Productos
            </Button>
          </View>
        }
      />

      {items.length > 0 && (
        <BottomDock>
          <Surface style={styles.summaryCard}>
            {editingSaleLocalId ? (
              <View style={styles.editingBanner}>
                <Text style={styles.editingBannerText}>Editando factura {editingInvoiceCode || '-'}</Text>
              </View>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Cliente:</Text>
              <Button mode="text" onPress={() => navigation.navigate('SelectCustomer')}>
                {formatCustomerLabel(customerName || 'Cliente general', customerVisualId)}
              </Button>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Método de Pago:</Text>
              <Menu
                visible={menuVisible}
                onDismiss={() => setMenuVisible(false)}
                anchor={
                  <Button mode="text" onPress={() => setMenuVisible(true)}>
                    {paymentMethods.find(m => m.value === paymentMethod)?.label}
                  </Button>
                }
              >
                {paymentMethods.map((method) => (
                  <Menu.Item
                    key={method.value}
                    onPress={() => {
                      handlePaymentMethodSelect(method.value);
                    }}
                    title={method.label}
                  />
                ))}
              </Menu>
            </View>

            {paymentMethod === 'TRANSFERENCIA' && (
              <View style={styles.selectorBlock}>
                <Text style={styles.summaryLabel}>Banco:</Text>
                <Menu
                  visible={transferBankMenuVisible}
                  onDismiss={() => setTransferBankMenuVisible(false)}
                  anchor={
                    <Button mode="text" onPress={() => setTransferBankMenuVisible(true)}>
                      {transferBankName || 'Seleccionar banco'}
                    </Button>
                  }
                >
                  {DOMINICAN_BANKS.map((bankName) => (
                    <Menu.Item
                      key={bankName}
                      onPress={() => {
                        setTransferBankName(bankName);
                        setTransferBankMenuVisible(false);
                      }}
                      title={bankName}
                    />
                  ))}
                </Menu>
              </View>
            )}

            {paymentMethod === 'DIVIDIR_PAGO' && (
              <View style={styles.selectorBlock}>
                <Button mode="outlined" onPress={() => setSplitPaymentModalVisible(true)}>
                  Configurar pago dividido
                </Button>
                {paymentSplits.length > 0 ? (
                  <View style={styles.splitSummaryWrap}>
                    {paymentSplits.map((split, index) => (
                      <Text key={`${split.method}-${index}`} style={styles.splitSummaryText}>
                        {`${formatPaymentWithBank(split.method, split.transferBankName)}: ${formatCurrency(split.amountCents)}`}
                      </Text>
                    ))}
                    <Text style={[styles.splitSummaryText, splitDifferenceCents === 0 ? styles.splitOk : styles.splitError]}>
                      Diferencia: {formatCurrency(splitDifferenceCents)}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            <Divider style={styles.divider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal:</Text>
              <Text style={styles.summaryLabel}>{formatCurrency(cartTotals.subtotalCents)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                ITBIS {salePricesIncludeItbis ? '(incluido)' : '(no incluido)'}:
              </Text>
              <Text style={styles.summaryLabel}>{formatCurrency(cartTotals.itbisCents)}</Text>
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total:</Text>
              <Text style={styles.totalValue}>{formatCurrency(cartTotals.totalCents)}</Text>
            </View>

            <Button
              mode="contained"
              buttonColor={ui.colors.primary}
              textColor="#fff"
              labelStyle={styles.completeButtonLabel}
              onPress={handleCompleteSale}
              loading={loading}
              disabled={loading}
              style={styles.completeButton}
              contentStyle={styles.completeButtonContent}
            >
              {editingSaleLocalId ? 'Guardar Cambios' : 'Completar Venta'}
            </Button>
          </Surface>
        </BottomDock>
      )}

      <Portal>
        <Modal
          visible={splitPaymentModalVisible}
          onDismiss={() => setSplitPaymentModalVisible(false)}
          contentContainerStyle={styles.modalCard}
        >
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>Dividir pago</Text>
            <Text style={styles.modalMeta}>Total de la venta: {formatCurrency(cartTotals.totalCents)}</Text>

            {paymentSplits.map((split, index) => (
              <Surface key={`split-${index}`} style={styles.splitCard}>
                <View style={styles.splitCardHeader}>
                  <Text style={styles.splitCardTitle}>Método {index + 1}</Text>
                  <IconButton icon="delete-outline" onPress={() => removePaymentSplit(index)} />
                </View>

                <Text style={styles.summaryLabel}>Método</Text>
                <Menu
                  visible={splitMethodMenuIndex === index}
                  onDismiss={() => setSplitMethodMenuIndex(null)}
                  anchor={
                    <Button mode="outlined" onPress={() => setSplitMethodMenuIndex(index)}>
                      {getPaymentMethodLabel(split.method)}
                    </Button>
                  }
                >
                  {splitMethodOptions.map((option) => (
                    <Menu.Item
                      key={option.value}
                      onPress={() => {
                        updatePaymentSplit(index, { method: option.value });
                        setSplitMethodMenuIndex(null);
                      }}
                      title={option.label}
                    />
                  ))}
                </Menu>

                {split.method === 'TRANSFERENCIA' ? (
                  <>
                    <Text style={[styles.summaryLabel, styles.fieldTopMargin]}>Banco</Text>
                    <Menu
                      visible={splitBankMenuIndex === index}
                      onDismiss={() => setSplitBankMenuIndex(null)}
                      anchor={
                        <Button mode="outlined" onPress={() => setSplitBankMenuIndex(index)}>
                          {split.transferBankName || 'Seleccionar banco'}
                        </Button>
                      }
                    >
                      {DOMINICAN_BANKS.map((bankName) => (
                        <Menu.Item
                          key={`${bankName}-${index}`}
                          onPress={() => {
                            updatePaymentSplit(index, { transferBankName: bankName });
                            setSplitBankMenuIndex(null);
                          }}
                          title={bankName}
                        />
                      ))}
                    </Menu>
                  </>
                ) : null}

                <TextInput
                  label="Monto (RD$)"
                  value={split.amountCents > 0 ? (split.amountCents / 100).toFixed(2) : ''}
                  onChangeText={(value) => {
                    const parsed = Math.round((parseFloat(value || '0') || 0) * 100);
                    updatePaymentSplit(index, { amountCents: parsed });
                  }}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.fieldTopMargin]}
                  outlineColor={ui.colors.border}
                  activeOutlineColor={ui.colors.primary}
                />
              </Surface>
            ))}

            <Button mode="outlined" onPress={addPaymentSplit} style={styles.addSplitButton}>
              Agregar método
            </Button>

            <View style={styles.splitTotals}>
              <Text style={styles.splitSummaryText}>Total pagado: {formatCurrency(totalSplitCents)}</Text>
              <Text style={[styles.splitSummaryText, splitDifferenceCents === 0 ? styles.splitOk : styles.splitError]}>
                Diferencia: {formatCurrency(splitDifferenceCents)}
              </Text>
            </View>

            <Button mode="contained" onPress={() => setSplitPaymentModalVisible(false)} buttonColor={ui.colors.primary}>
              Listo
            </Button>
          </ScrollView>
        </Modal>
      </Portal>

      <Portal>
        <Modal
          visible={!!priceDialogLineId}
          onDismiss={closePriceDialog}
          contentContainerStyle={styles.priceModalCard}
        >
          <Text style={styles.priceModalTitle}>Modificar precio</Text>
          <Text style={styles.priceModalMeta}>{priceDialogItem?.productName || ''}</Text>
          <TextInput
            label="Precio (RD$)"
            value={priceDraft}
            onChangeText={(value) => {
              setPriceDraft(value);
              if (priceError) setPriceError(null);
            }}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.priceModalInput}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          {priceError ? <Text style={styles.priceErrorText}>{priceError}</Text> : null}
          <View style={styles.priceModalActions}>
            <Button mode="outlined" onPress={closePriceDialog}>
              Cancelar
            </Button>
            <Button mode="contained" buttonColor={ui.colors.primary} onPress={applyPriceChange}>
              Guardar
            </Button>
          </View>
        </Modal>
      </Portal>

      <Portal>
        <Modal
          visible={!!recipeDialogLineId}
          onDismiss={closeRecipeDialog}
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
              Selecciona un modo y marca los ingredientes.
            </Text>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              <TouchableOpacity
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
                  backgroundColor: recipeDialogMode === 'SIN' ? ui.colors.primary : '#F3F4F6',
                }}
                onPress={() => setRecipeDialogMode('SIN')}
              >
                <Text style={{ fontWeight: '700', color: recipeDialogMode === 'SIN' ? '#fff' : '#374151' }}>Sin</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
                  backgroundColor: recipeDialogMode === 'EXTRA' ? ui.colors.primary : '#F3F4F6',
                }}
                onPress={() => setRecipeDialogMode('EXTRA')}
              >
                <Text style={{ fontWeight: '700', color: recipeDialogMode === 'EXTRA' ? '#fff' : '#374151' }}>Extra</Text>
              </TouchableOpacity>
            </View>

            {/* Scope selector */}
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
                const current = recipeDraft[ingredient.ingredientId];
                const isChecked = recipeDialogMode ? current === recipeDialogMode : Boolean(current);
                return (
                  <TouchableOpacity
                    key={ingredient.ingredientId}
                    style={{
                      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      borderWidth: 1, borderColor: isChecked ? ui.colors.primary : '#E5E7EB',
                      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
                      backgroundColor: isChecked ? '#f0e6ff' : '#fff',
                    }}
                    disabled={!recipeDialogMode}
                    onPress={() => {
                      if (!recipeDialogMode) return;
                      setRecipeDraft(prev => {
                        const next = { ...prev };
                        if (next[ingredient.ingredientId] === recipeDialogMode) {
                          delete next[ingredient.ingredientId];
                        } else {
                          next[ingredient.ingredientId] = recipeDialogMode;
                        }
                        return next;
                      });
                    }}
                  >
                    <View>
                      <Text style={{ fontWeight: '600', color: '#111827', fontSize: 14 }}>{ingredient.ingredientName}</Text>
                      {current && (
                        <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                          Aplicado: {current === 'SIN' ? 'Sin' : 'Extra'}
                        </Text>
                      )}
                    </View>
                    <View style={{
                      width: 22, height: 22, borderRadius: 4,
                      borderWidth: 2, borderColor: isChecked ? ui.colors.primary : '#D1D5DB',
                      backgroundColor: isChecked ? ui.colors.primary : '#fff',
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      {isChecked && <Icon source="check" size={14} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              });
            })()}

            <TouchableOpacity
              style={{
                marginTop: 10, backgroundColor: ui.colors.primary, borderRadius: 10,
                paddingVertical: 14, alignItems: 'center',
              }}
              onPress={applyRecipeAdjustments}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Aplicar ajustes</Text>
            </TouchableOpacity>
          </ScrollView>
        </Modal>
      </Portal>

      <View pointerEvents="none" style={[styles.systemBottomBg, { height: systemBottomInset }]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.background,
  },
  listContent: {
    padding: 12,
    paddingBottom: 240,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 8,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    elevation: 1,
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: ui.colors.text,
  },
  itemReference: {
    fontSize: 12,
    color: ui.colors.textMuted,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 12,
    color: ui.colors.textMuted,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  priceEditChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ui.colors.primary,
    backgroundColor: '#F5F3FF',
  },
  priceEditText: {
    fontSize: 11,
    fontWeight: '600',
    color: ui.colors.primary,
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
    marginRight: 4,
  },
  quantity: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 30,
    textAlign: 'center',
    color: ui.colors.text,
  },
  itemTotal: {
    alignItems: 'flex-end',
  },
  itemTotalText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: ui.colors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: ui.colors.textMuted,
    marginBottom: 16,
  },
  summaryCard: {
    padding: 16,
    borderTopLeftRadius: ui.radius.lg,
    borderTopRightRadius: ui.radius.lg,
    backgroundColor: ui.colors.surface,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    elevation: 8,
  },
  editingBanner: {
    backgroundColor: '#DBEAFE',
    borderRadius: ui.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  editingBannerText: {
    color: '#1E40AF',
    fontSize: 12,
    fontWeight: '800',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: ui.colors.textMuted,
  },
  selectorBlock: {
    marginBottom: 8,
  },
  splitSummaryWrap: {
    marginTop: 8,
    gap: 4,
  },
  splitSummaryText: {
    fontSize: 12,
    color: ui.colors.textMuted,
  },
  splitOk: {
    color: ui.colors.success || '#16A34A',
    fontWeight: '700',
  },
  splitError: {
    color: ui.colors.danger,
    fontWeight: '700',
  },
  divider: {
    marginVertical: 12,
    backgroundColor: ui.colors.border,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: ui.colors.text,
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: ui.colors.primary,
  },
  completeButton: {
    marginTop: 8,
    marginBottom: 5,
    fontSize: 20,
  },
  completeButtonContent: {
    paddingVertical: 8,
  },
  completeButtonLabel: {
    fontSize: 18,
    fontWeight: '800',
  },
  modalCard: {
    backgroundColor: ui.colors.surface,
    margin: 16,
    borderRadius: ui.radius.lg,
    maxHeight: '86%',
  },
  modalContent: {
    padding: 16,
  },
  priceModalCard: {
    backgroundColor: ui.colors.surface,
    margin: 20,
    borderRadius: ui.radius.lg,
    padding: 16,
  },
  priceModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: ui.colors.text,
  },
  priceModalMeta: {
    marginTop: 4,
    marginBottom: 12,
    fontSize: 13,
    color: ui.colors.textMuted,
  },
  priceModalInput: {
    backgroundColor: ui.colors.surface,
  },
  priceErrorText: {
    marginTop: 6,
    color: ui.colors.danger,
    fontSize: 12,
  },
  priceModalActions: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: ui.colors.text,
    marginBottom: 4,
  },
  modalMeta: {
    fontSize: 13,
    color: ui.colors.textMuted,
    marginBottom: 12,
  },
  splitCard: {
    padding: 12,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    marginBottom: 12,
    backgroundColor: ui.colors.surface,
  },
  splitCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  splitCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: ui.colors.text,
  },
  input: {
    backgroundColor: ui.colors.surface,
  },
  fieldTopMargin: {
    marginTop: 10,
  },
  addSplitButton: {
    marginBottom: 12,
  },
  splitTotals: {
    marginBottom: 12,
    gap: 4,
  },
  systemBottomBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: ui.colors.surface,
  },
});
