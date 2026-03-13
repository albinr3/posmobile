import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { formatCurrency } from '../../utils/helpers';
import { formatPaymentWithBank } from '../../utils/paymentMethods';
import { formatProductQty } from '../../utils/productUnits';
import { SalePaymentSplit } from '../../types';

interface StoredPrinter {
  id?: string;
  name?: string;
  address?: string;
  connected?: boolean;
}

interface TicketItem {
  productName: string;
  quantity: number;
  priceCents: number;
  totalCents: number;
  unit?: string;
}

interface SaleTicketPayload {
  invoiceCode: string;
  createdAt: number;
  customerName?: string | null;
  paymentMethod?: string | null;
  transferBankName?: string | null;
  paymentSplits?: SalePaymentSplit[];
  totalCents: number;
  items: TicketItem[];
}

type PrintResultReason =
  | 'disabled'
  | 'missing_config'
  | 'missing_native_module'
  | 'native_error';

export interface ThermalPrintResult {
  printed: boolean;
  reason?: PrintResultReason;
  message?: string;
}

const readPrinterSettings = async (): Promise<{ autoPrint: boolean; printer: StoredPrinter | null }> => {
  const [savedAutoPrint, savedPrinter] = await Promise.all([
    AsyncStorage.getItem('auto_print'),
    AsyncStorage.getItem('connected_printer'),
  ]);

  let parsedPrinter: StoredPrinter | null = null;
  if (savedPrinter) {
    try {
      parsedPrinter = JSON.parse(savedPrinter);
    } catch {
      parsedPrinter = null;
    }
  }

  return {
    autoPrint: savedAutoPrint === 'true',
    printer: parsedPrinter,
  };
};

const buildSaleTicketText = (payload: SaleTicketPayload): string => {
  const paymentSummary = payload.paymentMethod === 'DIVIDIR_PAGO'
    ? (payload.paymentSplits || [])
      .map((split) => `${formatPaymentWithBank(split.method, split.transferBankName)} ${formatCurrency(split.amountCents)}`)
      .join(' + ')
    : formatPaymentWithBank(payload.paymentMethod, payload.transferBankName);

  const lines: string[] = [
    'MOVOPOS',
    '-------------------------------',
    `Factura: ${payload.invoiceCode}`,
    `Fecha: ${new Date(payload.createdAt).toLocaleString('es-DO')}`,
    `Cliente: ${payload.customerName || 'Cliente general'}`,
    `Pago: ${paymentSummary || '-'}`,
    '-------------------------------',
  ];

  for (const item of payload.items || []) {
    lines.push(`${item.productName}`);
    lines.push(`  ${formatProductQty(item.quantity, item.unit || 'UNIDAD')} x ${formatCurrency(item.priceCents)} = ${formatCurrency(item.totalCents)}`);
  }

  lines.push('-------------------------------');
  lines.push(`TOTAL: ${formatCurrency(payload.totalCents)}`);
  lines.push('Gracias por su compra');
  lines.push('\n\n\n');

  return lines.join('\n');
};

export const autoPrintSaleTicket = async (payload: SaleTicketPayload): Promise<ThermalPrintResult> => {
  const { autoPrint, printer } = await readPrinterSettings();
  if (!autoPrint) {
    return { printed: false, reason: 'disabled' };
  }
  if (!printer?.address) {
    return { printed: false, reason: 'missing_config', message: 'No hay una impresora conectada en Ajustes.' };
  }

  const bluetoothManager = (NativeModules as any)?.BluetoothManager;
  const escposPrinter = (NativeModules as any)?.BluetoothEscposPrinter;
  if (!bluetoothManager || !escposPrinter) {
    return {
      printed: false,
      reason: 'missing_native_module',
      message: 'La impresion termica directa requiere un build nativo con modulo ESC/POS.',
    };
  }

  try {
    if (typeof bluetoothManager.connect === 'function') {
      try {
        await bluetoothManager.connect(printer.address);
      } catch (connectError: any) {
        const msg = String(connectError?.message || connectError || '').toLowerCase();
        if (!msg.includes('already')) {
          throw connectError;
        }
      }
    }

    if (typeof escposPrinter.printerInit === 'function') {
      await escposPrinter.printerInit();
    }

    const text = buildSaleTicketText(payload);
    await escposPrinter.printText(text, {});

    return { printed: true };
  } catch (error: any) {
    return {
      printed: false,
      reason: 'native_error',
      message: String(error?.message || 'No se pudo imprimir en la termica.'),
    };
  }
};
