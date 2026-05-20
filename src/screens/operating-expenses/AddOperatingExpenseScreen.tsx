import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text, Surface, Menu } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { BottomDock } from '../../components/BottomDock';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { useAuthStore } from '../../store/authStore';
import { generateLocalId, formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { listTreasuryAccounts } from '../../services/treasury/treasuryService';
import { TreasuryAccount } from '../../types';
import { filterTreasuryAccountsByMethod, findTreasuryAccountById } from '../../utils/treasury';
import { useTreasuryUIStore } from '../../store/treasuryUIStore';

interface AddOperatingExpenseScreenProps {
  navigation: any;
  route?: {
    params?: {
      expenseLocalId?: string;
    };
  };
}

function toIsoDate(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function toCents(value: string): number {
  const normalized = String(value || '').replace(',', '.').replace(/[^\d.]/g, '');
  const number = Number(normalized);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

export function AddOperatingExpenseScreen({ navigation, route }: AddOperatingExpenseScreenProps) {
  const subUser = useAuthStore((state) => state.subUser);
  const expenseLocalId = route?.params?.expenseLocalId || null;
  const isEditing = !!expenseLocalId;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('0.00');
  const [expenseDate, setExpenseDate] = useState(toIsoDate(null));
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO'>('EFECTIVO');
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([]);
  const [treasuryAccountId, setTreasuryAccountId] = useState<string | null>(null);
  const [paymentMethodMenuVisible, setPaymentMethodMenuVisible] = useState(false);
  const [treasuryMenuVisible, setTreasuryMenuVisible] = useState(false);
  const [serverId, setServerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExpense, setLoadingExpense] = useState(isEditing);
  const requestCreateAccountModal = useTreasuryUIStore((state) => state.requestCreateAccountModal);
  const consumeLastCreatedAccountId = useTreasuryUIStore((state) => state.consumeLastCreatedAccountId);

  const amountCentsPreview = useMemo(() => toCents(amount), [amount]);

  useEffect(() => {
    if (!expenseLocalId) return;
    const loadExpense = async () => {
      try {
        const row = await db.queryFirst<any>(
          'SELECT local_id, server_id, description, amount_cents, expense_date, category, notes, data FROM operating_expenses WHERE local_id = ?',
          [expenseLocalId]
        );
        if (!row) {
          Alert.alert('Error', 'No se encontró el gasto operativo.');
          navigation.goBack();
          return;
        }
        let parsed: any = null;
        try {
          parsed = row?.data ? JSON.parse(row.data) : null;
        } catch {
          parsed = null;
        }
        setDescription(String(parsed?.description || row.description || ''));
        setAmount(((Number(parsed?.amountCents || row.amount_cents || 0)) / 100).toFixed(2));
        const dateIso = parsed?.expenseDate || (row.expense_date ? new Date(Number(row.expense_date)).toISOString() : null);
        setExpenseDate(toIsoDate(dateIso));
        setCategory(parsed?.category ?? row.category ?? '');
        setNotes(parsed?.notes ?? row.notes ?? '');
        const parsedMethod = String(parsed?.paymentMethod || row.payment_method || 'EFECTIVO').toUpperCase();
        setPaymentMethod(parsedMethod === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : parsedMethod === 'TARJETA' ? 'TARJETA' : parsedMethod === 'OTRO' ? 'OTRO' : 'EFECTIVO');
        setTreasuryAccountId(parsed?.treasuryAccountId ? String(parsed.treasuryAccountId) : row.treasury_account_id ? String(row.treasury_account_id) : null);
        setServerId(row.server_id ? String(row.server_id) : null);
      } catch (error) {
        console.error('Error cargando gasto operativo:', error);
        Alert.alert('Error', 'No se pudo cargar el gasto operativo.');
      } finally {
        setLoadingExpense(false);
      }
    };
    loadExpense();
  }, [expenseLocalId, navigation]);

  useEffect(() => {
    const loadTreasury = async () => {
      try {
        const rows = await listTreasuryAccounts(false);
        setTreasuryAccounts(rows);
      } catch {
        setTreasuryAccounts([]);
      }
    };
    void loadTreasury();
  }, []);

  useEffect(() => {
    const created = consumeLastCreatedAccountId();
    if (created) {
      setTreasuryAccountId(created);
    }
  }, [consumeLastCreatedAccountId]);

  useEffect(() => {
    if (!treasuryAccounts.length) return;
    const allowed = filterTreasuryAccountsByMethod(treasuryAccounts.filter((account) => account.isActive), paymentMethod);
    const selected = findTreasuryAccountById(allowed, treasuryAccountId);
    if (!selected) {
      setTreasuryAccountId(allowed[0]?.localId || null);
    }
  }, [paymentMethod, treasuryAccountId, treasuryAccounts]);

  const validate = () => {
    if (!description.trim()) {
      Alert.alert('Validación', 'La descripción es requerida.');
      return false;
    }
    const cents = toCents(amount);
    if (cents <= 0) {
      Alert.alert('Validación', 'El monto debe ser mayor a 0.');
      return false;
    }
    const date = new Date(expenseDate);
    if (Number.isNaN(date.getTime())) {
      Alert.alert('Validación', 'La fecha no es válida (usa formato YYYY-MM-DD).');
      return false;
    }
    if ((paymentMethod === 'EFECTIVO' || paymentMethod === 'TRANSFERENCIA') && !treasuryAccountId) {
      Alert.alert('Validación', 'Debes seleccionar una cuenta de tesorería.');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const localId = expenseLocalId || generateLocalId();
      const expenseDateMs = new Date(expenseDate).getTime();
      const payload = {
        id: serverId || undefined,
        description: description.trim(),
        amountCents: toCents(amount),
        expenseDate: new Date(expenseDateMs).toISOString(),
        paymentMethod,
        treasuryAccountId: treasuryAccountId || null,
        category: category.trim() || null,
        notes: notes.trim() || null,
        user: subUser
          ? {
              id: subUser.id,
              name: subUser.name || null,
              username: subUser.username || null,
            }
          : null,
      };
      const rowData = {
        description: payload.description,
        amount_cents: payload.amountCents,
        expense_date: expenseDateMs,
        category: payload.category,
        notes: payload.notes,
        payment_method: payload.paymentMethod,
        treasury_account_id: payload.treasuryAccountId,
        synced: 0,
        data: JSON.stringify({
          ...payload,
          localId,
          serverId: serverId || null,
        }),
      };

      if (isEditing) {
        await db.update('operating_expenses', localId, rowData);
      } else {
        await db.insert('operating_expenses', {
          local_id: localId,
          server_id: null,
          ...rowData,
        });
      }

      await db.runAsync(
        "DELETE FROM sync_queue WHERE entity_type = 'operating_expense' AND entity_local_id = ? AND status IN ('pending','error')",
        [localId]
      );

      const action = serverId ? 'update' : 'create';
      await syncService.queueOperation('operating_expense', action, payload, localId);

      Alert.alert('Éxito', isEditing ? 'Gasto operativo actualizado.' : 'Gasto operativo creado.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      console.error('Error guardando gasto operativo:', error);
      Alert.alert('Error', 'No se pudo guardar el gasto operativo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 96 }]}>
        <Surface style={styles.formSection}>
          <Text style={styles.sectionTitle}>{isEditing ? 'Editar gasto operativo' : 'Nuevo gasto operativo'}</Text>

          {loadingExpense ? <Text style={styles.helper}>Cargando...</Text> : null}

          <TextInput
            label="Descripción *"
            value={description}
            onChangeText={setDescription}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
            placeholder="Ej: Pago de arriendo"
          />

          <TextInput
            label="Monto (RD$) *"
            value={amount}
            onChangeText={setAmount}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <Text style={styles.preview}>Monto registrado: {formatCurrency(amountCentsPreview)}</Text>

          <TextInput
            label="Fecha (YYYY-MM-DD) *"
            value={expenseDate}
            onChangeText={setExpenseDate}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
            placeholder="2026-02-18"
          />

          <Text style={styles.summaryLabel}>Método de pago</Text>
          <Menu
            visible={paymentMethodMenuVisible}
            onDismiss={() => setPaymentMethodMenuVisible(false)}
            anchor={
              <Button mode="outlined" onPress={() => setPaymentMethodMenuVisible(true)} textColor={ui.colors.primary}>
                {paymentMethod}
              </Button>
            }
          >
            {['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO'].map((method) => (
              <Menu.Item
                key={method}
                onPress={() => {
                  setPaymentMethod(method as any);
                  setPaymentMethodMenuVisible(false);
                }}
                title={method}
              />
            ))}
          </Menu>

          <Text style={[styles.summaryLabel, { marginTop: 10 }]}>Cuenta de tesorería</Text>
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
                  setTreasuryMenuVisible(false);
                }}
                title={account.name}
              />
            ))}
            <Menu.Item
              onPress={() => {
                requestCreateAccountModal(paymentMethod === 'EFECTIVO' ? 'CAJA' : paymentMethod === 'TRANSFERENCIA' ? 'BANCO' : null);
                setTreasuryMenuVisible(false);
                navigation.navigate('TreasuryMenu', { screen: 'Treasury' });
              }}
              title="+ Crear nueva cuenta"
            />
          </Menu>

          <TextInput
            label="Categoría (opcional)"
            value={category}
            onChangeText={setCategory}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
            placeholder="Ej: Arriendo, Sueldos, Servicios, Marketing"
          />

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
          disabled={loading || loadingExpense}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          {isEditing ? 'Guardar cambios' : 'Crear gasto'}
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
  scrollContent: {
    padding: 12,
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
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: ui.colors.text,
  },
  helper: {
    color: ui.colors.textMuted,
    marginBottom: 10,
  },
  input: {
    marginBottom: 10,
    backgroundColor: ui.colors.surface,
  },
  preview: {
    color: ui.colors.textMuted,
    fontSize: 12,
    marginBottom: 10,
  },
  summaryLabel: {
    color: ui.colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
  },
  stickyFooter: {
    paddingBottom: 2,
  },
  saveButton: {
    borderRadius: ui.radius.md,
  },
  saveButtonContent: {
    height: 48,
  },
  saveButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
});
