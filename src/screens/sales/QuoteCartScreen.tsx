import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Surface, Button, IconButton, Divider, Portal, Modal, TextInput, Icon } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuoteCartStore } from '../../store/quoteCartStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency, generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { getBottomSafeInset } from '../../utils/safeArea';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { formatProductQty, unitAllowsDecimals } from '../../utils/productUnits';
import { buildLineId } from '../../store/createCartStore';
import { getSalesSettings } from '../../services/settings/salesSettings';
import { printQuoteTicketDirect } from '../../services/printing/thermalPrinterService';
import { calcDocumentTotalsByTaxMode, normalizeDiscountPercentBp } from '../../utils/tax';
import { formatCustomerLabel, normalizeCustomerVisualId, parseCustomerVisualIdFromData } from '../../utils/customerLabels';

interface QuoteCartScreenProps {
  navigation: any;
  route?: {
    params?: {
      customerId?: string | null;
      customerName?: string | null;
      customerVisualId?: number | null;
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

export function QuoteCartScreen({ navigation, route }: QuoteCartScreenProps) {
  const insets = useSafeAreaInsets();
  const systemBottomInset = getBottomSafeInset(insets.bottom);
  const [loading, setLoading] = useState(false);
  const [recipeDialogLineId, setRecipeDialogLineId] = useState<string | null>(null);
  const [recipeDialogMode, setRecipeDialogMode] = useState<'SIN' | 'EXTRA' | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<Record<string, 'SIN' | 'EXTRA'>>({});
  const [recipeApplyScope, setRecipeApplyScope] = useState<'ONE' | 'ALL'>('ALL');
  const [salePricesIncludeItbis, setSalePricesIncludeItbis] = useState(true);
  const {
    items,
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
    clear,
    setCustomer,
    editingQuoteLocalId,
    editingQuoteServerId,
    editingQuoteCode,
  } = useQuoteCartStore();
  const { subUser } = useAuthStore();
  const canOverridePrice = !!subUser?.isOwner || (subUser as any)?.canOverridePrice === true || subUser?.role === 'ADMIN';
  const canApplyDiscounts = !!subUser?.isOwner || (subUser as any)?.canApplyDiscounts === true || subUser?.role === 'ADMIN';
  const appliedDiscountPercentBp = normalizeDiscountPercentBp(discountPercentBp ?? 0);
  const [discountDraft, setDiscountDraft] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [priceDialogLineId, setPriceDialogLineId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const priceDialogItem = useMemo(
    () => items.find(i => i.lineId === priceDialogLineId),
    [items, priceDialogLineId]
  );
  useFocusEffect(
    useCallback(() => {
      if (editingQuoteLocalId) return;
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
      editingQuoteLocalId,
      route?.params?.customerId,
      route?.params?.customerName,
      route?.params?.customerVisualId,
      setCustomer,
    ])
  );

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
      if (!editingQuoteLocalId) return;
      let active = true;
      const loadDocumentMode = async () => {
        try {
          const quote = await db.queryFirst<{ data?: string }>('SELECT data FROM quotes WHERE local_id = ?', [editingQuoteLocalId]);
          const parsed = quote?.data ? JSON.parse(quote.data) : null;
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
    }, [editingQuoteLocalId])
  );

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

  const quoteTotals = useMemo(
    () =>
      calcDocumentTotalsByTaxMode({
        items: items.map((item) => ({
          quantity: item.quantity,
          priceCents: item.priceCents,
          itbisRateBp: item.itbisRateBp ?? 1800,
        })),
        shippingCents: 0,
        salePricesIncludeItbis,
        discountPercentBp: appliedDiscountPercentBp,
      }),
    [appliedDiscountPercentBp, items, salePricesIncludeItbis]
  );

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
      const { items: currentItems } = useQuoteCartStore.getState();
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
        useQuoteCartStore.setState({ items: nextItems });
      } else {
        if (newLineId !== recipeDialogLineId) {
          const existingTarget = currentItems.find(i => i.lineId === newLineId);
          if (existingTarget) {
            useQuoteCartStore.setState({
              items: currentItems
                .filter(i => i.lineId !== recipeDialogLineId)
                .map(i => i.lineId === newLineId
                  ? { ...i, quantity: i.quantity + cartItem.quantity, totalCents: (i.quantity + cartItem.quantity) * i.priceCents }
                  : i
                ),
            });
          } else {
            useQuoteCartStore.setState({
              items: currentItems.map(item =>
                item.lineId === recipeDialogLineId
                  ? { ...item, lineId: newLineId, recipeAdjustments: adjustments }
                  : item
              ),
            });
          }
        } else {
          useQuoteCartStore.setState({
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

  const handleConfirmQuote = async () => {
    if (items.length === 0) return;

    setLoading(true);
    try {
      if (!applyDiscountDraft(discountDraft, discountWasManual)) {
        Alert.alert('Descuento inválido', 'Corrige el porcentaje de descuento antes de guardar la cotización.');
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

      const now = Date.now();
      const isEditing = !!editingQuoteLocalId;
      const localId = editingQuoteLocalId || generateLocalId();
      const localQuoteCode = editingQuoteCode || `LOCAL-${Date.now()}`;
      let resolvedCustomerVisualId = customerVisualId ?? null;
      if (!resolvedCustomerVisualId && customerId) {
        const customerRow = await db.queryFirst<{ visual_id?: number | null; data?: string | null }>(
          'SELECT visual_id, data FROM customers WHERE local_id = ? OR server_id = ? LIMIT 1',
          [customerId, customerId]
        );
        resolvedCustomerVisualId =
          normalizeCustomerVisualId(customerRow?.visual_id) ??
          parseCustomerVisualIdFromData(customerRow?.data) ??
          null;
      }

      const quoteData = {
        localId,
        id: editingQuoteServerId || undefined,
        quoteCode: localQuoteCode,
        customerId: customerId ?? null,
        customerVisualId: resolvedCustomerVisualId,
        customerName: customerName ?? null,
        items,
        subtotalCents: quoteTotals.subtotalCents,
        itbisCents: quoteTotals.itbisCents,
        subtotalBeforeDiscountCents: quoteTotals.subtotalBeforeDiscountCents,
        discountSubtotalCents: quoteTotals.discountSubtotalCents,
        itemsTotalBeforeDiscountCents: quoteTotals.itemsTotalBeforeDiscountCents,
        discountTotalCents: quoteTotals.discountTotalCents,
        discountPercentBp: resolvedDiscountPercentBp,
        discountSource: resolvedDiscountSource,
        discountMode: resolvedDiscountMode,
        manualDiscountPercentBp: resolvedManualDiscountPercentBp,
        totalCents: quoteTotals.totalCents,
        salePricesIncludeItbis,
        status: 'draft',
        createdAt: now,
      };

      if (isEditing) {
        const existing = await db.queryFirst<{ local_id: string; server_id: string | null; quote_code: string; created_at: number }>(
          'SELECT local_id, server_id, quote_code, created_at FROM quotes WHERE local_id = ?',
          [localId]
        );
        if (!existing) {
          throw new Error('No se encontró la cotización a editar.');
        }

        const updatedQuoteData = {
          ...quoteData,
          quoteCode: existing.quote_code || quoteData.quoteCode,
          createdAt: Number(existing.created_at || quoteData.createdAt),
          id: existing.server_id || quoteData.id || undefined,
        };

        await db.update('quotes', localId, {
          customer_id: updatedQuoteData.customerId,
          total_cents: updatedQuoteData.totalCents,
          status: 'pending',
          synced: 0,
          data: JSON.stringify(updatedQuoteData),
        });

        if (existing.server_id) {
          await syncService.queueOperation(
            'quote',
            'update',
            { ...updatedQuoteData, id: existing.server_id },
            localId
          );
        } else {
          const pendingCreate = await db.queryFirst<{ id: number }>(
            `SELECT id
             FROM sync_queue
             WHERE entity_type = 'quote'
               AND entity_local_id = ?
               AND action = 'create'
               AND status = 'pending'
             ORDER BY created_at DESC
             LIMIT 1`,
            [localId]
          );
          if (pendingCreate?.id) {
            await db.update(
              'sync_queue',
              String(pendingCreate.id),
              { data: JSON.stringify(updatedQuoteData), created_at: Date.now() },
              'id'
            );
          } else {
            await syncService.queueOperation('quote', 'create', updatedQuoteData, localId);
          }
        }
      } else {
        await db.insert('quotes', {
          local_id: localId,
          quote_code: localQuoteCode,
          customer_id: quoteData.customerId,
          total_cents: quoteData.totalCents,
          status: 'pending',
          created_at: now,
          synced: 0,
          data: JSON.stringify(quoteData),
        });

        await syncService.queueOperation('quote', 'create', quoteData, localId);
      }

      const printResult = await printQuoteTicketDirect({
        quoteCode: localQuoteCode,
        createdAt: quoteData.createdAt,
        customerName: formatCustomerLabel(quoteData.customerName || 'Cliente general', quoteData.customerVisualId),
        totalCents: quoteData.totalCents,
        salePricesIncludeItbis: quoteData.salePricesIncludeItbis,
        discountPercentBp: resolvedDiscountPercentBp,
        discountTotalCents: quoteTotals.discountTotalCents,
        items: quoteData.items.map((item: any) => ({
          productName: String(item.productName || 'Producto'),
          quantity: Number(item.quantity || 0),
          priceCents: Number(item.priceCents || item.unitPriceCents || 0),
          totalCents: calcDocumentTotalsByTaxMode({
            items: [{ quantity: Number(item.quantity || 0), priceCents: Number(item.priceCents || item.unitPriceCents || 0), itbisRateBp: Number(item.itbisRateBp || 1800) }],
            shippingCents: 0,
            salePricesIncludeItbis,
          }).totalCents,
          unit: item.unit || 'UNIDAD',
          reference: String(item.reference || item.sku || '').trim() || null,
          productId: String(item.productId || '').trim() || null,
          sku: String(item.sku || '').trim() || null,
        })),
      });

      if (!printResult.printed && printResult.reason === 'missing_native_module') {
        Alert.alert(
          'Impresion',
          'No se encontro soporte de impresora termica Bluetooth en esta app. Instala el modulo nativo y genera un nuevo build.'
        );
      }

      clear();
      navigation.goBack();
    } catch (error) {
      console.error('Error guardando cotización:', error);
      Alert.alert('Error', 'No se pudo guardar la cotización');
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: typeof items[0] }) => {
    const step = unitAllowsDecimals(item.unit) ? 0.5 : 1;
    const adjustments = item.recipeAdjustments ?? [];
    const hasRecipeItems = Array.isArray(item.recipeItems) && item.recipeItems.length > 0;

    return (
      <Surface style={styles.itemCard}>
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={2}>
            {item.productName}
          </Text>
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
          <IconButton icon="delete" size={20} iconColor={ui.colors.danger} onPress={() => removeItem(item.lineId)} />
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
            <Text style={styles.emptyText}>La cotización está vacía</Text>
            <Button mode="contained" onPress={() => navigation.goBack()}>
              Agregar Productos
            </Button>
          </View>
        }
      />

      {items.length > 0 && (
        <BottomDock>
          <Surface style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Cliente:</Text>
            <Button mode="text" onPress={() => navigation.navigate('SelectQuoteCustomer')}>
              {formatCustomerLabel(customerName || 'Cliente general', customerVisualId)}
            </Button>
          </View>

          <View style={styles.summaryRow}>
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
          </View>
          {discountError ? <Text style={styles.discountErrorText}>{discountError}</Text> : null}
          {!canApplyDiscounts ? (
            <Text style={styles.discountReadonlyHint}>No tienes permiso para modificar descuentos.</Text>
          ) : null}

          <Divider style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal:</Text>
            <Text style={styles.summaryLabel}>
              {formatCurrency(
                quoteTotals.discountSubtotalCents > 0
                  ? quoteTotals.subtotalBeforeDiscountCents
                  : quoteTotals.subtotalCents
              )}
            </Text>
          </View>
          {quoteTotals.discountSubtotalCents > 0 ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Descuento ({(appliedDiscountPercentBp / 100).toFixed(2)}%):</Text>
              <Text style={styles.summaryDiscountValue}>-{formatCurrency(quoteTotals.discountSubtotalCents)}</Text>
            </View>
          ) : null}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              ITBIS {salePricesIncludeItbis ? '(incluido)' : '(no incluido)'}:
            </Text>
            <Text style={styles.summaryLabel}>{formatCurrency(quoteTotals.itbisCents)}</Text>
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{formatCurrency(quoteTotals.totalCents)}</Text>
          </View>

          <Button
            mode="contained"
            buttonColor={ui.colors.primary}
            textColor="#fff"
            labelStyle={styles.completeButtonLabel}
            onPress={handleConfirmQuote}
            loading={loading}
            disabled={loading}
            style={styles.completeButton}
            contentStyle={styles.completeButtonContent}
          >
            {editingQuoteLocalId ? 'Guardar cambios' : 'Confirmar Cotización'}
          </Button>

          <Button mode="text" onPress={clear}>
            Limpiar cotización
          </Button>
          </Surface>
        </BottomDock>
      )}

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
    paddingBottom: 250,
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
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: ui.colors.text,
  },
  itemPrice: {
    fontSize: 12,
    color: ui.colors.textMuted,
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
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
    marginHorizontal: 8,
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
    marginBottom: 6,
  },
  completeButtonContent: {
    paddingVertical: 8,
  },
  completeButtonLabel: {
    fontSize: 18,
    fontWeight: '800',
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
  systemBottomBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
  },
});
