import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { syncService } from '../services/sync/SyncService';
import { useAuthStore } from '../store/authStore';
import { ui } from '../theme/ui';

type PendingRow = Awaited<ReturnType<typeof syncService.listOnlineFinancialPending>>[number];

export function PendingFinancialOperations({ kind, onConfirmed }: { kind?: 'credit_purchase' | 'supplier_payment'; onConfirmed?: (result: any) => void }) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [discarding, setDiscarding] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const accountId = useAuthStore(state => state.accountId);
  const userId = useAuthStore(state => state.subUser?.id);
  const refresh = useCallback(async () => {
    const all = await syncService.listOnlineFinancialPending();
    setRows(all.filter(row => row.account_id === accountId && row.user_id === userId && (!kind || row.entity_type === kind)));
  }, [accountId, userId, kind]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  if (!rows.length) return null;

  return <Card style={{ marginBottom: 12, backgroundColor: ui.colors.surface }}><Card.Content>
    <Text variant="titleMedium">Operaciones por confirmar</Text>
    <Text>Una respuesta perdida puede corresponder a una operación ya aplicada. Reintenta el mismo registro antes de crear otro.</Text>
    {rows.map(row => {
      const data = JSON.parse(row.data || '{}');
      return <View key={row.id} style={{ borderTopWidth: 1, borderColor: ui.colors.border, paddingTop: 10, marginTop: 10 }}>
        <Text>{row.entity_type === 'credit_purchase' ? 'Compra a crédito' : 'Pago a proveedor'} · {row.status}</Text>
        {data.lastErrorMessage ? <Text style={{ color: ui.colors.danger }}>{data.lastErrorMessage}</Text> : null}
        <Button disabled={busy !== null} loading={busy === row.id} onPress={() => void (async () => {
          setBusy(row.id);
          try {
            const result = await syncService.retryOnlineFinancial(row.id);
            if (result.confirmed) { Alert.alert('Confirmado', 'La operación quedó registrada en el servidor.'); onConfirmed?.(result.result); }
            else Alert.alert('Pendiente', result.error || 'Aún no se pudo confirmar. Reintenta con conexión.');
          } catch (error) { Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo reintentar.'); }
          finally { setBusy(null); await refresh(); }
        })()}>Reintentar confirmación</Button>
        {data.rejectedAt && <>
          {discarding === row.id && <TextInput label="Motivo para descartar" value={reason} onChangeText={setReason} mode="outlined" />}
          <Button disabled={busy !== null} onPress={() => {
            if (discarding !== row.id) { setDiscarding(row.id); setReason(''); return; }
            if (!reason.trim()) { Alert.alert('Error', 'Escribe el motivo.'); return; }
            void (async () => {
              setBusy(row.id);
              try { await syncService.discardRejectedOnlineFinancial(row.id, reason); setDiscarding(null); setReason(''); }
              catch (error) { Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo descartar.'); }
              finally { setBusy(null); await refresh(); }
            })();
          }}>Descartar operación rechazada</Button>
        </>}
      </View>;
    })}
  </Card.Content></Card>;
}
