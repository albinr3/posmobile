import type { StockConsumption } from '../../utils/stockCore';
import { saleStockService, useSaleStockStore } from '../../services/stock/saleStockService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, Surface, Button, IconButton, Divider, Menu, Portal, Modal, TextInput, Icon } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCartStore } from '../../store/cartStore';
import { useTutorialCartStore } from '../../store/tutorialCartStore';
import { useOnboardingStore } from '../../store/onboardingStore';
import { OnboardingTarget } from '../../components/onboarding/OnboardingTarget';
import { normalizeSaleNotes, SALE_NOTES_MAX_LENGTH } from '../../utils/saleNotes';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency, generateInvoiceCode, generateLocalId } from '../../utils/helpers';
import { db, type DatabaseTransaction } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { cashContextForQueue, getCashContext } from '../../services/cash/cashShiftService';
import { CashShiftGate } from '../../components/CashShiftGate';
import { ui } from '../../theme/ui';
import { SalePrice } from '../../components/sales/SalesPresentation';
import { getBottomSafeInset } from '../../utils/safeArea';
import { SaleItem, SalePaymentSplit, TreasuryAccount } from '../../types';
import { formatPaymentWithBank, getPaymentMethodLabel } from '../../utils/paymentMethods';
import { formatProductQty, unitAllowsDecimals } from '../../utils/productUnits';
import { buildLineId } from '../../store/createCartStore';
import { autoPrintSaleTicket } from '../../services/printing/thermalPrinterService';
import { playSaleSuccessSound } from '../../services/feedback/saleFeedbackService';
import { getSalesSettings, subscribeSalesSettings } from '../../services/settings/salesSettings';
import { calcDocumentTotalsByTaxMode, normalizeDiscountPercentBp } from '../../utils/tax';
import { resolveGeneralCustomerFromDb } from '../../utils/generalCustomer';
import { LEGAL_TIP_PERCENT_BP, calculateLegalTipCents, normalizeApplyLegalTip } from '../../utils/legalTip';
import { listTreasuryAccounts, getAccountTransferBankName } from '../../services/treasury/treasuryService';
import { TREASURY_CREATE_ACCOUNT_SENTINEL, filterTreasuryAccountsByMethod, findTreasuryAccountById } from '../../utils/treasury';
import { useTreasuryUIStore } from '../../store/treasuryUIStore';
import {
  formatCustomerLabel,
  GENERIC_CUSTOMER_DISPLAY_NAME,
  GENERIC_CUSTOMER_VISUAL_ID,
  isGenericCustomerLabel,
  normalizeCustomerVisualId,
  parseCustomerVisualIdFromData,
} from '../../utils/customerLabels';

interface CartScreenProps {
  navigation: any;
  tutorial?: boolean;
  route?: {
    params?: {
      customerId?: string | null;
      customerName?: string | null;
      customerVisualId?: number | null;
      editSaleLocalId?: string | null;
    };
  };
}

const formatDiscountPercentFromBp = (discountPercentBp: number | null | undefined): string => {
  const normalizedDiscountBp = normalizeDiscountPercentBp(discountPercentBp ?? 0);
  if (normalizedDiscountBp <= 0) return '';
  const value = (normalizedDiscountBp / 100).toFixed(2);
  return value.replace(/\.?0+$/, '');
};

const parseDiscountPercentInput = (rawInput: string): { valueBp: number | null; error: string | null } => {
  const normalized = String(rawInput || '').replace(',', '.').trim();
  if (!normalized) return { valueBp: null, error: null };

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { valueBp: null, error: 'Ingresa un porcentaje válido.' };
  }
  if (parsed < 0 || parsed > 100) {
    return { valueBp: null, error: 'El descuento debe estar entre 0 y 100%.' };
  }

  return { valueBp: Math.round(parsed * 100), error: null };
};

const normalizeMethod = (value: unknown): string => String(value || '').trim().toUpperCase();
const DEFAULT_CASH_ACCOUNT_NAME = 'caja efectivo';

const normalizeAccountName = (value: unknown): string =>
  String(value || '').trim().toLocaleLowerCase('es');

export function CartScreen({ navigation, route, tutorial = false }: CartScreenProps) {
  const useScreenCart = tutorial ? useTutorialCartStore : useCartStore;
  const stockSnapshot = useSaleStockStore();
  useFocusEffect(useCallback(() => {
    if (!tutorial) void saleStockService.refresh(useScreenCart.getState().editingSaleLocalId);
  }, [tutorial, useScreenCart]));
  const insets = useSafeAreaInsets();
  const systemBottomInset = getBottomSafeInset(insets.bottom);
  const {
    items,
    notes,
    setNotes,
    updateQuantity,
    updatePrice,
    removeItem,
    customerId,
    customerName,
    customerVisualId,
    customerSaleDiscountPercentBp,
    discountPercentBp,
    discountWasManual,
    setDiscountPercentBp,
    paymentMethod,
    setPaymentMethod,
    transferBankName,
    setTransferBankName,
    treasuryAccountId,
    setTreasuryAccountId,
    paymentSplits,
    setPaymentSplits,
    shippingCents,
    setShippingCents,
    applyLegalTip,
    setApplyLegalTip,
    clear,
    editingSaleLocalId,
    editingInvoiceCode,
    clearEditContext,
  } = useScreenCart();
  const [loading, setLoading] = useState(false);
  const [summaryHeight, setSummaryHeight] = useState(0);
  const itemsListRef = useRef<FlatList<SaleItem>>(null);
  const completingSaleRef = useRef(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [splitPaymentModalVisible, setSplitPaymentModalVisible] = useState(false);
  const [splitMethodMenuIndex, setSplitMethodMenuIndex] = useState<number | null>(null);
  const [treasuryAccountMenuVisible, setTreasuryAccountMenuVisible] = useState(false);
  const [splitTreasuryMenuIndex, setSplitTreasuryMenuIndex] = useState<number | null>(null);
  const [shippingModalVisible, setShippingModalVisible] = useState(false);
  const [shippingDraft, setShippingDraft] = useState('');
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [salePricesIncludeItbis, setSalePricesIncludeItbis] = useState(true);
  const [legalTipEnabled, setLegalTipEnabled] = useState(false);
  const { setCustomer } = useScreenCart();
  const { subUser } = useAuthStore();
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([]);
  const requestCreateAccountModal = useTreasuryUIStore((state) => state.requestCreateAccountModal);
  const consumeLastCreatedAccountId = useTreasuryUIStore((state) => state.consumeLastCreatedAccountId);
  const canOverridePrice = !tutorial && (!!subUser?.isOwner || (subUser as any)?.canOverridePrice === true || subUser?.role === 'ADMIN');
  const canApplyDiscounts = !tutorial && (!!subUser?.isOwner || (subUser as any)?.canApplyDiscounts === true || subUser?.role === 'ADMIN');
  const appliedDiscountPercentBp = normalizeDiscountPercentBp(discountPercentBp ?? 0);

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
      const { items: currentItems } = useScreenCart.getState();
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
        if (!useScreenCart.getState().setItems(nextItems)) return;
      } else {
        if (newLineId !== recipeDialogLineId) {
          const existingTarget = currentItems.find(i => i.lineId === newLineId);
          if (existingTarget) {
            if (!useScreenCart.getState().setItems(currentItems
                .filter(i => i.lineId !== recipeDialogLineId)
                .map(i => i.lineId === newLineId
                  ? { ...i, quantity: i.quantity + cartItem.quantity, totalCents: (i.quantity + cartItem.quantity) * i.priceCents }
                  : i
                ))) return;
          } else {
            if (!useScreenCart.getState().setItems(currentItems.map(item =>
                item.lineId === recipeDialogLineId
                  ? { ...item, lineId: newLineId, recipeAdjustments: adjustments }
                  : item
              ))) return;
          }
        } else {
          if (!useScreenCart.getState().setItems(currentItems.map(item =>
              item.lineId === recipeDialogLineId
                ? { ...item, recipeAdjustments: adjustments }
                : item
            ))) return;
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

  const openShippingModal = () => {
    setShippingDraft(shippingCents > 0 ? (shippingCents / 100).toFixed(2) : '');
    setShippingError(null);
    setShippingModalVisible(true);
  };

  const closeShippingModal = () => {
    setShippingModalVisible(false);
    setShippingDraft('');
    setShippingError(null);
  };

  const applyShippingChange = () => {
    const normalized = shippingDraft.replace(',', '.').trim();
    if (!normalized) {
      setShippingCents(0);
      closeShippingModal();
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setShippingError('Ingresa un monto válido.');
      return;
    }
    setShippingCents(Math.round(parsed * 100));
    closeShippingModal();
  };

  const applyDiscountDraft = (nextDraft: string, markAsManual: boolean = true): boolean => {
    const parsed = parseDiscountPercentInput(nextDraft);
    if (parsed.error) {
      setDiscountError(parsed.error);
      return false;
    }

    setDiscountError(null);
    setDiscountPercentBp(parsed.valueBp, markAsManual);
    return true;
  };

  useEffect(() => {
    const nextDraft = formatDiscountPercentFromBp(discountPercentBp);
    setDiscountDraft(nextDraft);
    setDiscountError(null);
  }, [discountPercentBp, customerId, customerSaleDiscountPercentBp]);

  useEffect(() => {
    if (tutorial) return;
    const unsubscribe = subscribeSalesSettings((settings) => {
      setSalePricesIncludeItbis(settings.salePricesIncludeItbis !== false);
      const nextLegalTipEnabled = settings.legalTipEnabled === true;
      setLegalTipEnabled(nextLegalTipEnabled);
      if (!nextLegalTipEnabled) {
        setApplyLegalTip(false);
      }
    });

    return unsubscribe;
  }, [tutorial, setApplyLegalTip]);

  useFocusEffect(
    useCallback(() => {
      if (tutorial) return;
      let active = true;
      const loadTreasuryAccounts = async () => {
        try {
          const rows = await listTreasuryAccounts(false);
          if (!active) return;
          setTreasuryAccounts(rows);
          const createdAccountId = consumeLastCreatedAccountId();
          if (createdAccountId) {
            if (paymentMethod === 'DIVIDIR_PAGO') {
              const nextSplits = Array.isArray(paymentSplits) ? [...paymentSplits] : [];
              if (nextSplits.length > 0) {
                const targetIndex =
                  nextSplits.findIndex((split) => !split.treasuryAccountId) >= 0
                    ? nextSplits.findIndex((split) => !split.treasuryAccountId)
                    : nextSplits.length - 1;
                nextSplits[targetIndex] = {
                  ...nextSplits[targetIndex],
                  treasuryAccountId: createdAccountId,
                };
                setPaymentSplits(nextSplits);
              }
            } else {
              setTreasuryAccountId(createdAccountId);
              const createdAccount = findTreasuryAccountById(rows, createdAccountId);
              if (paymentMethod === 'TRANSFERENCIA' && createdAccount) {
                setTransferBankName(getAccountTransferBankName(createdAccount));
              }
            }
          }
        } catch {
          if (!active) return;
          setTreasuryAccounts([]);
        }
      };
      void loadTreasuryAccounts();
      return () => {
        active = false;
      };
    }, [
      tutorial,
      consumeLastCreatedAccountId,
      paymentMethod,
      paymentSplits,
      setPaymentSplits,
      setTransferBankName,
      setTreasuryAccountId,
    ])
  );

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
      if (tutorial) return;
      let active = true;
      getSalesSettings()
        .then((settings) => {
          if (!active) return;
          setSalePricesIncludeItbis(settings.salePricesIncludeItbis !== false);
          const nextLegalTipEnabled = settings.legalTipEnabled === true;
          setLegalTipEnabled(nextLegalTipEnabled);
          if (!nextLegalTipEnabled) {
            setApplyLegalTip(false);
          }
        })
        .catch(() => {
          if (!active) return;
          setSalePricesIncludeItbis(true);
          setLegalTipEnabled(false);
          setApplyLegalTip(false);
        });
      return () => {
        active = false;
      };
    }, [tutorial, setApplyLegalTip])
  );

  useFocusEffect(
    useCallback(() => {
      if (tutorial || !editingSaleLocalId) return;
      let active = true;
      const loadDocumentMode = async () => {
        try {
          const sale = await db.queryFirst<{ data?: string }>('SELECT data FROM sales WHERE local_id = ?', [editingSaleLocalId]);
          const parsed = sale?.data ? JSON.parse(sale.data) : null;
          if (!active) return;
          if (typeof parsed?.salePricesIncludeItbis === 'boolean') {
            setSalePricesIncludeItbis(parsed.salePricesIncludeItbis);
          }
          setApplyLegalTip(normalizeApplyLegalTip(parsed, false));
          setShippingCents(Number(
            parsed?.shippingCents ??
            parsed?.fleteCents ??
            (Number.isFinite(Number(parsed?.shipping ?? parsed?.flete))
              ? Math.round(Number(parsed?.shipping ?? parsed?.flete) * 100)
              : 0)
          ));
        } catch {
          // no-op
        }
      };
      void loadDocumentMode();
      return () => {
        active = false;
      };
    }, [tutorial, editingSaleLocalId, setApplyLegalTip])
  );

  const cartTotals = useMemo(
    () => {
      const documentTotals = calcDocumentTotalsByTaxMode({
        items: items.map((item) => ({
          quantity: item.quantity,
          priceCents: item.priceCents,
          itbisRateBp: item.itbisRateBp ?? 1800,
        })),
        shippingCents,
        salePricesIncludeItbis,
        discountPercentBp: appliedDiscountPercentBp,
      });
      const legalTipBaseCents = documentTotals.subtotalCents;
      const legalTipCents =
        legalTipEnabled && applyLegalTip
          ? calculateLegalTipCents(legalTipBaseCents, LEGAL_TIP_PERCENT_BP)
          : 0;
      return {
        ...documentTotals,
        legalTipBaseCents,
        legalTipPercentBp: LEGAL_TIP_PERCENT_BP,
        legalTipApplied: legalTipEnabled && applyLegalTip && legalTipCents > 0,
        legalTipCents,
        totalCents: documentTotals.totalCents + legalTipCents,
      };
    },
    [items, shippingCents, salePricesIncludeItbis, appliedDiscountPercentBp, legalTipEnabled, applyLegalTip]
  );

  useEffect(() => {
    if (tutorial || editingSaleLocalId) return;
    const routeCustomerId = route?.params?.customerId;
    const routeCustomerName = route?.params?.customerName;
    const routeCustomerVisualId = route?.params?.customerVisualId;

    let active = true;
    const applyRouteCustomer = async () => {
      if (
        typeof routeCustomerId === 'undefined' &&
        typeof routeCustomerName === 'undefined' &&
        typeof routeCustomerVisualId === 'undefined'
      ) {
        return;
      }

      let customerDiscountBp: number | null = null;
      if (routeCustomerId) {
        const customerRow = await db.queryFirst<{ data?: string | null }>(
          'SELECT data FROM customers WHERE local_id = ? OR server_id = ? LIMIT 1',
          [routeCustomerId, routeCustomerId]
        );
        if (customerRow?.data) {
          try {
            const parsedCustomer = JSON.parse(customerRow.data);
            const normalizedCustomerDiscountBp = normalizeDiscountPercentBp(
              parsedCustomer?.saleDiscountPercentBp ?? parsedCustomer?.sale_discount_percent_bp ?? 0
            );
            customerDiscountBp = normalizedCustomerDiscountBp > 0 ? normalizedCustomerDiscountBp : null;
          } catch {
            customerDiscountBp = null;
          }
        }
      }

      if (!active) return;
      setCustomer(
        routeCustomerId ?? null,
        routeCustomerName ?? null,
        routeCustomerVisualId ?? null,
        customerDiscountBp
      );
    };

    void applyRouteCustomer();
    return () => {
      active = false;
    };
  }, [
    tutorial,
    editingSaleLocalId,
    route?.params?.customerId,
    route?.params?.customerName,
    route?.params?.customerVisualId,
    setCustomer,
  ]);

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
  }, tx?: DatabaseTransaction) => {
    if (!params.customerId) return;
    const arLocalId = buildLocalArIdForSale(params.saleLocalId);
    const arPayload = {
      localId: arLocalId,
      saleLocalId: params.saleLocalId,
      saleServerId: null,
      customerId: params.customerId,
      customerName: params.customerName || GENERIC_CUSTOMER_DISPLAY_NAME,
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
      customer_name: params.customerName || GENERIC_CUSTOMER_DISPLAY_NAME,
      total_cents: params.totalCents,
      paid_cents: 0,
      balance_cents: params.totalCents,
      status: 'PENDIENTE',
      due_date: params.dueDate,
      synced: 0,
      data: JSON.stringify(arPayload),
    };

    const exists = await (tx ?? db).queryFirst<{ local_id?: string }>(
      'SELECT local_id FROM accounts_receivable WHERE local_id = ? LIMIT 1',
      [arLocalId]
    );
    if (exists?.local_id) {
      if (tx) await tx.runAsync('UPDATE accounts_receivable SET customer_id = ?, customer_visual_id = ?, customer_name = ?, total_cents = ?, paid_cents = 0, balance_cents = ?, status = ?, due_date = ?, synced = 0, data = ? WHERE local_id = ?', [arRow.customer_id, arRow.customer_visual_id, arRow.customer_name, arRow.total_cents, arRow.balance_cents, arRow.status, arRow.due_date, arRow.data, arLocalId]);
      else await db.update('accounts_receivable', arLocalId, arRow, 'local_id');
      return;
    }

    if (tx) await tx.runAsync('INSERT INTO accounts_receivable (local_id, customer_id, customer_visual_id, customer_name, total_cents, paid_cents, balance_cents, status, due_date, synced, data) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)', [arLocalId, arRow.customer_id, arRow.customer_visual_id, arRow.customer_name, arRow.total_cents, arRow.balance_cents, arRow.status, arRow.due_date, arRow.data]);
    else await db.insert('accounts_receivable', { local_id: arLocalId, ...arRow });
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
  const treasuryAccountsByMethod = useMemo(
    () => filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), paymentMethod),
    [paymentMethod, treasuryAccounts]
  );

  const pickDefaultTreasuryAccountByMethod = useCallback(
    (method: string): TreasuryAccount | null => {
      const allowed = filterTreasuryAccountsByMethod(
        treasuryAccounts.filter((account) => account.isActive),
        method
      );
      if (allowed.length === 0) return null;
      if (normalizeMethod(method) !== 'EFECTIVO') return allowed[0] || null;

      const candidates = allowed.filter(
        (account) =>
          account.type === 'CAJA' && normalizeAccountName(account.name) === DEFAULT_CASH_ACCOUNT_NAME
      );
      if (candidates.length === 0) return allowed[0] || null;
      const sortedCandidates = [...candidates].sort((a, b) => {
        const aServerRank = a.serverId ? 0 : 1;
        const bServerRank = b.serverId ? 0 : 1;
        if (aServerRank !== bServerRank) return aServerRank - bServerRank;
        const aActiveRank = a.isActive ? 0 : 1;
        const bActiveRank = b.isActive ? 0 : 1;
        if (aActiveRank !== bActiveRank) return aActiveRank - bActiveRank;
        return a.createdAt - b.createdAt;
      });
      return sortedCandidates[0] || null;
    },
    [treasuryAccounts]
  );

  useEffect(() => {
    if (tutorial) return;
    if (normalizeMethod(paymentMethod) !== 'EFECTIVO') return;
    const allowed = filterTreasuryAccountsByMethod(
      treasuryAccounts.filter((account) => account.isActive),
      paymentMethod
    );
    const currentAccount = findTreasuryAccountById(allowed, treasuryAccountId);
    if (currentAccount) return;
    const preferred = pickDefaultTreasuryAccountByMethod('EFECTIVO');
    if (preferred?.localId) {
      setTreasuryAccountId(preferred.localId);
    }
  }, [
    tutorial,
    paymentMethod,
    pickDefaultTreasuryAccountByMethod,
    setTreasuryAccountId,
    treasuryAccountId,
    treasuryAccounts,
  ]);

  const handlePaymentMethodSelect = (nextMethod: string) => {
    setPaymentMethod(nextMethod);
    if (nextMethod !== 'TRANSFERENCIA') {
      setTransferBankName(null);
    }
    if (nextMethod === 'EFECTIVO' || nextMethod === 'TRANSFERENCIA') {
      const allowed = filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), nextMethod);
      const currentAccount = findTreasuryAccountById(allowed, treasuryAccountId);
      const preferred = pickDefaultTreasuryAccountByMethod(nextMethod);
      if (!currentAccount) {
        setTreasuryAccountId(preferred?.localId || null);
      }
      if (nextMethod === 'TRANSFERENCIA') {
        const selected = currentAccount || preferred;
        if (selected) {
          setTransferBankName(getAccountTransferBankName(selected));
        }
      }
    } else {
      setTreasuryAccountId(null);
    }
    if (nextMethod !== 'DIVIDIR_PAGO') {
      setPaymentSplits([]);
    }
    setMenuVisible(false);
  };

  const addPaymentSplit = () => {
    const defaultAccount = pickDefaultTreasuryAccountByMethod('EFECTIVO');
    setPaymentSplits([
      ...paymentSplits,
      {
        method: 'EFECTIVO',
        amountCents: 0,
        transferBankName: null,
        treasuryAccountId: defaultAccount?.localId || null,
      },
    ]);
  };

  const updatePaymentSplit = (index: number, patch: Partial<SalePaymentSplit>) => {
    setPaymentSplits(
      paymentSplits.map((split, splitIndex) => {
        if (splitIndex !== index) return split;
        const nextSplit = { ...split, ...patch };
        if (nextSplit.method !== 'TRANSFERENCIA') {
          nextSplit.transferBankName = null;
        }
        if (patch.method) {
          const allowed = filterTreasuryAccountsByMethod(
            treasuryAccounts.filter((account) => account.isActive),
            patch.method
          );
          const preferred = pickDefaultTreasuryAccountByMethod(patch.method);
          const selected = findTreasuryAccountById(allowed, nextSplit.treasuryAccountId);
          nextSplit.treasuryAccountId = selected?.localId || preferred?.localId || null;
          if (patch.method === 'TRANSFERENCIA') {
            const transferAccount = selected || preferred;
            nextSplit.transferBankName = transferAccount ? getAccountTransferBankName(transferAccount) : null;
          }
        }
        return nextSplit;
      })
    );
  };

  const removePaymentSplit = (index: number) => {
    setPaymentSplits(paymentSplits.filter((_, splitIndex) => splitIndex !== index));
  };

  const handleMainTreasuryAccountSelect = (nextValue: string) => {
    if (nextValue === TREASURY_CREATE_ACCOUNT_SENTINEL) {
      requestCreateAccountModal(paymentMethod === 'EFECTIVO' ? 'CAJA' : paymentMethod === 'TRANSFERENCIA' ? 'BANCO' : null);
      navigation.navigate('TreasuryMenu', { screen: 'Treasury' });
      setTreasuryAccountMenuVisible(false);
      return;
    }
    const selected = findTreasuryAccountById(treasuryAccountsByMethod, nextValue);
    setTreasuryAccountId(selected?.localId || null);
    if (paymentMethod === 'TRANSFERENCIA' && selected) {
      setTransferBankName(getAccountTransferBankName(selected));
    }
    setTreasuryAccountMenuVisible(false);
  };

  const handleSplitTreasuryAccountSelect = (index: number, nextValue: string) => {
    if (nextValue === TREASURY_CREATE_ACCOUNT_SENTINEL) {
      const split = paymentSplits[index];
      const preferredType = split?.method === 'EFECTIVO' ? 'CAJA' : split?.method === 'TRANSFERENCIA' ? 'BANCO' : null;
      requestCreateAccountModal(preferredType);
      navigation.navigate('TreasuryMenu', { screen: 'Treasury' });
      setSplitTreasuryMenuIndex(null);
      return;
    }
    updatePaymentSplit(index, { treasuryAccountId: nextValue });
    const split = paymentSplits[index];
    if (split?.method === 'TRANSFERENCIA') {
      const allowed = filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), 'TRANSFERENCIA');
      const selected = findTreasuryAccountById(allowed, nextValue);
      if (selected) {
        updatePaymentSplit(index, {
          treasuryAccountId: selected.localId,
          transferBankName: getAccountTransferBankName(selected),
        });
      }
    }
    setSplitTreasuryMenuIndex(null);
  };

  const totalSplitCents = useMemo(
    () => paymentSplits.reduce((sum, split) => sum + Number(split.amountCents || 0), 0),
    [paymentSplits]
  );

  const splitDifferenceCents = cartTotals.totalCents - totalSplitCents;

  const handleCompleteSale = async () => {
    if (completingSaleRef.current) return;
    completingSaleRef.current = true;
    if (tutorial) {
      const practiceItems = useScreenCart.getState().items;
      if (practiceItems.length === 0 || practiceItems.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
        completingSaleRef.current = false;
        return;
      }
      // La práctica usa los mismos controles, pero no genera cobros, movimientos ni facturas.
      if (!useOnboardingStore.getState().completePractice()) {
        completingSaleRef.current = false;
        return;
      }
      navigation.replace('PracticeDone');
      return;
    }
    setLoading(true);
    let reservation: Awaited<ReturnType<typeof saleStockService.reserve>> | null = null;
    let stockPersisted = false;
    let committedSale: { id: string; invoiceCode: string } | null = null;
    try {
      if (items.length === 0) return;
      const normalizedNotes = normalizeSaleNotes(notes);
      await saleStockService.refresh(editingSaleLocalId);
      const stockIssue = saleStockService.issue(items);
      if (stockIssue) { Alert.alert('Existencias', stockIssue.message); return; }
      useSaleStockStore.setState({ saving: true });
    if (!applyDiscountDraft(discountDraft, discountWasManual)) {
      Alert.alert('Descuento inválido', 'Corrige el porcentaje de descuento antes de completar la venta.');
      return;
    }
    const resolvedDiscountPercentBp = normalizeDiscountPercentBp(discountPercentBp ?? 0);
    const resolvedDiscountSource =
      discountWasManual
        ? 'MANUAL'
        : resolvedDiscountPercentBp > 0
          ? 'CUSTOMER'
          : 'NONE';
    const resolvedDiscountMode = discountWasManual ? 'MANUAL' : 'AUTO';
    const resolvedManualDiscountPercentBp = discountWasManual ? resolvedDiscountPercentBp : undefined;
    const resolvedApplyLegalTip = legalTipEnabled && applyLegalTip;
    const resolvedLegalTipPercentBp = LEGAL_TIP_PERCENT_BP;
    const resolvedLegalTipBaseCents = cartTotals.legalTipBaseCents;
    const resolvedLegalTipCents = resolvedApplyLegalTip ? cartTotals.legalTipCents : 0;
    let creditDueDate: number | null = null;
    let selectedCustomerId = customerId;
    let selectedCustomerName = customerName;
    let selectedCustomerVisualId = customerVisualId;
    let selectedCustomerSaleDiscountPercentBp = customerSaleDiscountPercentBp ?? null;

    if (!selectedCustomerId) {
      const defaultCustomer = await resolveGeneralCustomerFromDb();
      if (!defaultCustomer?.localId) {
        Alert.alert(
          'Cliente requerido',
          'No se encontró el cliente "Cliente general". Sin ese cliente no se puede registrar la venta.'
        );
        return;
      }
      selectedCustomerId = defaultCustomer.localId;
      selectedCustomerName = defaultCustomer.name || GENERIC_CUSTOMER_DISPLAY_NAME;
      selectedCustomerVisualId = defaultCustomer.visualId ?? GENERIC_CUSTOMER_VISUAL_ID;
      selectedCustomerSaleDiscountPercentBp = defaultCustomer.saleDiscountPercentBp ?? null;
      setCustomer(
        selectedCustomerId,
        selectedCustomerName,
        selectedCustomerVisualId,
        selectedCustomerSaleDiscountPercentBp
      );
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
      let customerDiscountBp: number | null = null;
      try {
        const parsedCustomer = customerRow?.data ? JSON.parse(customerRow.data) : null;
        const normalizedCustomerDiscountBp = normalizeDiscountPercentBp(
          parsedCustomer?.saleDiscountPercentBp ?? parsedCustomer?.sale_discount_percent_bp ?? 0
        );
        customerDiscountBp = normalizedCustomerDiscountBp > 0 ? normalizedCustomerDiscountBp : null;
      } catch {
        customerDiscountBp = null;
      }
      if (customerDiscountBp !== null || selectedCustomerSaleDiscountPercentBp === null) {
        selectedCustomerSaleDiscountPercentBp = customerDiscountBp;
      }
      if (selectedCustomerVisualId) {
        setCustomer(
          selectedCustomerId,
          selectedCustomerName ?? null,
          selectedCustomerVisualId,
          selectedCustomerSaleDiscountPercentBp
        );
      }
    }

    if (paymentMethod === 'CREDITO') {
      if (!selectedCustomerId || isGenericCustomerLabel(selectedCustomerName, selectedCustomerVisualId)) {
        Alert.alert(
          'Cliente requerido',
          'Las ventas a crédito requieren un cliente específico. "Cliente general" no está permitido para crédito.'
        );
        return;
      }

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

    if ((paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA') && !treasuryAccountId) {
      Alert.alert('Cuenta requerida', 'Debes seleccionar una cuenta de tesorería.');
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
      const invalidTreasurySplit = paymentSplits.find(
        (split) =>
          (split.method === 'EFECTIVO' || split.method === 'TRANSFERENCIA') &&
          !String(split.treasuryAccountId || '').trim()
      );
      if (invalidTreasurySplit) {
        Alert.alert('Pago dividido', 'Cada línea en efectivo/transferencia debe tener cuenta de tesorería.');
        return;
      }
      const invalidAmountSplit = paymentSplits.find((split) => !Number.isFinite(split.amountCents) || split.amountCents <= 0);
      if (invalidAmountSplit) {
        Alert.alert('Pago dividido', 'Cada línea del pago dividido debe tener un monto válido.');
        return;
      }
    }

      // Comprobar antes de crear la factura o tocar la cola. La reserva SQLite
      // vuelve a validar de forma atómica después de la comprobación remota.
      const cashContext = await getCashContext();
      if (cashContext.enabled && editingSaleLocalId) throw new Error('Corrige esta factura desde el historial del turno de caja.');
      const cashQueueContext = editingSaleLocalId ? null : await cashContextForQueue('sale', 'create', { paymentMethod });
      await syncService.checkSaleStock(items, editingSaleLocalId);
      let localId = generateLocalId();
      let invoiceCode = generateInvoiceCode();
      const now = Date.now();
      let createdAt = now;
      let resolvedInvoiceCode = invoiceCode;
      const selectedMainAccount = findTreasuryAccountById(treasuryAccounts, treasuryAccountId);
      const resolvedMainTransferBankName =
        paymentMethod === 'TRANSFERENCIA'
          ? selectedMainAccount
            ? getAccountTransferBankName(selectedMainAccount)
            : transferBankName
          : null;
      const normalizedPaymentSplits =
        paymentMethod === 'DIVIDIR_PAGO'
          ? paymentSplits.map((split) => {
              const splitMethod = normalizeMethod(split.method);
              const splitAccount = findTreasuryAccountById(treasuryAccounts, split.treasuryAccountId);
              return {
                ...split,
                treasuryAccountId: splitAccount?.localId || split.treasuryAccountId || null,
                transferBankName:
                  splitMethod === 'TRANSFERENCIA'
                    ? splitAccount
                      ? getAccountTransferBankName(splitAccount)
                      : split.transferBankName || null
                    : null,
              };
            })
          : [];

      const basePayload = {
        stockConsumptions: [] as StockConsumption[],
        stockReservationDelta: [] as StockConsumption[],
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
        subtotalBeforeDiscountCents: cartTotals.subtotalBeforeDiscountCents,
        discountSubtotalCents: cartTotals.discountSubtotalCents,
        itemsTotalBeforeDiscountCents: cartTotals.itemsTotalBeforeDiscountCents,
        discountTotalCents: cartTotals.discountTotalCents,
        discountPercentBp: resolvedDiscountPercentBp,
        discountSource: resolvedDiscountSource,
        discountMode: resolvedDiscountMode,
        manualDiscountPercentBp: resolvedManualDiscountPercentBp,
        applyLegalTip: resolvedApplyLegalTip,
        legalTipApplied: resolvedApplyLegalTip && resolvedLegalTipCents > 0,
        legalTipPercentBp: resolvedLegalTipPercentBp,
        legalTipBaseCents: resolvedLegalTipBaseCents,
        legalTipCents: resolvedLegalTipCents,
        totalCents: cartTotals.totalCents,
        salePricesIncludeItbis,
        paymentMethod,
        treasuryAccountId: paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null,
        transferBankName: resolvedMainTransferBankName,
        paymentSplits: normalizedPaymentSplits,
        type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
        shippingCents,
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
          shippingCents,
          salePricesIncludeItbis: documentSalePricesIncludeItbis,
          discountPercentBp: resolvedDiscountPercentBp,
        });
        const documentLegalTipBaseCents = documentTotals.subtotalCents;
        const documentLegalTipCents = resolvedApplyLegalTip
          ? calculateLegalTipCents(documentLegalTipBaseCents, resolvedLegalTipPercentBp)
          : 0;
        const documentTotalCents = documentTotals.totalCents + documentLegalTipCents;
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
          subtotalBeforeDiscountCents: documentTotals.subtotalBeforeDiscountCents,
          discountSubtotalCents: documentTotals.discountSubtotalCents,
          itemsTotalBeforeDiscountCents: documentTotals.itemsTotalBeforeDiscountCents,
          discountTotalCents: documentTotals.discountTotalCents,
          discountPercentBp: resolvedDiscountPercentBp,
          discountSource: resolvedDiscountSource,
          discountMode: resolvedDiscountMode,
          manualDiscountPercentBp: resolvedManualDiscountPercentBp,
          applyLegalTip: resolvedApplyLegalTip,
          legalTipApplied: resolvedApplyLegalTip && documentLegalTipCents > 0,
          legalTipPercentBp: resolvedLegalTipPercentBp,
          legalTipBaseCents: documentLegalTipBaseCents,
          legalTipCents: documentLegalTipCents,
          totalCents: documentTotalCents,
          salePricesIncludeItbis: documentSalePricesIncludeItbis,
          editedAt: now,
        };

        reservation = await saleStockService.reserve(items, editingSaleLocalId, async (tx, reserved) => {
          updatedData.stockConsumptions = reserved.consumptions;
          updatedData.stockReservationDelta = reserved.pendingDelta;
          await tx.runAsync('UPDATE sales SET customer_id = ?, treasury_account_id = ?, total_cents = ?, status = ?, synced = 0, data = ? WHERE local_id = ?', [selectedCustomerId, paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null, documentTotalCents, 'completed', JSON.stringify(updatedData), editingSaleLocalId]);
        });
        stockPersisted = true;

        if (paymentMethod === 'CREDITO') {
          await upsertLocalArForCreditSale({
            saleLocalId: editingSaleLocalId,
            invoiceCode: resolvedInvoiceCode,
            createdAt,
            customerId: selectedCustomerId,
            customerName: selectedCustomerName || GENERIC_CUSTOMER_DISPLAY_NAME,
            customerVisualId: selectedCustomerVisualId ?? null,
            totalCents: documentTotalCents,
            dueDate: creditDueDate,
          });
        } else {
          await removeLocalArDraftForSale(editingSaleLocalId);
        }

        await queueSaleUpdateForEdit(editingSaleLocalId, {
          notes: existingData?.notes ?? null,
          stockConsumptions: reservation.consumptions,
          stockReservationDelta: reservation.pendingDelta,
          salePricesIncludeItbis: documentSalePricesIncludeItbis,
          customerId: selectedCustomerId,
          customerVisualId: selectedCustomerVisualId ?? null,
          type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
          paymentMethod,
          treasuryAccountId: paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null,
          transferBankName: resolvedMainTransferBankName,
          paymentSplits: normalizedPaymentSplits,
          discountMode: resolvedDiscountMode,
          manualDiscountPercentBp: resolvedManualDiscountPercentBp,
          applyLegalTip: resolvedApplyLegalTip,
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
            recipeAdjustments: item.recipeAdjustments ?? [],
          })),
          shippingCents,
          status: 'completed',
        });
      } else {
        const saleData = {
          notes: normalizedNotes,
          stockConsumptions: [] as StockConsumption[],
          stockReservationDelta: [] as StockConsumption[],
          localId,
          invoiceCode,
          customerId: selectedCustomerId,
          customerVisualId: selectedCustomerVisualId ?? null,
          customerName: selectedCustomerName,
          items,
          subtotalCents: cartTotals.subtotalCents,
          itbisCents: cartTotals.itbisCents,
          subtotalBeforeDiscountCents: cartTotals.subtotalBeforeDiscountCents,
          discountSubtotalCents: cartTotals.discountSubtotalCents,
          itemsTotalBeforeDiscountCents: cartTotals.itemsTotalBeforeDiscountCents,
          discountTotalCents: cartTotals.discountTotalCents,
          discountPercentBp: resolvedDiscountPercentBp,
          discountSource: resolvedDiscountSource,
          discountMode: resolvedDiscountMode,
          manualDiscountPercentBp: resolvedManualDiscountPercentBp,
          applyLegalTip: resolvedApplyLegalTip,
          legalTipApplied: resolvedApplyLegalTip && resolvedLegalTipCents > 0,
          legalTipPercentBp: resolvedLegalTipPercentBp,
          legalTipBaseCents: resolvedLegalTipBaseCents,
          legalTipCents: resolvedLegalTipCents,
          totalCents: cartTotals.totalCents,
          salePricesIncludeItbis,
          paymentMethod,
          transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
          paymentSplits: paymentMethod === 'DIVIDIR_PAGO' ? paymentSplits : [],
          shippingCents,
          status: 'completed',
          createdAt: now,
          soldAt: now,
        };

        reservation = await saleStockService.reserve(items, null, async (tx, reserved) => {
          saleData.stockConsumptions = reserved.consumptions;
          saleData.stockReservationDelta = reserved.pendingDelta;
          await tx.runAsync('INSERT INTO sales (local_id, invoice_code, customer_id, treasury_account_id, total_cents, status, created_at, synced, data) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)', [localId, invoiceCode, selectedCustomerId, paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null, cartTotals.totalCents, 'completed', now, JSON.stringify(saleData)]);
          if (paymentMethod === 'CREDITO') {
            // La cuenta por cobrar también pertenece al commit de la venta.
            await upsertLocalArForCreditSale({ saleLocalId: localId, invoiceCode, createdAt: now,
              customerId: selectedCustomerId, customerName: selectedCustomerName || GENERIC_CUSTOMER_DISPLAY_NAME,
              customerVisualId: selectedCustomerVisualId ?? null, totalCents: cartTotals.totalCents,
              dueDate: creditDueDate }, tx);
          }
          // El documento y su operación de caja se confirman juntos; no dejar una venta sin pendiente durable.
          await syncService.queueOperationTx(tx, 'sale', 'create', saleData, localId, cashQueueContext);
        });
        stockPersisted = true;
        committedSale = { id: localId, invoiceCode };

        void syncService.kickQueue().catch(error => console.warn('La venta quedó en cola; no se pudo iniciar la sincronización inmediata:', error));

        const syncedSale = await db.queryFirst<{ invoice_code?: string }>(
          'SELECT invoice_code FROM sales WHERE local_id = ?',
          [localId]
        );
        resolvedInvoiceCode = syncedSale?.invoice_code || invoiceCode;

        await saleStockService.refresh();
      }

      const saleTicketPayload = {
        notes: normalizedNotes,
        invoiceCode: resolvedInvoiceCode,
        createdAt,
        customerName: formatCustomerLabel(
          selectedCustomerName || GENERIC_CUSTOMER_DISPLAY_NAME,
          selectedCustomerVisualId
        ),
        paymentMethod,
        transferBankName: resolvedMainTransferBankName,
        paymentSplits: normalizedPaymentSplits,
        type: paymentMethod === 'CREDITO' ? 'CREDITO' : 'CONTADO',
        dueDate: paymentMethod === 'CREDITO' ? creditDueDate : null,
        discountPercentBp: resolvedDiscountPercentBp,
        discountTotalCents: cartTotals.discountTotalCents,
        applyLegalTip: resolvedApplyLegalTip,
        legalTipPercentBp: resolvedLegalTipPercentBp,
        legalTipBaseCents: resolvedLegalTipBaseCents,
        legalTipCents: resolvedLegalTipCents,
        shippingCents,
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
      if (committedSale) {
        // Una falla posterior al commit no convierte la venta en reintentable.
        // Mostrar el recibo evita que el cajero duplique el cobro o el inventario.
        clear();
        clearEditContext();
        Alert.alert('Venta guardada', 'La venta quedó registrada y pendiente de sincronización. Revisa el recibo; no la registres otra vez.');
        navigation.navigate('Receipt', { saleId: committedSale.id, invoiceCode: committedSale.invoiceCode });
        return;
      }
      if (reservation && !stockPersisted) await saleStockService.release(reservation.delta);
      Alert.alert('No se pudo completar la venta', error instanceof Error ? error.message : 'Revisa las existencias e intenta nuevamente.');
    } finally {
      setLoading(false);
      completingSaleRef.current = false;
      useSaleStockStore.setState({ saving: false });
      void saleStockService.refresh(useScreenCart.getState().editingSaleLocalId);
    }
  };

  const cartStockIssue = tutorial ? null : saleStockService.issue(items);

  const renderItem = ({ item, index }: { item: typeof items[0]; index: number }) => {
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
                <Text style={styles.priceEditText}>Editar precio</Text>
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
        <OnboardingTarget id="sale.quantities" visible={tutorial && index === 0} style={styles.quantityContainer}
          reveal={() => itemsListRef.current?.scrollToOffset({ offset: 0, animated: false })}>
          <IconButton
            icon="minus"
            size={20}
            accessibilityLabel={`Reducir cantidad de ${item.productName}`}
            onPress={() => updateQuantity(item.lineId, Math.max(0, Math.round((item.quantity - step) * 100) / 100))}
          />
          <Text style={styles.quantity}>{formatProductQty(item.quantity, item.unit)}</Text>
          <IconButton
            icon="plus"
            size={20}
            accessibilityLabel={`Aumentar cantidad de ${item.productName}`}
            disabled={tutorial && item.quantity >= 10}
            onPress={() => updateQuantity(item.lineId, Math.round((item.quantity + step) * 100) / 100)}
          />
        </OnboardingTarget>
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
      {!tutorial && <CashShiftGate />}
      {items.length > 0 && (loading || (!tutorial && stockSnapshot.saving)) ? (
        <View style={styles.savingIndicator} accessibilityRole="progressbar" accessibilityLabel="Procesando venta">
          <ActivityIndicator color={ui.colors.primary} />
          <Text style={styles.savingText}>Procesando venta...</Text>
        </View>
      ) : cartStockIssue && items.length > 0 ? (
        <Text accessibilityRole="alert" style={{ color: '#DC2626', padding: 12 }}>{cartStockIssue.message}</Text>
      ) : null}
      <FlatList
        ref={itemsListRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.lineId}
        contentContainerStyle={[styles.listContent, { paddingBottom: items.length > 0 ? summaryHeight + 12 : 12 }]}
        ListFooterComponent={!tutorial && items.length > 0 ? (
          <View style={{ marginTop: 12, marginBottom: 12 }}>
            <TextInput
              label="Nota (opcional)"
              value={notes}
              onChangeText={setNotes}
              maxLength={SALE_NOTES_MAX_LENGTH}
              multiline
              numberOfLines={3}
              mode="outlined"
              editable={!editingSaleLocalId}
            />
            <Text style={{ marginTop: 4 }}>Esta nota aparecerá en la factura.</Text>
          </View>
        ) : null}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>El carrito está vacío</Text>
            <OnboardingTarget id="sale.addProducts" visible={tutorial}>
            <Button mode="contained" onPress={() => {
              if (tutorial) {
                useOnboardingStore.getState().go('catalog');
                navigation.navigate('POSMain');
              } else navigation.goBack();
            }}>
              Agregar Productos
            </Button>
            </OnboardingTarget>
          </View>
        }
      />

      {items.length > 0 && (
        <BottomDock onLayout={(event) => setSummaryHeight(event.nativeEvent.layout.height)}>
          <Surface style={styles.summaryCard}>
            {editingSaleLocalId ? (
              <View style={styles.editingBanner}>
                <Text style={styles.editingBannerText}>Editando factura {editingInvoiceCode || '-'}</Text>
              </View>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Cliente:</Text>
              <Button mode="text" disabled={tutorial} onPress={() => navigation.navigate('SelectCustomer')}>
                {formatCustomerLabel(customerName || GENERIC_CUSTOMER_DISPLAY_NAME, customerVisualId)}
              </Button>
            </View>

            {!tutorial && <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Descuento (%):</Text>
              <View style={styles.discountInputWrap}>
                <TextInput
                  value={discountDraft}
                  onChangeText={(value) => {
                    setDiscountDraft(value);
                    if (discountError) setDiscountError(null);
                    if (!canApplyDiscounts) return;
                    applyDiscountDraft(value, true);
                  }}
                  onBlur={() => {
                    if (!canApplyDiscounts) return;
                    if (!applyDiscountDraft(discountDraft, true)) {
                      setDiscountDraft(formatDiscountPercentFromBp(discountPercentBp));
                    }
                  }}
                  mode="outlined"
                  keyboardType="decimal-pad"
                  editable={canApplyDiscounts}
                  style={styles.discountInput}
                  dense
                  outlineColor={ui.colors.border}
                  activeOutlineColor={ui.colors.primary}
                  placeholder="0"
                />
              </View>
            </View>}
            {discountError ? <Text style={styles.discountErrorText}>{discountError}</Text> : null}
            {!tutorial && !canApplyDiscounts ? (
              <Text style={styles.discountReadonlyHint}>No tienes permiso para modificar descuentos.</Text>
            ) : null}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Método de Pago:</Text>
              <Menu
                visible={menuVisible}
                onDismiss={() => setMenuVisible(false)}
                anchor={
                  <Button mode="text" disabled={tutorial} onPress={() => setMenuVisible(true)}>
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

            {!tutorial && (paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA') && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Cuenta de tesorería:</Text>
                <Menu
                  visible={treasuryAccountMenuVisible}
                  onDismiss={() => setTreasuryAccountMenuVisible(false)}
                  anchor={
                    <Button mode="text" compact onPress={() => setTreasuryAccountMenuVisible(true)}>
                      {findTreasuryAccountById(treasuryAccountsByMethod, treasuryAccountId)?.name || 'Seleccionar cuenta'}
                    </Button>
                  }
                >
                  {treasuryAccountsByMethod.map((account) => (
                    <Menu.Item
                      key={account.localId}
                      onPress={() => handleMainTreasuryAccountSelect(account.localId)}
                      title={account.name}
                    />
                  ))}
                  <Menu.Item
                    onPress={() => handleMainTreasuryAccountSelect(TREASURY_CREATE_ACCOUNT_SENTINEL)}
                    title="+ Crear nueva cuenta"
                  />
                </Menu>
              </View>
            )}

            {paymentMethod === 'TRANSFERENCIA' && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Banco:</Text>
                <Text style={[styles.summaryLabel, styles.summaryValue]}>
                  {findTreasuryAccountById(treasuryAccounts, treasuryAccountId)
                    ? getAccountTransferBankName(findTreasuryAccountById(treasuryAccounts, treasuryAccountId) as TreasuryAccount)
                    : transferBankName || 'Seleccionar cuenta banco'}
                </Text>
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
              <Text style={styles.summaryLabel}>
                {formatCurrency(
                  cartTotals.discountSubtotalCents > 0
                    ? cartTotals.subtotalBeforeDiscountCents
                    : cartTotals.subtotalCents
                )}
              </Text>
            </View>
            {cartTotals.discountSubtotalCents > 0 ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Descuento ({(appliedDiscountPercentBp / 100).toFixed(2)}%):</Text>
                <Text style={styles.summaryDiscountValue}>-{formatCurrency(cartTotals.discountSubtotalCents)}</Text>
              </View>
            ) : null}
            {!tutorial && <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Flete:</Text>
              <Button mode="text" compact onPress={openShippingModal}>
                {shippingCents > 0 ? formatCurrency(shippingCents) : 'Agregar'}
              </Button>
            </View>}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>
                ITBIS {salePricesIncludeItbis ? '(incluido)' : '(no incluido)'}:
              </Text>
              <Text style={styles.summaryLabel}>{formatCurrency(cartTotals.itbisCents)}</Text>
            </View>
            {legalTipEnabled && applyLegalTip && cartTotals.legalTipCents > 0 ? (
              <View style={styles.summaryRow}>
                <View style={styles.legalTipLabelWrap}>
                  <Text style={styles.summaryLabel}>Propina legal (10%):</Text>
                  <IconButton
                    icon="close-circle"
                    size={18}
                    iconColor={ui.colors.danger}
                    style={styles.legalTipCloseButton}
                    onPress={() => setApplyLegalTip(false)}
                  />
                </View>
                <Text style={styles.summaryLabel}>{formatCurrency(cartTotals.legalTipCents)}</Text>
              </View>
            ) : null}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total:</Text>
              <SalePrice style={styles.totalValue} cents={cartTotals.totalCents} />
            </View>

            <OnboardingTarget id="sale.complete" visible={tutorial}>
            <Button
              mode="contained"
              buttonColor={ui.colors.primary}
              textColor="#fff"
              labelStyle={styles.completeButtonLabel}
              onPress={handleCompleteSale}
              disabled={loading || (!tutorial && (!!cartStockIssue || !stockSnapshot.ready))}
              loading={loading}
              style={styles.completeButton}
              contentStyle={styles.completeButtonContent}
            >
              {editingSaleLocalId ? 'Guardar Cambios' : 'Completar Venta'}
            </Button>
            </OnboardingTarget>
          </Surface>
        </BottomDock>
      )}

      <Portal>
        <Modal
          visible={shippingModalVisible}
          onDismiss={closeShippingModal}
          contentContainerStyle={styles.priceModalCard}
        >
          <Text style={styles.priceModalTitle}>Agregar flete</Text>
          <Text style={styles.priceModalMeta}>Se sumará al total de la factura.</Text>
          <TextInput
            label="Flete (RD$)"
            value={shippingDraft}
            onChangeText={(value) => {
              setShippingDraft(value);
              if (shippingError) setShippingError(null);
            }}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.priceModalInput}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          {shippingError ? <Text style={styles.priceErrorText}>{shippingError}</Text> : null}
          <View style={styles.priceModalActions}>
            <Button mode="outlined" onPress={closeShippingModal}>
              Cancelar
            </Button>
            <Button mode="contained" buttonColor={ui.colors.primary} onPress={applyShippingChange}>
              Guardar
            </Button>
          </View>
        </Modal>
      </Portal>

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

                {(split.method === 'EFECTIVO' || split.method === 'TRANSFERENCIA') ? (
                  <>
                    <Text style={[styles.summaryLabel, styles.fieldTopMargin]}>Cuenta de tesorería</Text>
                    <Menu
                      visible={splitTreasuryMenuIndex === index}
                      onDismiss={() => setSplitTreasuryMenuIndex(null)}
                      anchor={
                        <Button mode="outlined" onPress={() => setSplitTreasuryMenuIndex(index)}>
                          {findTreasuryAccountById(
                            filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), split.method),
                            split.treasuryAccountId
                          )?.name || 'Seleccionar cuenta'}
                        </Button>
                      }
                    >
                      {filterTreasuryAccountsByMethod(
                        treasuryAccounts.filter((account) => account.isActive),
                        split.method
                      ).map((account) => (
                        <Menu.Item
                          key={`${account.localId}-${index}`}
                          onPress={() => handleSplitTreasuryAccountSelect(index, account.localId)}
                          title={account.name}
                        />
                      ))}
                      <Menu.Item
                        onPress={() => handleSplitTreasuryAccountSelect(index, TREASURY_CREATE_ACCOUNT_SENTINEL)}
                        title="+ Crear nueva cuenta"
                      />
                    </Menu>
                  </>
                ) : null}

                {split.method === 'TRANSFERENCIA' ? (
                  <>
                    <Text style={[styles.summaryLabel, styles.fieldTopMargin]}>Banco</Text>
                    <Text style={styles.summaryLabel}>
                      {findTreasuryAccountById(
                        filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), split.method),
                        split.treasuryAccountId
                      )
                        ? getAccountTransferBankName(
                            findTreasuryAccountById(
                              filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), split.method),
                              split.treasuryAccountId
                            ) as TreasuryAccount
                          )
                        : split.transferBankName || 'Seleccionar cuenta banco'}
                    </Text>
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
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
  },
  savingText: {
    color: ui.colors.textMuted,
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
  summaryValue: {
    textAlign: 'right',
    flexShrink: 1,
  },
  legalTipLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  legalTipCloseButton: {
    margin: 0,
    marginLeft: 2,
  },
  summaryDiscountValue: {
    fontSize: 14,
    color: ui.colors.danger,
    fontWeight: '700',
  },
  discountInputWrap: {
    width: 98,
  },
  discountInput: {
    height: 36,
    backgroundColor: ui.colors.surface,
  },
  discountReadonlyHint: {
    marginTop: -2,
    marginBottom: 8,
    fontSize: 11,
    color: ui.colors.textMuted,
    textAlign: 'right',
  },
  discountErrorText: {
    marginTop: -2,
    marginBottom: 8,
    fontSize: 12,
    color: ui.colors.danger,
    textAlign: 'right',
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
