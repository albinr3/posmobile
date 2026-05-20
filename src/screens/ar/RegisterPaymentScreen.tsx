import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Surface, Divider, Icon, Menu } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId, generateReceiptCode, formatCurrency } from '../../utils/helpers';
import { AccountReceivable, TreasuryAccount } from '../../types';
import { ui } from '../../theme/ui';
import { DOMINICAN_BANKS } from '../../constants/dominicanBanks';
import { hasConnectedPrinter, printPaymentReceiptDirect } from '../../services/printing/thermalPrinterService';
import { listTreasuryAccounts, getAccountTransferBankName } from '../../services/treasury/treasuryService';
import { filterTreasuryAccountsByMethod, findTreasuryAccountById } from '../../utils/treasury';
import { useTreasuryUIStore } from '../../store/treasuryUIStore';
import {
  formatCustomerLabel,
  GENERIC_CUSTOMER_DISPLAY_NAME,
  normalizeCustomerVisualId,
  parseCustomerVisualIdFromData,
} from '../../utils/customerLabels';

interface RegisterPaymentScreenProps {
  navigation: any;
  route?: {
    params?: {
      arId?: string;
      arIds?: string[];
    };
  };
}

export function RegisterPaymentScreen({ navigation, route }: RegisterPaymentScreenProps) {
  const arId = route?.params?.arId || '';
  const arIdsParam = Array.isArray(route?.params?.arIds) ? route?.params?.arIds : [];
  const targetArIds = arIdsParam.length > 0 ? arIdsParam : arId ? [arId] : [];
  const [arItems, setARItems] = useState<AccountReceivable[]>([]);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
  const [transferBankName, setTransferBankName] = useState<string | null>(null);
  const [bankMenuVisible, setBankMenuVisible] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([]);
  const [treasuryAccountId, setTreasuryAccountId] = useState<string | null>(null);
  const [treasuryMenuVisible, setTreasuryMenuVisible] = useState(false);
  const requestCreateAccountModal = useTreasuryUIStore((state) => state.requestCreateAccountModal);
  const consumeLastCreatedAccountId = useTreasuryUIStore((state) => state.consumeLastCreatedAccountId);

  const paymentOptions = [
    { value: 'EFECTIVO', label: 'Efectivo', icon: 'cash' },
    { value: 'TRANSFERENCIA', label: 'Transferencia', icon: 'bank-transfer' },
    { value: 'TARJETA', label: 'Tarjeta', icon: 'credit-card-outline' },
    { value: 'CHEQUE', label: 'Cheque', icon: 'file-document-outline' },
  ];

  useEffect(() => {
    loadARItems();
    loadTreasuryAccounts();
  }, []);

  useEffect(() => {
    const created = consumeLastCreatedAccountId();
    if (!created) return;
    setTreasuryAccountId(created);
  }, [consumeLastCreatedAccountId]);

  const loadTreasuryAccounts = async () => {
    try {
      const rows = await listTreasuryAccounts(false);
      setTreasuryAccounts(rows);
    } catch {
      setTreasuryAccounts([]);
    }
  };

  const loadARItems = async () => {
    if (!targetArIds.length) return;
    try {
      const placeholders = targetArIds.map(() => '?').join(', ');
      const result = await db.query<any>(
        `SELECT * FROM accounts_receivable WHERE local_id IN (${placeholders}) ORDER BY due_date ASC, rowid ASC`,
        targetArIds
      );
      const mapped = result.map((row) => ({
          localId: row.local_id,
          serverId: row.server_id,
          customerId: row.customer_id,
          customerVisualId:
            normalizeCustomerVisualId(row.customer_visual_id) ??
            parseCustomerVisualIdFromData(row.data) ??
            null,
          customerName: row.customer_name,
          totalCents: row.total_cents,
          paidCents: row.paid_cents,
          balanceCents: row.balance_cents,
          status: row.status,
          dueDate: row.due_date,
          synced: row.synced === 1,
          data: row.data,
        } as AccountReceivable));
      setARItems(mapped);
    } catch (error) {
      console.error('Error cargando cuenta:', error);
    }
  };

  const isBatch = arItems.length > 1;
  const firstItem = arItems[0] || null;
  const totalPendingCents = arItems.reduce((sum, item) => sum + item.balanceCents, 0);

  useEffect(() => {
    if (!treasuryAccounts.length) return;
    const allowed = filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), paymentMethod);
    const selected = findTreasuryAccountById(allowed, treasuryAccountId);
    if (!selected) {
      setTreasuryAccountId(allowed[0]?.localId || null);
      if (paymentMethod === 'TRANSFERENCIA' && allowed[0]) {
        setTransferBankName(getAccountTransferBankName(allowed[0]));
      }
    }
  }, [paymentMethod, treasuryAccountId, treasuryAccounts]);

  const getInvoiceCode = (item: AccountReceivable): string | null => {
    try {
      const parsed = item?.data ? JSON.parse(item.data) : null;
      return String(parsed?.sale?.invoiceCode || parsed?.invoiceCode || '').trim() || null;
    } catch {
      return null;
    }
  };

  const handlePayFull = () => {
    setAmount((totalPendingCents / 100).toFixed(2));
  };

  const handleSave = async () => {
    if (!arItems.length) return;
    
    const amountCents = Math.round(parseFloat(amount) * 100);
    
    if (!amount || isNaN(amountCents) || amountCents <= 0) {
      Alert.alert('Error', 'Ingrese un monto válido');
      return;
    }

    if (amountCents > totalPendingCents) {
      Alert.alert('Error', 'El monto no puede ser mayor al balance pendiente');
      return;
    }

    if (paymentMethod === 'TRANSFERENCIA' && !transferBankName) {
      Alert.alert('Error', 'Debes seleccionar el banco de la transferencia');
      return;
    }

    if ((paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA') && !treasuryAccountId) {
      Alert.alert('Error', 'Debes seleccionar cuenta de tesorería');
      return;
    }

    setLoading(true);
    try {
      const receiptCode = generateReceiptCode();
      const now = Date.now();
      const batchLocalId = generateLocalId();
      let remaining = Math.min(amountCents, totalPendingCents);
      const sortedItems = [...arItems].sort((a, b) => {
        const aDue = Number(a.dueDate || 0);
        const bDue = Number(b.dueDate || 0);
        if (aDue !== bDue) return aDue - bDue;
        return String(a.localId).localeCompare(String(b.localId));
      });
      const createdLocalPaymentIds: string[] = [];
      let appliedTotal = 0;
      let firstInvoiceCode: string | null = null;
      let lastBalanceAfterCents: number | null = null;

      for (const item of sortedItems) {
        if (remaining <= 0) break;
        const appliedCents = Math.min(remaining, item.balanceCents);
        remaining -= appliedCents;
        appliedTotal += appliedCents;

        const localId = generateLocalId();
        const invoiceCode = getInvoiceCode(item);
        if (!firstInvoiceCode && invoiceCode) firstInvoiceCode = invoiceCode;

        const newPaidCents = item.paidCents + appliedCents;
        const newBalanceCents = item.totalCents - newPaidCents;
        const newStatus = newBalanceCents <= 0 ? 'PAGADO' : newPaidCents > 0 ? 'PARCIAL' : 'PENDIENTE';
        lastBalanceAfterCents = newBalanceCents;

        const paymentDataWithBalance = {
          localId,
          receiptCode,
          arId: item.localId,
          arServerId: item.serverId,
          customerId: item.customerId,
          customerVisualId: item.customerVisualId ?? null,
          customerName: item.customerName,
          invoiceCode,
          amountCents: appliedCents,
          paymentMethod,
          treasuryAccountId: paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null,
          transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          createdAt: now,
          balanceAfterCents: newBalanceCents,
          batchPayment: isBatch,
          batchLocalId,
        };

        await db.insert('payments', {
          local_id: localId,
          receipt_code: receiptCode,
          amount_cents: appliedCents,
          ar_id: item.localId,
          synced: 0,
          treasury_account_id: paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null,
          data: JSON.stringify(paymentDataWithBalance),
        });

        await db.update('accounts_receivable', item.localId, {
          paid_cents: newPaidCents,
          balance_cents: newBalanceCents,
          status: newStatus,
        });

        createdLocalPaymentIds.push(localId);
      }

      if (isBatch) {
        await syncService.queueOperation(
          'payment_batch',
          'create',
          {
            arIds: sortedItems.map((item) => item.localId),
            amountCents: appliedTotal,
            method: paymentMethod,
            treasuryAccountId: paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null,
            transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
            note: notes.trim() || null,
            localPaymentIds: createdLocalPaymentIds,
            localReceiptCode: receiptCode,
          },
          batchLocalId
        );
      } else {
        const singlePaymentId = createdLocalPaymentIds[0];
        const item = sortedItems[0];
        const paymentDataWithBalance = {
          localId: singlePaymentId,
          receiptCode,
          arId: item.localId,
          arServerId: item.serverId,
          customerId: item.customerId,
          customerVisualId: item.customerVisualId ?? null,
          customerName: item.customerName,
          invoiceCode: getInvoiceCode(item),
          amountCents: appliedTotal,
          paymentMethod,
          treasuryAccountId: paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA' ? treasuryAccountId : null,
          transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          createdAt: now,
          balanceAfterCents: lastBalanceAfterCents,
        };
        await syncService.queueOperation('payment', 'create', paymentDataWithBalance, singlePaymentId);
      }

      let printNotice = '';
      try {
        const shouldAttemptPrint = await hasConnectedPrinter();
        if (shouldAttemptPrint) {
          const printResult = await printPaymentReceiptDirect({
            receiptCode,
            createdAt: now,
            customerName: formatCustomerLabel(
              firstItem?.customerName || GENERIC_CUSTOMER_DISPLAY_NAME,
              firstItem?.customerVisualId
            ),
            invoiceCode: isBatch ? `${createdLocalPaymentIds.length} facturas` : firstInvoiceCode,
            paymentMethod,
            transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
            amountCents: appliedTotal,
            balanceAfterCents: lastBalanceAfterCents,
            cancelledAt: null,
          });

          if (!printResult.printed) {
            if (printResult.reason === 'missing_config') {
              printNotice = '\n\nPago guardado, pero no hay impresora térmica conectada.';
            } else if (printResult.reason === 'missing_native_module') {
              printNotice = '\n\nPago guardado, pero esta app no tiene soporte nativo para impresora térmica.';
            } else {
              printNotice = `\n\nPago guardado, pero no se pudo imprimir: ${printResult.message || 'error de impresión'}.`;
            }
          }
        }
      } catch {
        printNotice = '\n\nPago guardado, pero no se pudo imprimir el recibo.';
      }

      Alert.alert('Éxito', `Pago de ${formatCurrency(appliedTotal)} registrado\nRecibo: ${receiptCode}${printNotice}`, [
        { text: 'OK', onPress: () => navigation.navigate('ARList', { clearSelection: true }) }
      ]);
    } catch (error) {
      console.error('Error guardando pago:', error);
      Alert.alert('Error', 'No se pudo registrar el pago');
    } finally {
      setLoading(false);
    }
  };

  if (!firstItem) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Cargando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 96 }]}>
        <Surface style={styles.summaryCard}>
          <Text style={styles.customerName}>
            {formatCustomerLabel(firstItem.customerName, firstItem.customerVisualId)}
            {isBatch ? ` (${arItems.length} facturas)` : ''}
          </Text>
          <Divider style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Factura:</Text>
            <Text style={styles.summaryValue}>{formatCurrency(isBatch ? arItems.reduce((sum, item) => sum + item.totalCents, 0) : firstItem.totalCents)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Ya Pagado:</Text>
            <Text style={styles.summaryValue}>{formatCurrency(isBatch ? arItems.reduce((sum, item) => sum + item.paidCents, 0) : firstItem.paidCents)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Balance Pendiente:</Text>
            <Text style={styles.balanceValue}>{formatCurrency(totalPendingCents)}</Text>
          </View>
          {isBatch && (
            <View style={styles.batchInvoicesWrap}>
              {arItems.map((item) => (
                <View key={item.localId} style={styles.batchInvoiceRow}>
                  <Text style={styles.batchInvoiceCode}>{getInvoiceCode(item) || item.localId.slice(-6)}</Text>
                  <Text style={styles.batchInvoiceAmount}>{formatCurrency(item.balanceCents)}</Text>
                </View>
              ))}
            </View>
          )}
        </Surface>

        <Surface style={styles.formSection}>
          <Text style={styles.sectionTitle}>Monto del Pago</Text>
          
          <TextInput
            label="Monto (RD$)"
            value={amount}
            onChangeText={setAmount}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            left={<TextInput.Affix text="RD$ " />}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

          <Button mode="outlined" onPress={handlePayFull} style={styles.fullPayButton} textColor={ui.colors.primary}>
            Pagar Total ({formatCurrency(totalPendingCents)})
          </Button>
        </Surface>

        <Surface style={styles.formSection}>
          <Text style={styles.sectionTitle}>Método de Pago</Text>

          <View style={styles.paymentGrid}>
            {paymentOptions.map((option) => {
              const selected = paymentMethod === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.paymentCard, selected && styles.paymentCardSelected]}
                  onPress={() => {
                    setPaymentMethod(option.value);
                    if (option.value !== 'TRANSFERENCIA') {
                      setTransferBankName(null);
                    }
                    const allowed = filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), option.value);
                    const selected = findTreasuryAccountById(allowed, treasuryAccountId);
                    setTreasuryAccountId(selected?.localId || allowed[0]?.localId || null);
                    if (option.value === 'TRANSFERENCIA') {
                      const transferAccount = selected || allowed[0] || null;
                      if (transferAccount) {
                        setTransferBankName(getAccountTransferBankName(transferAccount));
                      }
                    }
                  }}
                  activeOpacity={0.9}
                >
                  <View style={[styles.paymentIconWrap, selected && styles.paymentIconWrapSelected]}>
                    <Icon source={option.icon} size={26} color={selected ? '#fff' : ui.colors.primary} />
                  </View>
                  <Text style={[styles.paymentLabel, selected && styles.paymentLabelSelected]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA') && (
            <View style={styles.bankSelectorWrap}>
              <Text style={styles.summaryLabel}>Cuenta de tesorería</Text>
              <Menu
                visible={treasuryMenuVisible}
                onDismiss={() => setTreasuryMenuVisible(false)}
                anchor={
                  <Button mode="outlined" onPress={() => setTreasuryMenuVisible(true)} textColor={ui.colors.primary}>
                    {findTreasuryAccountById(
                      filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), paymentMethod),
                      treasuryAccountId
                    )?.name || 'Seleccionar cuenta'}
                  </Button>
                }
              >
                {filterTreasuryAccountsByMethod(
                  treasuryAccounts.filter((account) => account.isActive),
                  paymentMethod
                ).map((account) => (
                  <Menu.Item
                    key={account.localId}
                    onPress={() => {
                      setTreasuryAccountId(account.localId);
                      if (paymentMethod === 'TRANSFERENCIA') {
                        setTransferBankName(getAccountTransferBankName(account));
                      }
                      setTreasuryMenuVisible(false);
                    }}
                    title={account.name}
                  />
                ))}
                <Menu.Item
                  onPress={() => {
                    requestCreateAccountModal(paymentMethod === 'EFECTIVO' ? 'CAJA' : 'BANCO');
                    setTreasuryMenuVisible(false);
                    navigation.navigate('TreasuryMenu', { screen: 'Treasury' });
                  }}
                  title="+ Crear nueva cuenta"
                />
              </Menu>
            </View>
          )}

          {paymentMethod === 'TRANSFERENCIA' && (
            <View style={styles.bankSelectorWrap}>
              <Text style={styles.summaryLabel}>Banco</Text>
              <Menu
                visible={bankMenuVisible}
                onDismiss={() => setBankMenuVisible(false)}
                anchor={
                  <Button mode="outlined" onPress={() => setBankMenuVisible(true)} textColor={ui.colors.primary}>
                    {transferBankName || 'Seleccionar banco'}
                  </Button>
                }
              >
                {DOMINICAN_BANKS.map((bankName) => (
                  <Menu.Item
                    key={bankName}
                    onPress={() => {
                      setTransferBankName(bankName);
                      setBankMenuVisible(false);
                    }}
                    title={bankName}
                  />
                ))}
              </Menu>
            </View>
          )}

          {(paymentMethod === 'TRANSFERENCIA' || paymentMethod === 'CHEQUE') && (
            <TextInput
              label="Número de Referencia"
              value={reference}
              onChangeText={setReference}
              mode="outlined"
              style={styles.input}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
          )}
        </Surface>

        <Surface style={styles.formSection}>
          <TextInput
            label="Notas (opcional)"
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
        </Surface>

      </ScrollView>

      <BottomDock style={styles.stickyFooter}>
        <Button
          mode="contained"
          buttonColor={ui.colors.primary}
          textColor="#fff"
          labelStyle={styles.saveButtonLabel}
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          Registrar Pago
        </Button>
      </BottomDock>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 12,
  },
  summaryCard: {
    padding: 16,
    borderRadius: ui.radius.lg,
    marginBottom: 12,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    elevation: 1,
  },
  customerName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    color: ui.colors.text,
  },
  divider: {
    marginBottom: 12,
    backgroundColor: ui.colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: ui.colors.textMuted,
  },
  summaryValue: {
    fontSize: 14,
    color: ui.colors.text,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: ui.colors.primary,
  },
  batchInvoicesWrap: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    paddingTop: 8,
    gap: 4,
  },
  batchInvoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  batchInvoiceCode: {
    fontSize: 12,
    color: ui.colors.textMuted,
    fontWeight: '700',
  },
  batchInvoiceAmount: {
    fontSize: 12,
    color: ui.colors.text,
    fontWeight: '700',
  },
  formSection: {
    padding: 16,
    borderRadius: ui.radius.lg,
    marginBottom: 12,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: ui.colors.text,
  },
  input: {
    marginBottom: 12,
    backgroundColor: ui.colors.surface,
  },
  paymentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  bankSelectorWrap: {
    marginBottom: 12,
  },
  paymentCard: {
    width: '48%',
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#F7F5FB',
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentCardSelected: {
    borderColor: ui.colors.primary,
    backgroundColor: '#EFE6FF',
  },
  paymentIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E9D5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  paymentIconWrapSelected: {
    backgroundColor: ui.colors.primary,
  },
  paymentLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: ui.colors.text,
  },
  paymentLabelSelected: {
    color: ui.colors.primary,
  },
  fullPayButton: {
    marginTop: 4,
    borderRadius: ui.radius.md,
  },
  saveButton: {
    borderRadius: ui.radius.md,
  },
  saveButtonContent: {
    height: 50,
  },
  saveButtonLabel: {
    fontSize: 16,
    fontWeight: '800',
  },
  stickyFooter: {
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 0,
  },
});
