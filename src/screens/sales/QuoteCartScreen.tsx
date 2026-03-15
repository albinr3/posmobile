import React, { useCallback, useState } from 'react';
import { View, StyleSheet, FlatList, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { Text, Surface, Button, IconButton, Divider, Portal, Modal, Icon } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { useQuoteCartStore } from '../../store/quoteCartStore';
import { formatCurrency, generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { getBottomSafeInset } from '../../utils/safeArea';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { Asset } from 'expo-asset';
import { formatProductQty, unitAllowsDecimals } from '../../utils/productUnits';
import { buildLineId } from '../../store/createCartStore';
import { getSalesSettings } from '../../services/settings/salesSettings';

interface QuoteCartScreenProps {
  navigation: any;
  route?: {
    params?: {
      customerId?: string | null;
      customerName?: string | null;
    };
  };
}

const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('es-DO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export function QuoteCartScreen({ navigation, route }: QuoteCartScreenProps) {
  const insets = useSafeAreaInsets();
  const systemBottomInset = getBottomSafeInset(insets.bottom);
  const [loading, setLoading] = useState(false);
  const [recipeDialogLineId, setRecipeDialogLineId] = useState<string | null>(null);
  const [recipeDialogMode, setRecipeDialogMode] = useState<'SIN' | 'EXTRA' | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<Record<string, 'SIN' | 'EXTRA'>>({});
  const [recipeApplyScope, setRecipeApplyScope] = useState<'ONE' | 'ALL'>('ALL');
  const [showItbisBreakdown, setShowItbisBreakdown] = useState(true);
  const {
    items,
    updateQuantity,
    removeItem,
    getTotal,
    customerId,
    customerName,
    clear,
    setCustomer,
    editingQuoteLocalId,
    editingQuoteServerId,
    editingQuoteCode,
  } = useQuoteCartStore();
  const logoUri = Asset.fromModule(require('../../../assets/movoLogoDark.png')).uri;

  useFocusEffect(
    useCallback(() => {
      const routeCustomerId = route?.params?.customerId;
      const routeCustomerName = route?.params?.customerName;

      if (typeof routeCustomerId !== 'undefined' || typeof routeCustomerName !== 'undefined') {
        setCustomer(routeCustomerId ?? null, routeCustomerName ?? null);
      }
    }, [route?.params?.customerId, route?.params?.customerName, setCustomer])
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

  const handleConfirmQuote = async () => {
    if (items.length === 0) return;

    setLoading(true);
    try {
      const now = Date.now();
      const isEditing = !!editingQuoteLocalId;
      const localId = editingQuoteLocalId || generateLocalId();
      const localQuoteCode = editingQuoteCode || `LOCAL-${Date.now()}`;

      const quoteData = {
        localId,
        id: editingQuoteServerId || undefined,
        quoteCode: localQuoteCode,
        customerId: customerId ?? null,
        customerName: customerName ?? null,
        items,
        totalCents: getTotal(),
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
          total_cents: getTotal(),
          status: 'pending',
          created_at: now,
          synced: 0,
          data: JSON.stringify(quoteData),
        });

        await syncService.queueOperation('quote', 'create', quoteData, localId);
      }

      const itemsRows = quoteData.items
        .map(
          (item: any) => `
            <tr>
              <td>${escapeHtml(item.productName)}</td>
              <td style="text-align:center;">—</td>
              <td style="text-align:center;">—</td>
              <td style="text-align:center;">${formatProductQty(item.quantity, item.unit)}</td>
              <td style="text-align:right;">${formatCurrency(item.priceCents)}</td>
              <td style="text-align:right;">${formatCurrency(item.totalCents)}</td>
            </tr>
          `
        )
        .join('');

      const subtotalCents = Math.round(quoteData.totalCents / 1.18);
      const itbisCents = quoteData.totalCents - subtotalCents;
      const taxRows = showItbisBreakdown
        ? `<div class="line"><span>Subtotal</span><span>${formatCurrency(subtotalCents)}</span></div>
                <div class="line"><span>ITBIS (18% incluido)</span><span>${formatCurrency(itbisCents)}</span></div>`
        : '';

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111827; padding: 18px; }
              .top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; }
              .biz { font-size:20px; font-weight:800; }
              .doc { text-align:right; }
              .doc-title { font-size:22px; font-weight:800; }
              .meta { font-size:12px; color:#374151; margin-top:2px; }
              .card { border:1px solid #E5E7EB; border-radius:8px; padding:10px; margin-bottom:12px; font-size:12px; }
              table { width:100%; border-collapse:collapse; margin-top:8px; }
              th, td { border-bottom: 1px solid #E5E7EB; padding: 7px 6px; font-size: 12px; }
              th { background: #F9FAFB; text-align: left; }
              .grid { margin-top:14px; display:flex; justify-content:flex-end; }
              .totals { width:320px; border:1px solid #E5E7EB; border-radius:8px; padding:10px; }
              .line { display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px; }
              .total { display:flex; justify-content:space-between; border-top:1px solid #E5E7EB; padding-top:8px; margin-top:8px; font-size:16px; font-weight:800; }
            </style>
          </head>
          <body>
            <div class="top">
              <div><img src="${escapeHtml(logoUri)}" style="height:42px; width:auto;" /></div>
              <div class="doc">
                <div class="doc-title">COTIZACION</div>
                <div class="meta"><strong>No:</strong> ${escapeHtml(localQuoteCode)}</div>
                <div class="meta"><strong>Fecha:</strong> ${escapeHtml(formatDateTime(now))}</div>
              </div>
            </div>
            <div class="card"><strong>Cliente:</strong> ${escapeHtml(quoteData.customerName || '(General) Cliente general')}</div>
            <table>
              <thead>
                <tr>
                  <th>Descripcion</th>
                  <th style="text-align:center;">Codigo</th>
                  <th style="text-align:center;">Referencia</th>
                  <th style="text-align:center;">Cant.</th>
                  <th style="text-align:right;">Precio</th>
                  <th style="text-align:right;">Importe</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
            <div class="grid">
              <div class="totals">
                ${taxRows}
                <div class="total"><span>Total</span><span>${formatCurrency(quoteData.totalCents)}</span></div>
              </div>
            </div>
          </body>
        </html>
      `;

      await Print.printAsync({ html });

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
          <Text style={styles.itemPrice}>{formatCurrency(item.priceCents)} c/u</Text>
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
              {customerName || '(General) Cliente general'}
            </Button>
          </View>

          <Divider style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>{formatCurrency(getTotal())}</Text>
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
  systemBottomBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
  },
});
