import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Share, Alert } from 'react-native';
import { Text, Surface, Button, Divider } from 'react-native-paper';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { SafeAreaView } from '../../components/SafeAreaView';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { ui } from '../../theme/ui';
import { formatProductQty } from '../../utils/productUnits';
import { hasConnectedPrinter, printReturnTicketDirect } from '../../services/printing/thermalPrinterService';

interface ReturnReceiptItem {
  productName: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  unit?: string | null;
}

interface ReturnReceiptPayload {
  returnId?: string;
  returnCode: string;
  returnedAt: number;
  invoiceCode: string;
  customerName: string;
  totalCents: number;
  notes?: string | null;
  items: ReturnReceiptItem[];
}

interface ReturnReceiptScreenProps {
  navigation: any;
  route?: {
    params?: {
      receipt?: ReturnReceiptPayload;
      autoPrint?: boolean;
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

const buildReturnReceiptHtml = (receipt: ReturnReceiptPayload, logoUri: string) => {
  const itemsRows = (receipt.items || [])
    .map(
      (item) => `
        <div class="item">
          <div class="item-name">${escapeHtml(item.productName)}</div>
          <div class="item-line">
            <span>${formatProductQty(item.qty, item.unit)} x ${formatCurrency(item.unitPriceCents)}</span>
            <span class="item-total">${formatCurrency(item.lineTotalCents)}</span>
          </div>
        </div>
      `
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: 80mm auto; margin: 0; }
          body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #000; background: #fff; }
          .ticket { width: 80mm; margin: 0 auto; padding: 10px 10px 14px; font-size: 14px; line-height: 1.25; }
          .brand { text-align: center; margin-bottom: 6px; }
          .logo { height: 28px; width: auto; }
          .title { text-align: center; font-size: 16px; font-weight: 800; margin-bottom: 6px; }
          .sep { border-top: 1px dashed #444; border-bottom: 1px dashed #444; padding: 7px 0; margin: 7px 0; }
          .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
          .item { border-bottom: 1px dashed #c4c4c4; padding-bottom: 7px; margin-bottom: 7px; }
          .item-name { font-weight: 700; }
          .item-line { display: flex; justify-content: space-between; margin-top: 4px; }
          .item-total { font-weight: 700; }
          .total { border-top: 1px dashed #444; padding-top: 7px; margin-top: 6px; font-size: 18px; font-weight: 800; display: flex; justify-content: space-between; }
          .notes { margin-top: 8px; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="brand">
            <img src="${escapeHtml(logoUri)}" class="logo" />
          </div>
          <div class="title">COMPROBANTE DE DEVOLUCION</div>
          <div class="sep">
            <div class="row"><span>Devolucion:</span><span><strong>${escapeHtml(receipt.returnCode)}</strong></span></div>
            <div class="row"><span>Fecha:</span><span>${escapeHtml(formatDateTime(receipt.returnedAt))}</span></div>
            <div class="row"><span>Factura:</span><span>${escapeHtml(receipt.invoiceCode || '-')}</span></div>
            <div style="margin-top:4px;"><strong>Cliente:</strong> ${escapeHtml(receipt.customerName || 'Cliente general')}</div>
          </div>
          <div>${itemsRows}</div>
          <div class="total"><span>TOTAL DEVUELTO</span><span>${formatCurrency(receipt.totalCents)}</span></div>
          ${receipt.notes ? `<div class="notes"><strong>Notas:</strong> ${escapeHtml(receipt.notes)}</div>` : ''}
        </div>
      </body>
    </html>
  `;
};

export function ReturnReceiptScreen({ navigation, route }: ReturnReceiptScreenProps) {
  const receipt = route?.params?.receipt;
  const autoPrint = route?.params?.autoPrint === true;
  const logoUri = Asset.fromModule(require('../../../assets/movoLogoDark.png')).uri;
  const [autoPrintDone, setAutoPrintDone] = useState(false);

  const html = useMemo(() => (receipt ? buildReturnReceiptHtml(receipt, logoUri) : ''), [receipt, logoUri]);

  const handlePrint = useCallback(async () => {
    if (!html) return;
    try {
      const shouldAttemptPrint = await hasConnectedPrinter();
      if (!shouldAttemptPrint) {
        Alert.alert('Impresión', 'No hay una impresora conectada en Ajustes.');
        return;
      }

      if (receipt) {
        const printResult = await printReturnTicketDirect({
          returnCode: receipt.returnCode,
          returnedAt: receipt.returnedAt,
          invoiceCode: receipt.invoiceCode || '-',
          customerName: receipt.customerName || 'Cliente general',
          totalCents: receipt.totalCents,
          notes: receipt.notes || null,
          items: (receipt.items || []).map((item) => ({
            productName: item.productName,
            qty: Number(item.qty || 0),
            unitPriceCents: Number(item.unitPriceCents || 0),
            lineTotalCents: Number(item.lineTotalCents || 0),
            unit: item.unit || 'UNIDAD',
          })),
        });

        if (printResult.printed) return;
      }

      await Print.printAsync({ html });
    } catch (error) {
      console.error('Error imprimiendo devolución:', error);
      Alert.alert('Error', 'No se pudo abrir la vista de impresión.');
    }
  }, [html, receipt]);

  const handleShare = useCallback(async () => {
    if (!html || !receipt) return;
    try {
      const pdf = await Print.printToFileAsync({ html });
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (sharingAvailable) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Devolución ${receipt.returnCode}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Share.share({
          title: `Devolución ${receipt.returnCode}`,
          message: `Devolución ${receipt.returnCode}`,
          url: pdf.uri,
        });
      }
    } catch (error) {
      console.error('Error compartiendo devolución:', error);
      Alert.alert('Error', 'No se pudo abrir el menú para compartir.');
    }
  }, [html, receipt]);

  useEffect(() => {
    if (!autoPrint || autoPrintDone || !html) return;
    setAutoPrintDone(true);
    void handlePrint();
  }, [autoPrint, autoPrintDone, html, handlePrint]);

  if (!receipt) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <Text>Comprobante no disponible</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Surface style={styles.receiptCard}>
          <View style={styles.successIcon}>
            <Text style={styles.checkmark}>✓</Text>
          </View>

          <Text style={styles.successText}>¡Devolución Registrada!</Text>

          <Divider style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.label}>Devolución:</Text>
            <Text style={styles.value}>{receipt.returnCode}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Factura:</Text>
            <Text style={styles.value}>{receipt.invoiceCode || '-'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Fecha:</Text>
            <Text style={styles.value}>{formatDateTime(receipt.returnedAt)}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Cliente:</Text>
            <Text style={styles.value}>{receipt.customerName || 'Cliente general'}</Text>
          </View>

          {receipt.notes ? (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Notas:</Text>
              <Text style={styles.value}>{receipt.notes}</Text>
            </View>
          ) : null}

          <Divider style={styles.divider} />

          <Text style={styles.sectionTitle}>Productos</Text>
          {(receipt.items || []).map((item, index) => (
            <View key={`${item.productName}-${index}`} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.productName}</Text>
                <Text style={styles.itemQty}>
                  {formatProductQty(item.qty, item.unit)} x {formatCurrency(item.unitPriceCents)}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{formatCurrency(item.lineTotalCents)}</Text>
            </View>
          ))}

          <Divider style={styles.divider} />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total devuelto</Text>
            <Text style={styles.totalValue}>{formatCurrency(receipt.totalCents)}</Text>
          </View>
        </Surface>

        <View style={styles.actions}>
          <Button mode="outlined" icon="share-variant" onPress={handleShare} style={styles.actionButton} textColor={ui.colors.primary}>
            Compartir
          </Button>

          <Button mode="outlined" icon="printer" onPress={handlePrint} style={styles.actionButton} textColor={ui.colors.primary}>
            Imprimir
          </Button>
        </View>

        <Button
          mode="contained"
          icon="arrow-left"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          contentStyle={styles.backButtonContent}
          buttonColor={ui.colors.primary}
          textColor="#fff"
        >
          Volver a devoluciones
        </Button>
      </ScrollView>
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
    padding: 16,
  },
  receiptCard: {
    padding: 20,
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    elevation: 2,
  },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ui.colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  checkmark: {
    fontSize: 32,
    color: '#fff',
  },
  successText: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
    color: ui.colors.text,
  },
  divider: {
    marginVertical: 16,
    backgroundColor: ui.colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  label: {
    fontSize: 14,
    color: ui.colors.textMuted,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
    color: ui.colors.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: ui.colors.text,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    color: ui.colors.text,
  },
  itemQty: {
    fontSize: 12,
    color: ui.colors.textMuted,
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '500',
    color: ui.colors.text,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderColor: ui.colors.primary,
  },
  backButton: {
    marginTop: 16,
  },
  backButtonContent: {
    paddingVertical: 8,
  },
});
