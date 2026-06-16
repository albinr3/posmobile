import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Menu, Modal, Portal, Surface, Text, TextInput } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { SafeAreaView } from '../../components/SafeAreaView';
import { ui } from '../../theme/ui';
import { DOMINICAN_BANKS } from '../../constants/dominicanBanks';
import {
  createTreasuryAccount,
  createTreasuryTransfer,
  getTreasuryDashboard,
  getTreasuryPermissions,
  listTreasuryAccounts,
  previewTreasuryTransfer,
  reverseTreasuryTransfer,
} from '../../services/treasury/treasuryService';
import { syncService } from '../../services/sync/SyncService';
import { TreasuryAccount, TreasuryMovement } from '../../types';
import { formatCurrency } from '../../utils/helpers';
import { useTreasuryUIStore } from '../../store/treasuryUIStore';
import { useAuthStore } from '../../store/authStore';
import { API_URL } from '../../services/sync/syncShared';

type TransferDraft = {
  fromTreasuryAccountId: string;
  toTreasuryAccountId: string;
  amount: string;
  note: string;
};

function toCents(value: string): number {
  const normalized = String(value || '').replace(',', '.').replace(/[^\d.]/g, '');
  const number = Number(normalized);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

function formatDateTime(valueMs: number): string {
  return new Date(valueMs).toLocaleString('es-DO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function TreasuryScreen() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  const focusRefreshRunningRef = useRef(false);
  getTokenRef.current = getToken;
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
  const [movements, setMovements] = useState<TreasuryMovement[]>([]);
  const [accountBalanceById, setAccountBalanceById] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState({ inCents: 0, outCents: 0, balanceCents: 0 });
  const [transferDraft, setTransferDraft] = useState<TransferDraft>({
    fromTreasuryAccountId: '',
    toTreasuryAccountId: '',
    amount: '',
    note: '',
  });
  const [fromMenuVisible, setFromMenuVisible] = useState(false);
  const [toMenuVisible, setToMenuVisible] = useState(false);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<'CAJA' | 'BANCO'>('BANCO');
  const [accountBankName, setAccountBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountOpeningAmount, setAccountOpeningAmount] = useState('');
  const [typeMenuVisible, setTypeMenuVisible] = useState(false);
  const [bankMenuVisible, setBankMenuVisible] = useState(false);
  const [bankOptions, setBankOptions] = useState<string[]>([...DOMINICAN_BANKS]);

  const [reverseModalVisible, setReverseModalVisible] = useState(false);
  const [transferIdToReverse, setTransferIdToReverse] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const permissions = useMemo(() => getTreasuryPermissions(), []);
  const consumeCreateAccountModalRequest = useTreasuryUIStore((state) => state.consumeCreateAccountModalRequest);
  const setLastCreatedAccountId = useTreasuryUIStore((state) => state.setLastCreatedAccountId);

  const loadBankOptions = useCallback(async () => {
    try {
      const clerkToken = await getTokenRef.current();
      if (!clerkToken) return;
      const response = await axios.get(`${API_URL}/api/meta/dominican-banks`, {
        headers: {
          Authorization: `Bearer ${clerkToken}`,
          'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        },
      });
      const rows = Array.isArray(response?.data?.data) ? response.data.data : [];
      const normalized = rows
        .map((item: any) => String(item || '').trim())
        .filter((item: string) => !!item);
      if (normalized.length > 0) {
        setBankOptions(normalized);
      }
    } catch (error) {
      console.warn('[TreasuryScreen] No se pudo cargar bancos desde API, usando fallback local.', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await loadBankOptions();
      const [dashboard, accountList] = await Promise.all([
        getTreasuryDashboard({ fromMs: 0, toMs: Date.now() }),
        listTreasuryAccounts(true),
      ]);
      setMovements(dashboard.recentMovements);
      const accumulatedTotals = dashboard.accounts.reduce(
        (acc, account) => {
          acc.inCents += Number(account.inCents || 0);
          acc.outCents += Number(account.outCents || 0);
          acc.balanceCents += Number(account.balanceCents || 0);
          return acc;
        },
        { inCents: 0, outCents: 0, balanceCents: 0 }
      );
      setTotals(accumulatedTotals);
      setAccounts(accountList);
      setAccountBalanceById(
        dashboard.accounts.reduce<Record<string, number>>((acc, account) => {
          acc[account.id] = account.balanceCents;
          return acc;
        }, {})
      );
    } catch (error: any) {
      Alert.alert('Tesorería', error?.message || 'No se pudo cargar tesorería');
    } finally {
      setLoading(false);
    }
  }, [loadBankOptions]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const autoRefreshOnEnter = async () => {
        if (focusRefreshRunningRef.current) return;
        focusRefreshRunningRef.current = true;
        await loadData();
        try {
          if (!active) return;
          const currentSubUserToken = useAuthStore.getState().subUserToken;
          if (!currentSubUserToken) return;

          const netInfo = await NetInfo.fetch();
          const hasInternet = !!netInfo.isConnected && netInfo.isInternetReachable !== false;
          if (!hasInternet || !active) return;

          const clerkToken = await getTokenRef.current();
          if (!clerkToken || !active) return;

          syncService.setTokenGetter(() => getTokenRef.current());
          syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
          await syncService.fullSync(clerkToken, { ignoreCooldown: true });
        } catch (error) {
          console.error('[TreasuryScreen] auto refresh on enter failed:', error);
        } finally {
          focusRefreshRunningRef.current = false;
        }
        if (!active) return;
        await loadData();
      };

      void autoRefreshOnEnter();
      const openRequest = consumeCreateAccountModalRequest();
      if (openRequest.open) {
        setAccountType(openRequest.preferredType === 'CAJA' ? 'CAJA' : 'BANCO');
        setCreateModalVisible(true);
      }
      return () => {
        active = false;
      };
    }, [consumeCreateAccountModalRequest, loadData])
  );

  const activeAccounts = useMemo(() => accounts.filter((account) => account.isActive), [accounts]);
  const recentMovements = useMemo(() => movements.slice(0, 10), [movements]);

  const openReverseModal = (transferId: string) => {
    setTransferIdToReverse(transferId);
    setReverseReason('');
    setReverseModalVisible(true);
  };

  const handleCreateTransfer = async () => {
    if (!permissions.canCreateTransfers) {
      Alert.alert('Permisos', 'No tienes permiso para crear transferencias de tesorería');
      return;
    }
    const amountCents = toCents(transferDraft.amount);
    if (!transferDraft.fromTreasuryAccountId || !transferDraft.toTreasuryAccountId || amountCents <= 0) {
      Alert.alert('Validación', 'Completa origen, destino y monto válido');
      return;
    }
    try {
      const preview = await previewTreasuryTransfer({
        fromTreasuryAccountId: transferDraft.fromTreasuryAccountId,
        toTreasuryAccountId: transferDraft.toTreasuryAccountId,
        amountCents,
        transferredAtMs: Date.now(),
      });

      const runCreate = async () => {
        await createTreasuryTransfer({
          fromTreasuryAccountId: transferDraft.fromTreasuryAccountId,
          toTreasuryAccountId: transferDraft.toTreasuryAccountId,
          amountCents,
          note: transferDraft.note.trim() || null,
        });
        setTransferDraft({ fromTreasuryAccountId: '', toTreasuryAccountId: '', amount: '', note: '' });
        await loadData();
      };

      if (preview.willBeNegative) {
        Alert.alert(
          'Saldo negativo proyectado',
          `El saldo proyectado en origen quedará en ${formatCurrency(preview.projectedSourceBalanceCents)}. ¿Deseas continuar?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Continuar', onPress: () => void runCreate() },
          ]
        );
        return;
      }

      await runCreate();
    } catch (error: any) {
      Alert.alert('Transferencia', error?.message || 'No se pudo crear la transferencia');
    }
  };

  const handleReverseTransfer = async () => {
    if (!transferIdToReverse) return;
    if (!permissions.canReverseTransfers) {
      Alert.alert('Permisos', 'No tienes permiso para reversar transferencias');
      return;
    }
    if (!reverseReason.trim()) {
      Alert.alert('Validación', 'Debes indicar el motivo del reverso');
      return;
    }
    try {
      await reverseTreasuryTransfer({
        transferId: transferIdToReverse,
        reason: reverseReason.trim(),
        reversedAtMs: Date.now(),
      });
      setReverseModalVisible(false);
      setTransferIdToReverse(null);
      setReverseReason('');
      await loadData();
    } catch (error: any) {
      Alert.alert('Reverso', error?.message || 'No se pudo reversar la transferencia');
    }
  };

  const handleCreateAccount = async () => {
    if (!permissions.canManageAccounts) {
      Alert.alert('Permisos', 'No tienes permiso para gestionar cuentas de tesorería');
      return;
    }
    if (!accountName.trim()) {
      Alert.alert('Validación', 'El nombre de la cuenta es requerido');
      return;
    }
    try {
      const created = await createTreasuryAccount({
        name: accountName.trim(),
        type: accountType,
        bankName: accountType === 'BANCO' ? accountBankName.trim() || accountName.trim() : null,
        accountNumber: accountType === 'BANCO' ? accountNumber.trim() || null : null,
        openingBalanceCents: toCents(accountOpeningAmount),
      });
      setLastCreatedAccountId(created.localId);
      setCreateModalVisible(false);
      setAccountName('');
      setAccountType('BANCO');
      setAccountBankName('');
      setAccountNumber('');
      setAccountOpeningAmount('');
      await loadData();
      Alert.alert('Tesorería', 'Cuenta creada correctamente');
    } catch (error: any) {
      Alert.alert('Cuenta', error?.message || 'No se pudo crear la cuenta');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.screenTitle}>Tesorería</Text>
          <Button mode="text" onPress={() => void loadData()} loading={loading}>
            Actualizar
          </Button>
        </View>

        <Surface style={styles.section}>
          <Text style={styles.sectionTitle}>Resumen de cuentas</Text>
          {accounts.map((account) => (
            <View key={account.localId} style={styles.accountRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountName}>{account.name}</Text>
                <Text style={styles.accountMeta}>
                  {account.type === 'CAJA' ? 'Caja' : `Banco${account.bankName ? ` · ${account.bankName}` : ''}`}
                  {!account.isActive ? ' · Inactiva' : ''}
                </Text>
              </View>
              <Text style={styles.balanceValue}>
                {formatCurrency(accountBalanceById[account.localId] || 0)}
              </Text>
            </View>
          ))}
          <Divider style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Entradas</Text>
            <Text style={styles.totalIn}>{formatCurrency(totals.inCents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Salidas</Text>
            <Text style={styles.totalOut}>{formatCurrency(totals.outCents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelStrong}>Balance total</Text>
            <Text style={styles.totalBalance}>{formatCurrency(totals.balanceCents)}</Text>
          </View>
        </Surface>

        {permissions.canCreateTransfers ? (
          <Surface style={styles.section}>
            <Text style={styles.sectionTitle}>Transferencia interna</Text>

            <Text style={styles.fieldLabel}>Cuenta origen</Text>
            <Menu
              visible={fromMenuVisible}
              onDismiss={() => setFromMenuVisible(false)}
              anchor={
                <Button mode="outlined" onPress={() => setFromMenuVisible(true)}>
                  {activeAccounts.find((account) => account.localId === transferDraft.fromTreasuryAccountId)?.name || 'Seleccionar'}
                </Button>
              }
            >
              {activeAccounts.map((account) => (
                <Menu.Item
                  key={`from-${account.localId}`}
                  title={account.name}
                  onPress={() => {
                    setTransferDraft((prev) => ({ ...prev, fromTreasuryAccountId: account.localId }));
                    setFromMenuVisible(false);
                  }}
                />
              ))}
            </Menu>

            <Text style={[styles.fieldLabel, styles.fieldGap]}>Cuenta destino</Text>
            <Menu
              visible={toMenuVisible}
              onDismiss={() => setToMenuVisible(false)}
              anchor={
                <Button mode="outlined" onPress={() => setToMenuVisible(true)}>
                  {activeAccounts.find((account) => account.localId === transferDraft.toTreasuryAccountId)?.name || 'Seleccionar'}
                </Button>
              }
            >
              {activeAccounts.map((account) => (
                <Menu.Item
                  key={`to-${account.localId}`}
                  title={account.name}
                  onPress={() => {
                    setTransferDraft((prev) => ({ ...prev, toTreasuryAccountId: account.localId }));
                    setToMenuVisible(false);
                  }}
                />
              ))}
            </Menu>

            <TextInput
              label="Monto (RD$)"
              mode="outlined"
              keyboardType="decimal-pad"
              value={transferDraft.amount}
              onChangeText={(value) => setTransferDraft((prev) => ({ ...prev, amount: value }))}
              style={styles.input}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <TextInput
              label="Nota (opcional)"
              mode="outlined"
              value={transferDraft.note}
              onChangeText={(value) => setTransferDraft((prev) => ({ ...prev, note: value }))}
              style={styles.input}
              outlineColor={ui.colors.border}
              activeOutlineColor={ui.colors.primary}
            />
            <Button mode="contained" buttonColor={ui.colors.primary} onPress={() => void handleCreateTransfer()}>
              Crear transferencia
            </Button>
          </Surface>
        ) : null}

        {permissions.canManageAccounts ? (
          <Surface style={styles.section}>
            <Text style={styles.sectionTitle}>Cuentas de tesorería</Text>
            <Text style={styles.sectionHint}>Crea y administra cuentas de caja o banco.</Text>
            <View style={styles.sectionActionRow}>
              <Button mode="contained" buttonColor={ui.colors.primary} onPress={() => setCreateModalVisible(true)}>
                Crear cuenta
              </Button>
            </View>
          </Surface>
        ) : null}

        <Surface style={styles.section}>
          <Text style={styles.sectionTitle}>Últimos 10 movimientos</Text>
          {!recentMovements.length ? (
            <Text style={styles.emptyText}>No hay movimientos registrados</Text>
          ) : (
            recentMovements.map((movement) => (
              <View key={movement.id} style={styles.movementRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.movementRef}>{movement.reference}</Text>
                  <Text style={styles.movementMeta}>
                    {movement.treasuryAccountName} · {movement.source} · {formatDateTime(movement.occurredAt)}
                  </Text>
                  <Text style={styles.movementMeta}>
                    Estado: {movement.transferStatus || 'ACTIVE'}
                    {movement.transferTrace ? ` · ${movement.transferTrace}` : ''}
                  </Text>
                </View>
                <View style={styles.movementAmountWrap}>
                  <Text style={movement.direction === 'IN' ? styles.amountIn : styles.amountOut}>
                    {movement.direction === 'IN' ? '+' : '-'}{formatCurrency(movement.amountCents)}
                  </Text>
                  {movement.transferId && movement.canReverseTransfer ? (
                    <Button mode="text" compact onPress={() => openReverseModal(movement.transferId as string)}>
                      Reversar
                    </Button>
                  ) : null}
                </View>
              </View>
            ))
          )}
          {movements.length > recentMovements.length ? (
            <Text style={[styles.emptyText, styles.movementCountHint]}>
              Mostrando {recentMovements.length} de {movements.length} movimientos.
            </Text>
          ) : null}
        </Surface>
      </ScrollView>

      <Portal>
        <Modal visible={createModalVisible} onDismiss={() => setCreateModalVisible(false)} contentContainerStyle={styles.modalCard}>
          <Text style={styles.modalTitle}>Nueva cuenta de tesorería</Text>
          <TextInput
            label="Nombre"
            mode="outlined"
            value={accountName}
            onChangeText={setAccountName}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <Text style={styles.fieldLabel}>Tipo</Text>
          <Menu
            visible={typeMenuVisible}
            onDismiss={() => setTypeMenuVisible(false)}
            anchor={
              <Button mode="outlined" onPress={() => setTypeMenuVisible(true)}>
                {accountType === 'BANCO' ? 'Banco' : 'Caja'}
              </Button>
            }
          >
            <Menu.Item onPress={() => { setAccountType('CAJA'); setTypeMenuVisible(false); }} title="Caja" />
            <Menu.Item onPress={() => { setAccountType('BANCO'); setTypeMenuVisible(false); }} title="Banco" />
          </Menu>
          {accountType === 'BANCO' ? (
            <>
              <Text style={styles.fieldLabel}>Banco</Text>
              <Menu
                visible={bankMenuVisible}
                onDismiss={() => setBankMenuVisible(false)}
                anchor={
                  <Button mode="outlined" onPress={() => setBankMenuVisible(true)}>
                    {accountBankName || 'Seleccionar banco'}
                  </Button>
                }
              >
                {bankOptions.map((bankName) => (
                  <Menu.Item
                    key={bankName}
                    onPress={() => {
                      setAccountBankName(bankName);
                      setBankMenuVisible(false);
                    }}
                    title={bankName}
                  />
                ))}
              </Menu>
              <TextInput
                label="Número de cuenta (opcional)"
                mode="outlined"
                value={accountNumber}
                onChangeText={setAccountNumber}
                style={styles.input}
                outlineColor={ui.colors.border}
                activeOutlineColor={ui.colors.primary}
              />
            </>
          ) : null}
          <TextInput
            label="Saldo inicial (solo Caja Efectivo)"
            mode="outlined"
            keyboardType="decimal-pad"
            value={accountOpeningAmount}
            onChangeText={setAccountOpeningAmount}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <View style={styles.modalActions}>
            <Button mode="outlined" onPress={() => setCreateModalVisible(false)}>Cancelar</Button>
            <Button mode="contained" buttonColor={ui.colors.primary} onPress={() => void handleCreateAccount()}>
              Crear
            </Button>
          </View>
        </Modal>
      </Portal>

      <Portal>
        <Modal visible={reverseModalVisible} onDismiss={() => setReverseModalVisible(false)} contentContainerStyle={styles.modalCard}>
          <Text style={styles.modalTitle}>Reversar transferencia</Text>
          <TextInput
            label="Motivo"
            mode="outlined"
            value={reverseReason}
            onChangeText={setReverseReason}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <View style={styles.modalActions}>
            <Button mode="outlined" onPress={() => setReverseModalVisible(false)}>Cancelar</Button>
            <Button mode="contained" buttonColor={ui.colors.primary} onPress={() => void handleReverseTransfer()}>
              Confirmar
            </Button>
          </View>
        </Modal>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 12, gap: 10, paddingBottom: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  screenTitle: { color: ui.colors.text, fontSize: 24, fontWeight: '800' },
  section: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 12,
  },
  sectionTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionHint: { color: ui.colors.textMuted, fontSize: 13 },
  sectionActionRow: { marginTop: 10, alignItems: 'flex-start' },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  accountName: { color: ui.colors.text, fontWeight: '700' },
  accountMeta: { color: ui.colors.textMuted, fontSize: 12 },
  balanceValue: { color: ui.colors.primary, fontWeight: '800' },
  divider: { marginVertical: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalLabel: { color: ui.colors.textMuted },
  totalLabelStrong: { color: ui.colors.text, fontWeight: '700' },
  totalIn: { color: '#15803D', fontWeight: '700' },
  totalOut: { color: '#B91C1C', fontWeight: '700' },
  totalBalance: { color: ui.colors.primary, fontWeight: '800' },
  fieldLabel: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 6 },
  fieldGap: { marginTop: 10 },
  input: { marginTop: 10, backgroundColor: ui.colors.surface },
  emptyText: { color: ui.colors.textMuted, fontSize: 13 },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
  },
  movementRef: { color: ui.colors.text, fontWeight: '700' },
  movementMeta: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  movementAmountWrap: { alignItems: 'flex-end' },
  movementCountHint: { marginTop: 8 },
  amountIn: { color: '#15803D', fontWeight: '800' },
  amountOut: { color: '#B91C1C', fontWeight: '800' },
  modalCard: {
    margin: 18,
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    padding: 14,
  },
  modalTitle: { color: ui.colors.text, fontSize: 17, fontWeight: '800' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
});
