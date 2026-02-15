import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Surface, Divider, Icon } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId, generateReceiptCode, formatCurrency } from '../../utils/helpers';
import { AccountReceivable } from '../../types';
import { ui } from '../../theme/ui';

interface RegisterPaymentScreenProps {
  navigation: any;
  route?: {
    params?: {
      arId?: string;
    };
  };
}

export function RegisterPaymentScreen({ navigation, route }: RegisterPaymentScreenProps) {
  const insets = useSafeAreaInsets();
  const arId = route?.params?.arId || '';
  const [arItem, setARItem] = useState<AccountReceivable | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('EFECTIVO');
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

    setLoading(true);
    try {
      const localId = generateLocalId();
      const receiptCode = generateReceiptCode();
      const now = Date.now();

      const paymentData = {
        localId,
        receiptCode,
        arId: arItem.localId,
        arServerId: arItem.serverId,
        customerId: arItem.customerId,
        customerName: arItem.customerName,
        amountCents,
        paymentMethod,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        createdAt: now,
      };

      // Guardar pago en SQLite
      await db.insert('payments', {
        local_id: localId,
        receipt_code: receiptCode,
        amount_cents: amountCents,
        ar_id: arItem.localId,
        synced: 0,
        data: JSON.stringify(paymentData),
      });

      // Actualizar cuenta por cobrar
      const newPaidCents = arItem.paidCents + amountCents;
      const newBalanceCents = arItem.totalCents - newPaidCents;
      const newStatus = newBalanceCents <= 0 ? 'PAGADO' : newPaidCents > 0 ? 'PARCIAL' : 'PENDIENTE';

      await db.update('accounts_receivable', arItem.localId, {
        paid_cents: newPaidCents,
        balance_cents: newBalanceCents,
        status: newStatus,
      });

      // Agregar a cola de sincronización
      await syncService.queueOperation('payment', 'create', paymentData, localId);

      Alert.alert('Éxito', `Pago de ${formatCurrency(amountCents)} registrado\nRecibo: ${receiptCode}`, [
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
                  onPress={() => setPaymentMethod(option.value)}
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

      <View style={[styles.stickyFooter, { bottom: insets.bottom - 20 }]}>
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
      </View>
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 0,
  },
});
