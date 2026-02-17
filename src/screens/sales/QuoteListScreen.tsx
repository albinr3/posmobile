import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert, Share } from 'react-native';
import { Searchbar, Text, Chip, Icon } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { SafeAreaView } from '../../components/SafeAreaView';
import { db } from '../../database/Database';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { syncService } from '../../services/sync/SyncService';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';

interface QuoteListItem {
  localId: string;
  quoteCode: string;
  customerName: string | null;
  status: string;
  totalCents: number;
  createdAt: number;
  synced: boolean;
  itemsCount: number;
}

const getStatusLabel = (status: string) => {
  if (status === 'sent') return 'Enviada';
  if (status === 'approved') return 'Aprobada';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'draft') return 'Borrador';
  return 'Pendiente';
};

const getStatusStyle = (status: string) => {
  if (status === 'approved') return styles.approvedChip;
  if (status === 'cancelled') return styles.cancelledChip;
  if (status === 'sent') return styles.sentChip;
  return styles.pendingChip;
};

interface QuoteListScreenProps {
  navigation: any;
}

export function QuoteListScreen({ navigation }: QuoteListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'cancelled'>('all');
  const [quotes, setQuotes] = useState<QuoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();
  const { isOnline } = useSyncStore();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const syncAndLoad = async () => {
        await loadQuotes();
        if (!active || !isOnline) return;
        try {
          const clerkToken = await getToken();
          if (!clerkToken || !subUserToken) return;
          syncService.setGetTokenFunction(getToken);
          syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
          await syncService.fullSync(clerkToken);
          if (active) {
            await loadQuotes();
          }
        } catch (error) {
          console.error('Error sincronizando cotizaciones:', error);
        }
      };
      syncAndLoad();
      return () => {
        active = false;
      };
    }, [getToken, isOnline, subUserToken])
  );

  const loadQuotes = async () => {
    try {
      const rows = await db.query<any>('SELECT * FROM quotes ORDER BY created_at DESC');
      const mapped: QuoteListItem[] = rows.map((row) => {
        const parsedData = (() => {
          try {
            return row.data ? JSON.parse(row.data) : null;
          } catch {
            return null;
          }
        })();

        const normalizedStatus = String(row.status || parsedData?.status || 'pending').toLowerCase();
        return {
          localId: String(row.local_id),
          quoteCode: String(row.quote_code || parsedData?.quoteCode || '-'),
          customerName: parsedData?.customerName ? String(parsedData.customerName) : null,
          status: normalizedStatus,
          totalCents: Number(row.total_cents || parsedData?.totalCents || 0),
          createdAt: Number(row.created_at || parsedData?.createdAt || Date.now()),
          synced: row.synced === 1,
          itemsCount: Array.isArray(parsedData?.items) ? parsedData.items.length : 0,
        };
      });
      setQuotes(mapped);
    } catch (error) {
      console.error('Error cargando cotizaciones:', error);
      setQuotes([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadQuotes();
  };

  const filteredQuotes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return quotes.filter((quote) => {
      const matchesSearch =
        !query ||
        quote.quoteCode.toLowerCase().includes(query) ||
        (quote.customerName || '').toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      return quote.status === statusFilter;
    });
  }, [quotes, searchQuery, statusFilter]);

  const totalAmount = filteredQuotes.reduce((sum, quote) => sum + quote.totalCents, 0);

  const getLogoDataUri = async () => {
    try {
      const logoAsset = Asset.fromModule(require('../../../assets/movoLogoDark.png'));
      if (!logoAsset.localUri) {
        await logoAsset.downloadAsync();
      }
      const logoPath = logoAsset.localUri || logoAsset.uri;
      if (!logoPath) return null;
      const base64 = await LegacyFileSystem.readAsStringAsync(logoPath, { encoding: 'base64' as any });
      if (!base64) return null;
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn('No se pudo cargar logo para impresión de cotización:', error);
      return null;
    }
  };

  const buildQuoteHtml = async (quote: QuoteListItem) => {
    const row = await db.queryFirst<any>('SELECT * FROM quotes WHERE local_id = ?', [quote.localId]);
    if (!row) {
      throw new Error('No se encontró la cotización.');
    }
    let parsedData: any = null;
    try {
      parsedData = row.data ? JSON.parse(row.data) : null;
    } catch {
      parsedData = null;
    }

    const items = Array.isArray(parsedData?.items) ? parsedData.items : [];
    const totalCents = Number(row.total_cents || parsedData?.totalCents || 0);
    const createdAt = Number(row.created_at || parsedData?.createdAt || Date.now());
    const quoteCode = String(row.quote_code || parsedData?.quoteCode || quote.quoteCode || '-');
    const customerName = parsedData?.customerName || quote.customerName || '(General) Cliente general';
    const subtotalCents = Math.round(totalCents / 1.18);
    const itbisCents = totalCents - subtotalCents;
    const logoDataUri = await getLogoDataUri();

    const itemsRows = items
      .map(
        (item: any) => `
          <div class="item">
            <div><strong>${String(item.productName || 'Producto')}</strong></div>
            <div class="row">
              <span>${Number(item.quantity || item.qty || 0)} x ${formatCurrency(Number(item.priceCents || item.unitPriceCents || 0))}</span>
              <span><strong>${formatCurrency(Number(item.totalCents || 0))}</strong></span>
            </div>
          </div>
        `
      )
      .join('');

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            @page { size: 80mm auto; margin: 0; }
            body { font-family: Arial, sans-serif; margin: 0; }
            .ticket { width: 80mm; padding: 10px; font-size: 13px; color: #000; }
            .brand { text-align: center; margin-bottom: 6px; }
            .logo { height: 28px; width: auto; }
            .row { display: flex; justify-content: space-between; margin: 3px 0; }
            .sep { border-top: 1px dashed #444; margin: 7px 0; }
            .item { border-bottom: 1px dashed #d1d5db; padding-bottom: 6px; margin-bottom: 6px; }
            .total { font-size: 17px; font-weight: 800; margin-top: 6px; }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="brand">
              ${
                logoDataUri
                  ? `<img src="${logoDataUri}" class="logo" />`
                  : '<div style="font-weight:800;">MOVOpos</div>'
              }
            </div>
            <div class="row"><span>Cotización:</span><span><strong>${quoteCode}</strong></span></div>
            <div class="row"><span>Fecha:</span><span>${formatDateTime(createdAt)}</span></div>
            <div style="margin-top:4px;"><strong>Cliente:</strong> ${customerName}</div>
            <div class="sep"></div>
            <div>${itemsRows}</div>
            <div class="row"><span>Subtotal</span><span>${formatCurrency(subtotalCents)}</span></div>
            <div class="row"><span>ITBIS (18%)</span><span>${formatCurrency(itbisCents)}</span></div>
            <div class="row total"><span>TOTAL</span><span>${formatCurrency(totalCents)}</span></div>
          </div>
        </body>
      </html>
    `;

    return { html, quoteCode };
  };

  const handlePrintQuote = async (quote: QuoteListItem) => {
    try {
      const { html } = await buildQuoteHtml(quote);
      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error imprimiendo cotización:', error);
      Alert.alert('Error', 'No se pudo abrir la impresión de la cotización.');
    }
  };

  const handleShareQuotePdf = async (quote: QuoteListItem) => {
    try {
      const { html, quoteCode } = await buildQuoteHtml(quote);
      const pdf = await Print.printToFileAsync({ html });
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (sharingAvailable) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Cotización ${quoteCode}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Share.share({
          title: `Cotización ${quoteCode}`,
          message: `Cotización ${quoteCode}`,
          url: pdf.uri,
        });
      }
    } catch (error) {
      console.error('Error compartiendo cotización PDF:', error);
      Alert.alert('Error', 'No se pudo compartir la cotización en PDF.');
    }
  };

  const handleOpenEdit = async (quote: QuoteListItem) => {
    try {
      const row = await db.queryFirst<any>('SELECT local_id FROM quotes WHERE local_id = ?', [quote.localId]);
      if (!row) {
        Alert.alert('Cotización', 'No se encontró la cotización.');
        return;
      }

      navigation.navigate('Quotes', {
        screen: 'QuoteMain',
        params: { editQuoteLocalId: quote.localId, editNonce: Date.now() },
      });
    } catch (error) {
      console.error('Error abriendo edición de cotización:', error);
      Alert.alert('Error', 'No se pudo abrir la cotización en edición.');
    }
  };

  const renderQuote = ({ item }: { item: QuoteListItem }) => (
    <View style={styles.quoteCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.quoteCode}>{item.quoteCode}</Text>
        <Chip compact style={getStatusStyle(item.status)} textStyle={styles.statusChipText}>
          {getStatusLabel(item.status)}
        </Chip>
      </View>

      <Text style={styles.meta}>Cliente: {item.customerName || 'Cliente general'}</Text>
      <Text style={styles.meta}>Fecha: {formatDateTime(item.createdAt)}</Text>
      <Text style={styles.meta}>Items: {item.itemsCount}</Text>

      <View style={styles.footerRow}>
        <Text style={styles.syncText}>{item.synced ? 'Sincronizada' : 'Pendiente de sync'}</Text>
        <Text style={styles.totalValue}>{formatCurrency(item.totalCents)}</Text>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionIconButton, styles.printButton]} onPress={() => handlePrintQuote(item)}>
          <Icon source="printer" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionIconButton, styles.shareButton]} onPress={() => handleShareQuotePdf(item)}>
          <Icon source="share-variant" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionIconButton, styles.editButton]} onPress={() => handleOpenEdit(item)}>
          <Icon source="pencil" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lista de Cotizaciones</Text>
        <Text style={styles.summaryLabel}>Total en vista</Text>
        <Text style={styles.summaryValue}>{formatCurrency(totalAmount)}</Text>
        <Text style={styles.summarySub}>{filteredQuotes.length} cotizaciones</Text>

        <View style={styles.searchWrap}>
          <Searchbar
            placeholder="Buscar por código o cliente..."
            placeholderTextColor="#B8B2C8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchbar}
            inputStyle={styles.searchInput}
          />
        </View>

        <View style={styles.filterContainer}>
          <Chip
            selected={statusFilter === 'all'}
            onPress={() => setStatusFilter('all')}
            style={[styles.filterChip, statusFilter === 'all' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'all' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Todas
          </Chip>
          <Chip
            selected={statusFilter === 'pending'}
            onPress={() => setStatusFilter('pending')}
            style={[styles.filterChip, statusFilter === 'pending' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'pending' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Pendientes
          </Chip>
          <Chip
            selected={statusFilter === 'approved'}
            onPress={() => setStatusFilter('approved')}
            style={[styles.filterChip, statusFilter === 'approved' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'approved' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Aprobadas
          </Chip>
          <Chip
            selected={statusFilter === 'cancelled'}
            onPress={() => setStatusFilter('cancelled')}
            style={[styles.filterChip, statusFilter === 'cancelled' && styles.filterChipSelected]}
            textStyle={[styles.filterChipText, statusFilter === 'cancelled' && styles.filterChipTextSelected]}
            showSelectedOverlay={false}
          >
            Canceladas
          </Chip>
        </View>
      </View>

      <FlatList
        data={filteredQuotes}
        renderItem={renderQuote}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ui.colors.primary]} tintColor={ui.colors.primary} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{loading ? 'Cargando cotizaciones...' : 'No hay cotizaciones'}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  header: {
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomLeftRadius: ui.radius.xl,
    borderBottomRightRadius: ui.radius.xl,
  },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  summaryLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  summaryValue: { color: '#fff', fontSize: 33, fontWeight: '800', marginTop: 3, marginBottom: 1 },
  summarySub: { color: 'rgba(255,255,255,0.82)', marginTop: 2, fontSize: 12 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: ui.radius.md,
    paddingLeft: 2,
    marginTop: 8,
    marginBottom: 10,
  },
  searchbar: { flex: 1, borderRadius: ui.radius.md, backgroundColor: 'transparent', elevation: 0 },
  searchInput: { minHeight: 40 },
  filterContainer: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterChip: { height: 32, borderRadius: ui.radius.md, backgroundColor: 'rgba(255,255,255,0.2)' },
  filterChipSelected: { backgroundColor: '#fff' },
  filterChipText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },
  filterChipTextSelected: { color: ui.colors.primary, fontWeight: '700' },
  listContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  quoteCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  quoteCode: { color: ui.colors.text, fontWeight: '800', fontSize: 15, flex: 1, marginRight: 8 },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  pendingChip: { backgroundColor: '#FEF3C7' },
  approvedChip: { backgroundColor: '#DCFCE7' },
  cancelledChip: { backgroundColor: '#FEE2E2' },
  sentChip: { backgroundColor: '#DBEAFE' },
  meta: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 2 },
  footerRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  syncText: { color: ui.colors.textMuted, fontSize: 11, fontWeight: '700' },
  totalValue: { color: ui.colors.text, fontWeight: '800', fontSize: 16 },
  actionsRow: { marginTop: 10, flexDirection: 'row', gap: 20, alignItems: 'center' },
  actionIconButton: {
    width: 46,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printButton: { backgroundColor: '#22C55E' },
  shareButton: { backgroundColor: '#0EA5E9' },
  editButton: { backgroundColor: '#3B82F6' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  emptyText: { color: ui.colors.textMuted },
});
