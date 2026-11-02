import React, { useCallback, useRef, useState } from 'react';
import { FlatList, RefreshControl, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Chip, Menu, Searchbar, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { PendingFinancialOperations } from '../../components/PendingFinancialOperations';
import { purchaseCreditService, type Payable, type PayablesPage, type PayableStatus } from '../../services/purchases/purchaseCreditService';
import { useSyncStore } from '../../store/syncStore';
import { formatCurrency } from '../../utils/helpers';
import { ui } from '../../theme/ui';

const EMPTY: PayablesPage = { data: [], nextSkip: null, summary: { count: 0, totalCents: 0, balanceCents: 0, overdueCents: 0 }, providers: [] };

export function AccountsPayableScreen({ navigation }: { navigation: any }) {
  const [page, setPage] = useState<PayablesPage>(EMPTY);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PayableStatus | ''>('');
  const [overdue, setOverdue] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusMenu, setStatusMenu] = useState(false);
  const requestVersion = useRef(0);
  const isOnline = useSyncStore(state => state.isOnline);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!isOnline) { setPage(EMPTY); setBusy(false); setError('Conéctate para consultar los saldos actuales.'); return; }
    setBusy(true);
    try { const next = await purchaseCreditService.listPayables(filters, skip); if (version === requestVersion.current) { setPage(next); setError(''); } }
    catch (cause) { if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las cuentas.'); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }, [filters, skip, isOnline]);
  useFocusEffect(useCallback(() => { void load(); return () => { requestVersion.current += 1; }; }, [load]));

  const apply = (nextSupplierId = supplierId) => {
    setSkip(0);
    setFilters({ ...(query.trim() ? { query: query.trim() } : {}), ...(nextSupplierId ? { supplierId: nextSupplierId } : {}),
      ...(status ? { status } : {}), ...(overdue ? { overdue: 'true' } : {}) });
  };
  const clear = () => { setQuery(''); setStatus(''); setOverdue(false); setSupplierId(''); setSkip(0); setFilters({}); };

  const render = ({ item }: { item: Payable }) => <TouchableOpacity onPress={() => navigation.navigate('PayableDetail', { payableId: item.id })}>
    <Card style={{ marginHorizontal: 14, marginBottom: 10, backgroundColor: ui.colors.surface }}><Card.Content>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <Text variant="titleMedium" style={{ flex: 1 }}>{item.purchase.supplierName || item.supplier.name}</Text>
        <Chip compact>{item.status}</Chip>
      </View>
      {!item.supplier.isActive && <Text>Proveedor inactivo</Text>}
      <Text>Compra {item.purchaseId.slice(-8)} · Vence {item.dueDate}</Text>
      {item.overdue && <Text style={{ color: ui.colors.danger }}>{item.overdueDays} días de atraso</Text>}
      <Text>Total: {formatCurrency(item.totalCents)}</Text>
      <Text>Abonado: {formatCurrency(item.paidCents)}</Text>
      <Text variant="titleSmall">Pendiente: {formatCurrency(item.balanceCents)}</Text>
    </Card.Content></Card>
  </TouchableOpacity>;

  return <SafeAreaView style={{ flex: 1, backgroundColor: ui.colors.background }} edges={['bottom']}>
    <FlatList data={page.data} keyExtractor={item => item.id} renderItem={render}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void load()} tintColor={ui.colors.primary} />}
      ListHeaderComponent={<View style={{ padding: 14, gap: 10 }}>
        <Text variant="headlineSmall">Cuentas por pagar</Text>
        <PendingFinancialOperations onConfirmed={() => void load()} />
        {!!error && <Text style={{ color: ui.colors.danger }}>{error}</Text>}
        <Card style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text>Pendiente actual: {formatCurrency(page.summary.balanceCents)}</Text>
          <Text>Vencido actual: {formatCurrency(page.summary.overdueCents)}</Text>
          <Text>Total original: {formatCurrency(page.summary.totalCents)}</Text>
        </Card.Content></Card>
        <Searchbar placeholder="Proveedor o compra" value={query} onChangeText={setQuery} />
        <Menu visible={statusMenu} onDismiss={() => setStatusMenu(false)} anchor={<Button mode="outlined" onPress={() => setStatusMenu(true)}>Estado: {status || 'Todos'}</Button>}>
          {(['', 'PENDIENTE', 'PARCIAL', 'PAGADA'] as const).map(value => <Menu.Item key={value || 'ALL'} title={value || 'Todos'} onPress={() => { setStatus(value); setStatusMenu(false); }} />)}
        </Menu>
        <Button mode={overdue ? 'contained' : 'outlined'} onPress={() => setOverdue(value => !value)}>Solo vencidas</Button>
        <View style={{ flexDirection: 'row', gap: 8 }}><Button mode="contained" onPress={() => apply()}>Filtrar</Button><Button mode="outlined" onPress={clear}>Limpiar</Button></View>
        {!!page.providers.length && <Card style={{ backgroundColor: ui.colors.surface }}><Card.Content>
          <Text variant="titleMedium">Resumen por proveedor</Text>
          {page.providers.map(provider => <Button key={provider.supplierId} compact onPress={() => { setSupplierId(provider.supplierId); apply(provider.supplierId); }}>
            {provider.name}: {formatCurrency(provider.balanceCents)}
          </Button>)}
        </Card.Content></Card>}
        <Text>{page.summary.count} cuentas</Text>
      </View>}
      ListEmptyComponent={<Text style={{ padding: 20 }}>{busy ? 'Cargando...' : 'No hay cuentas para estos filtros.'}</Text>}
      ListFooterComponent={<View style={{ flexDirection: 'row', justifyContent: 'center', padding: 14, gap: 8 }}>
        <Button mode="outlined" disabled={skip === 0 || busy} onPress={() => setSkip(Math.max(0, skip - 50))}>Anterior</Button>
        <Button mode="outlined" disabled={page.nextSkip === null || busy} onPress={() => setSkip(page.nextSkip!)}>Siguiente</Button>
      </View>} />
  </SafeAreaView>;
}
