import React, { useCallback, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { FinancialApiError, purchaseCreditService } from '../../services/purchases/purchaseCreditService';
import { syncService } from '../../services/sync/SyncService';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { ui } from '../../theme/ui';
import { formatCurrency, formatDate } from '../../utils/helpers';

export function PurchaseDetailScreen({ navigation, route }: { navigation: any; route: any }) {
  const localId = String(route?.params?.purchaseId || '');
  const [purchase, setPurchase] = useState<any>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isOnline = useSyncStore(state => state.isOnline);
  const canManage = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canManagePurchases === true);
  const canCancel = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canCancelPurchases === true);
  const canSeePayable = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canAccessAccountsPayable === true);
  const canSeeCashHistory = useAuthStore(state => !!state.subUser?.isOwner || state.subUser?.canOperateCashShifts === true || state.subUser?.canViewAllCashShifts === true || state.subUser?.canManageCashShifts === true);

  const load = useCallback(async () => {
    const row = await db.queryFirst<any>('SELECT * FROM purchases WHERE local_id = ?', [localId]);
    if (!row) { setError('No se encontró la compra.'); return; }
    const local = JSON.parse(row.data || '{}');
    const id = row.server_id ? String(row.server_id) : null;
    setServerId(id);
    setPurchase({ ...local, id, supplierName: row.supplier_name || local.supplierName,
      totalCents: Number(row.total_cents ?? local.totalCents ?? 0), cancelledAt: row.cancelled_at || local.cancelledAt,
      purchasedAt: row.purchased_at || local.purchasedAt });
    setError('');
    if (isOnline && id) {
      try { setPurchase(await purchaseCreditService.getPurchase(id)); }
      catch (cause) { setError(`No se pudo actualizar el detalle: ${cause instanceof Error ? cause.message : 'error de conexión'}`); }
    }
  }, [isOnline, localId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const type = purchase?.type === 'CREDITO' ? 'CREDITO' : 'CONTADO';
  const paidCents = Number(purchase?.paidCents ?? (type === 'CONTADO' ? purchase?.totalCents : 0));
  const balanceCents = Number(purchase?.balanceCents ?? 0);
  const payableId = String(purchase?.payableId || purchase?.payable?.id || '');
  const items: any[] = Array.isArray(purchase?.items) ? purchase.items : [];

  const cancel = () => {
    if (!serverId || !isOnline) { Alert.alert('Sin conexión', 'Conéctate y sincroniza esta compra antes de anularla.'); return; }
    if (type === 'CREDITO' && paidCents > 0) { Alert.alert('Pagos activos', 'Anula primero los pagos de esta compra.'); return; }
    Alert.alert('Anular compra', 'Se revertirá el inventario y, si es a crédito, la deuda. ¿Continuar?', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Anular', style: 'destructive', onPress: () => void (async () => {
        if (busy) return;
        setBusy(true);
        try {
          await purchaseCreditService.cancelPurchase(serverId);
          const warning = await syncService.refreshConfirmedCreditPurchase(serverId).then(() => '').catch(() => 'La copia local se actualizará en la próxima sincronización.');
          await load();
          Alert.alert('Compra anulada', warning || 'La anulación quedó confirmada en el servidor.');
        } catch (cause) {
          if (cause instanceof FinancialApiError && cause.code === 'CASH_DOCUMENT_CLOSED') Alert.alert('Turno cerrado', `${cause.message}${canSeeCashHistory ? '' : ' Solicita la corrección al responsable de caja.'}`, canSeeCashHistory ? [
            { text: 'Cerrar' }, { text: 'Ir a Cuadre diario', onPress: () => navigation.getParent()?.navigate('DailyCloseMenu', { screen: 'DailyClose' }) },
          ] : [{ text: 'Cerrar' }]);
          else Alert.alert('Error', cause instanceof Error ? cause.message : 'No se pudo anular.');
        }
        finally { setBusy(false); }
      })() },
    ]);
  };

  return <SafeAreaView style={{ flex: 1, backgroundColor: ui.colors.background }} edges={['bottom']}>
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 36, gap: 12 }}>
      <Text variant="headlineSmall">Detalle de compra</Text>
      {!!error && <Text style={{ color: ui.colors.danger }}>{error}</Text>}
      {purchase && <>
        <Card style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text variant="titleLarge">{purchase.supplierName || purchase.supplier?.name || 'Proveedor'}</Text>
          <Text>{type === 'CREDITO' ? 'Crédito' : 'Contado'}{purchase.cancelledAt ? ' · Anulada' : ''}</Text>
          <Text>Fecha: {formatDate(new Date(purchase.purchasedAt || Date.now()).getTime())}</Text>
          {type === 'CREDITO' && <Text>Vencimiento: {String(purchase.dueDate || purchase.payable?.dueDate || '—').slice(0, 10)}</Text>}
          {!!purchase.notes && <Text>Notas: {purchase.notes}</Text>}
          <Text>Total: {formatCurrency(Number(purchase.totalCents || 0))}</Text>
          {type === 'CREDITO' && <><Text>Abonado: {formatCurrency(paidCents)}</Text><Text variant="titleMedium">Pendiente: {formatCurrency(purchase.cancelledAt ? 0 : balanceCents)}</Text></>}
        </Card.Content></Card>
        <Text variant="titleMedium">Productos</Text>
        {items.map((item, index) => <Card key={String(item.id || `${item.productId}-${index}`)} style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text>{item.productName || item.product?.name || 'Producto'}</Text>
          <Text>{Number(item.qty || 0)} × {formatCurrency(Number(item.unitCostCents || 0))}</Text>
          <Text>Total: {formatCurrency(Number(item.lineTotalCents ?? Math.round(Number(item.qty || 0) * Number(item.unitCostCents || 0))))}</Text>
        </Card.Content></Card>)}
        {canManage && !purchase.cancelledAt && <Button mode="contained" onPress={() => navigation.navigate('AddPurchase', { purchaseId: localId })}>Editar compra</Button>}
        {canSeePayable && payableId && <Button mode="outlined" onPress={() => navigation.getParent()?.navigate('AccountsPayableMenu', { screen: 'PayableDetail', params: { payableId } })}>Ver cuenta por pagar</Button>}
        {canCancel && !purchase.cancelledAt && <Button mode="outlined" disabled={busy || !serverId || (type === 'CREDITO' && paidCents > 0)} onPress={cancel}>Anular compra</Button>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
