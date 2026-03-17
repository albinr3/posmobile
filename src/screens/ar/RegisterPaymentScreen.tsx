import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Surface, Divider, Icon, Menu } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId, generateReceiptCode, formatCurrency } from '../../utils/helpers';
import { AccountReceivable } from '../../types';
import { ui } from '../../theme/ui';
import { DOMINICAN_BANKS } from '../../constants/dominicanBanks';
import { hasConnectedPrinter, printPaymentReceiptDirect } from '../../services/printing/thermalPrinterService';

interface RegisterPaymentScreenProps {
  navigation: any;
  route?: {
    params?: {
      arId?: string;
    };
  };
}

export function RegisterPaymentScreen({ navigation, route }: RegisterPaymentScreenProps) {
  const arId = route?.params?.arId || '';
  const [arItem, setARItem] = useState<AccountReceivable | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
  const [transferBankName, setTransferBankName] = useState<string | null>(null);
  const [bankMenuVisible, setBankMenuVisible] = useState(false);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const paymentOptions = [
    { value: 'EFECTIVO', label: 'Efectivo', icon: 'cash' },
    { value: 'TRANSFERENCIA', label: 'Transferencia', icon: 'bank-transfer' },
    { value: 'TARJETA', label: 'Tarjeta', icon: 'credit-card-outline' },
    { value: 'CHEQUE', label: 'Cheque', icon: 'file-document-outline' },
  ];

  useEffect(() => {
    loadARItem();
  }, []);

  const loadARItem = async () => {
    try {
      const result = await db.queryFirst<any>(
        'SELECT * FROM accounts_receivable WHERE local_id = ?',
        [arId]
      );
      if (result) {
        setARItem({
          localId: result.local_id,
          serverId: result.server_id,
          customerId: result.customer_id,
          customerName: result.customer_name,
          totalCents: result.total_cents,
          paidCents: result.paid_cents,
          balanceCents: result.balance_cents,
          status: result.status,
          dueDate: result.due_date,
          synced: result.synced === 1,
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error cargando cuenta:', error);
    }
  };

  const handlePayFull = () => {
    if (arItem) {
      setAmount((arItem.balanceCents / 100).toFixed(2));
    }
  };

  const handleSave = async () => {
    if (!arItem) return;
    
    const amountCents = Math.round(parseFloat(amount) * 100);
    
    if (!amount || isNaN(amountCents) || amountCents <= 0) {
      Alert.alert('Error', 'Ingrese un monto válido');
      return;
    }

    if (amountCents > arItem.balanceCents) {
      Alert.alert('Error', 'El monto no puede ser mayor al balance pendiente');
      return;
    }

    if (paymentMethod === 'TRANSFERENCIA' && !transferBankName) {
      Alert.alert('Error', 'Debes seleccionar el banco de la transferencia');
      return;
    }

    setLoading(true);
    try {
      const localId = generateLocalId();
      const receiptCode = generateReceiptCode();
      const now = Date.now();
      let invoiceCode: string | null = null;
      try {
        const parsedArData = arItem?.data ? JSON.parse(arItem.data) : null;
        invoiceCode = String(parsedArData?.sale?.invoiceCode || parsedArData?.invoiceCode || '').trim() || null;
      } catch {
        invoiceCode = null;
      }

      const paymentData = {
        localId,
        receiptCode,
        arId: arItem.localId,
        arServerId: arItem.serverId,
        customerId: arItem.customerId,
        customerName: arItem.customerName,
        invoiceCode,
        amountCents,
        paymentMethod,
        transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        createdAt: now,
      };

      // Actualizar cuenta por cobrar
      const newPaidCents = arItem.paidCents + amountCents;
      const newBalanceCents = arItem.totalCents - newPaidCents;
      const newStatus = newBalanceCents <= 0 ? 'PAGADO' : newPaidCents > 0 ? 'PARCIAL' : 'PENDIENTE';

      const paymentDataWithBalance = {
        ...paymentData,
        balanceAfterCents: newBalanceCents,
      };

      // Guardar pago en SQLite
      await db.insert('payments', {
        local_id: localId,
        receipt_code: receiptCode,
        amount_cents: amountCents,
        ar_id: arItem.localId,
        synced: 0,
        data: JSON.stringify(paymentDataWithBalance),
      });

      await db.update('accounts_receivable', arItem.localId, {
        paid_cents: newPaidCents,
        balance_cents: newBalanceCents,
        status: newStatus,
      });

      // Agregar a cola de sincronización
      await syncService.queueOperation('payment', 'create', paymentDataWithBalance, localId);

      let printNotice = '';
      try {
        const shouldAttemptPrint = await hasConnectedPrinter();
        if (shouldAttemptPrint) {
          const printResult = await printPaymentReceiptDirect({
            receiptCode,
            createdAt: now,
            customerName: arItem.customerName,
            invoiceCode,
            paymentMethod,
            transferBankName: paymentMethod === 'TRANSFERENCIA' ? transferBankName : null,
            reference: reference.trim() || null,
            notes: notes.trim() || null,
            amountCents,
            balanceAfterCents: newBalanceCents,
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

      Alert.alert('Éxito', `Pago de ${formatCurrency(amountCents)} registrado\nRecibo: ${receiptCode}${printNotice}`, [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      console.error('Error guardando pago:', error);
      Alert.alert('Error', 'No se pudo registrar el pago');
    } finally {
      setLoading(false);
    }
  };

  if (!arItem) {
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
          <Text style={styles.customerName}>{arItem.customerName}</Text>
          <Divider style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Factura:</Text>
            <Text style={styles.summaryValue}>{formatCurrency(arItem.totalCents)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Ya Pagado:</Text>
            <Text style={styles.summaryValue}>{formatCurrency(arItem.paidCents)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Balance Pendiente:</Text>
            <Text style={styles.balanceValue}>{formatCurrency(arItem.balanceCents)}</Text>
          </View>
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
            Pagar Total ({formatCurrency(arItem.balanceCents)})
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
