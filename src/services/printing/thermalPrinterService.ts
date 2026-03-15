import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { formatCurrency } from '../../utils/helpers';
import { formatPaymentWithBank } from '../../utils/paymentMethods';
import { formatProductQty } from '../../utils/productUnits';
import { SalePaymentSplit } from '../../types';
import {
  getBlePrinterMissingModuleMessage,
  isBlePrinterModuleAvailable,
  printBleImageBase64,
  printBleText,
} from './blePrinterService';

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
  reference?: string | null;
  productId?: string | null;
  sku?: string | null;
}

export interface PaymentReceiptTicketPayload {
  receiptCode: string;
  createdAt: number;
  customerName?: string | null;
  invoiceCode?: string | null;
  paymentMethod?: string | null;
  transferBankName?: string | null;
  reference?: string | null;
  notes?: string | null;
  amountCents: number;
  cancelledAt?: number | null;
}

export interface SaleTicketPayload {
  invoiceCode: string;
  createdAt: number;
  customerName?: string | null;
  paymentMethod?: string | null;
  transferBankName?: string | null;
  paymentSplits?: SalePaymentSplit[];
  type?: string | null;
  dueDate?: number | null;
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

interface CompanyTicketHeader {
  name: string;
  phone: string;
  address: string;
  logoUrl?: string | null;
}

export const COMPANY_SETTINGS_SNAPSHOT_KEY = 'movopos_company_settings_snapshot_v1';
export const PAPER_SIZE_KEY = 'printer_paper_size_mm';

type PaperSizeMm = '58' | '80';

const getPaperColumns = (paperSize: PaperSizeMm): number => (paperSize === '80' ? 48 : 32);

const fitColumn = (value: string, max: number): string => {
  const txt = String(value || '');
  if (txt.length <= max) return txt;
  return `${txt.slice(0, Math.max(0, max - 1))}…`;
};

const formatColumns = (left: string, right: string, width: number): string => {
  const safeRight = String(right || '');
  const maxLeft = Math.max(1, width - safeRight.length - 1);
  const safeLeft = fitColumn(left, maxLeft);
  const spaces = Math.max(1, width - safeLeft.length - safeRight.length);
  return `${safeLeft}${' '.repeat(spaces)}${safeRight}`;
};

const readPrinterSettings = async (): Promise<{ autoPrint: boolean; printer: StoredPrinter | null; paperSize: PaperSizeMm }> => {
  const [savedAutoPrint, savedPrinter, savedPaperSize] = await Promise.all([
    AsyncStorage.getItem('auto_print'),
    AsyncStorage.getItem('connected_printer'),
    AsyncStorage.getItem(PAPER_SIZE_KEY),
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
    paperSize: savedPaperSize === '80' ? '80' : '58',
  };
};

export const buildSaleTicketText = (
  payload: SaleTicketPayload,
  companyHeader?: CompanyTicketHeader,
  paperSize: PaperSizeMm = '58'
): string => {
  const width = getPaperColumns(paperSize);
  const separator = '-'.repeat(width);
  const resolvedCompanyHeader: CompanyTicketHeader = {
    name: String(companyHeader?.name || 'MOVOpos').trim() || 'MOVOpos',
    phone: String(companyHeader?.phone || '').trim(),
    address: String(companyHeader?.address || '').trim(),
  };

  const paymentSummary = payload.paymentMethod === 'DIVIDIR_PAGO'
    ? (payload.paymentSplits || [])
      .map((split) => `${formatPaymentWithBank(split.method, split.transferBankName)} ${formatCurrency(split.amountCents)}`)
      .join(' + ')
    : formatPaymentWithBank(payload.paymentMethod, payload.transferBankName);
  const isCreditSale =
    String(payload.type || '').toUpperCase() === 'CREDITO' ||
    String(payload.paymentMethod || '').toUpperCase() === 'CREDITO';

  const lines: string[] = [
    resolvedCompanyHeader.name,
    resolvedCompanyHeader.address || '-',
    resolvedCompanyHeader.phone || '-',
    separator,
    `Factura: ${payload.invoiceCode}`,
    `Fecha: ${new Date(payload.createdAt).toLocaleString('es-DO')}`,
    `Cliente: ${payload.customerName || 'Cliente general'}`,
    `Tipo: ${isCreditSale ? 'CREDITO' : 'CONTADO'}`,
    `Pago: ${paymentSummary || '-'}`,
    separator,
  ];

  for (const item of payload.items || []) {
    const productReference = String(item.reference || item.sku || item.productId || '').trim() || '-';
    lines.push(`${item.productName} | ${productReference}`);
    lines.push(`  ${formatColumns(`${formatProductQty(item.quantity, item.unit || 'UNIDAD')} x ${formatCurrency(item.priceCents)}`, formatCurrency(item.totalCents), width - 2)}`);
  }

  lines.push(separator);
  lines.push(formatColumns('TOTAL', formatCurrency(payload.totalCents), width));
  if (isCreditSale) {
    lines.push('VENTA A CREDITO');
    if (Number.isFinite(Number(payload.dueDate || NaN))) {
      lines.push(`Vence: ${new Date(Number(payload.dueDate)).toLocaleDateString('es-DO')}`);
    }
    lines.push('');
    lines.push('Firma cliente:');
    lines.push('______________________________');
  }
  lines.push('Gracias por su compra');
  lines.push('\n\n\n');

  return lines.join('\n');
};

export const buildPaymentReceiptTicketText = (
  payload: PaymentReceiptTicketPayload,
  companyHeader?: CompanyTicketHeader,
  paperSize: PaperSizeMm = '58'
): string => {
  const width = getPaperColumns(paperSize);
  const separator = '-'.repeat(width);
  const resolvedCompanyHeader: CompanyTicketHeader = {
    name: String(companyHeader?.name || 'MOVOpos').trim() || 'MOVOpos',
    phone: String(companyHeader?.phone || '').trim(),
    address: String(companyHeader?.address || '').trim(),
  };

  const paymentLabel = formatPaymentWithBank(payload.paymentMethod || 'EFECTIVO', payload.transferBankName || null);
  const lines: string[] = [
    resolvedCompanyHeader.name,
    resolvedCompanyHeader.address || '-',
    resolvedCompanyHeader.phone || '-',
    separator,
    'RECIBO DE PAGO',
    `Recibo: ${payload.receiptCode}`,
    `Fecha: ${new Date(payload.createdAt).toLocaleString('es-DO')}`,
    `Cliente: ${payload.customerName || 'Cliente general'}`,
    `Factura: ${payload.invoiceCode || '-'}`,
    `Metodo: ${paymentLabel || '-'}`,
    `Referencia: ${payload.reference || '-'}`,
  ];

  if (payload.notes) {
    lines.push(`Notas: ${payload.notes}`);
  }

  lines.push(separator);
  lines.push(formatColumns('TOTAL PAGADO', formatCurrency(payload.amountCents), width));
  if (payload.cancelledAt) {
    lines.push('RECIBO CANCELADO');
  }
  lines.push('Gracias por su pago');
  lines.push('\n\n\n');

  return lines.join('\n');
};

const readCompanyTicketHeader = async (): Promise<CompanyTicketHeader> => {
  try {
    const raw = await AsyncStorage.getItem(COMPANY_SETTINGS_SNAPSHOT_KEY);
    if (!raw) {
      return { name: 'MOVOpos', phone: '', address: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      name: String(parsed?.name || 'MOVOpos').trim() || 'MOVOpos',
      phone: String(parsed?.phone || '').trim(),
      address: String(parsed?.address || '').trim(),
      logoUrl: String(parsed?.logoUrl || '').trim() || null,
    };
  } catch {
    return { name: 'MOVOpos', phone: '', address: '' };
  }
};

const resolveLogoBase64 = async (logoUrl: string | null | undefined): Promise<string | null> => {
  const source = String(logoUrl || '').trim();
  if (!source) return null;

  if (source.startsWith('data:image') && source.includes('base64,')) {
    const rawBase64 = source.split('base64,')[1] || '';
    return rawBase64.trim() || null;
  }

  if (source.startsWith('file://')) {
    try {
      const fileBase64 = await LegacyFileSystem.readAsStringAsync(source, { encoding: 'base64' as any });
      return fileBase64 || null;
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(source)) {
    const tempPath = `${LegacyFileSystem.cacheDirectory || LegacyFileSystem.documentDirectory}company-logo-${Date.now()}.img`;
    try {
      const downloaded = await LegacyFileSystem.downloadAsync(source, tempPath);
      const fileBase64 = await LegacyFileSystem.readAsStringAsync(downloaded.uri, { encoding: 'base64' as any });
      await LegacyFileSystem.deleteAsync(downloaded.uri, { idempotent: true });
      return fileBase64 || null;
    } catch {
      return null;
    }
  }

  return null;
};

export const autoPrintSaleTicket = async (payload: SaleTicketPayload): Promise<ThermalPrintResult> => {
  const { autoPrint, printer, paperSize } = await readPrinterSettings();
  if (!autoPrint) {
    return { printed: false, reason: 'disabled' };
  }

  return printSaleTicketDirect(payload, printer, paperSize);
};

export const printSaleTicketDirect = async (
  payload: SaleTicketPayload,
  providedPrinter?: StoredPrinter | null,
  providedPaperSize?: PaperSizeMm
): Promise<ThermalPrintResult> => {
  const companyHeader = await readCompanyTicketHeader();
  const settings = await readPrinterSettings();
  const printer = providedPrinter ?? settings.printer;
  const paperSize = providedPaperSize ?? settings.paperSize;
  if (!printer?.address) {
    return { printed: false, reason: 'missing_config', message: 'No hay una impresora conectada en Ajustes.' };
  }

  if (!isBlePrinterModuleAvailable()) {
    return {
      printed: false,
      reason: 'missing_native_module',
      message: getBlePrinterMissingModuleMessage(),
    };
  }

  try {
    const logoBase64 = await resolveLogoBase64(companyHeader.logoUrl);
    if (logoBase64) {
      await printBleImageBase64(logoBase64, printer.address, {
        imageWidth: paperSize === '80' ? 420 : 280,
        imageHeight: paperSize === '80' ? 130 : 110,
        printerWidthMm: paperSize === '80' ? 80 : 58,
      });
    }

    const text = buildSaleTicketText(payload, companyHeader, paperSize);
    await printBleText(text, printer.address);

    return { printed: true };
  } catch (error: any) {
    return {
      printed: false,
      reason: 'native_error',
      message: String(error?.message || 'No se pudo imprimir en la termica.'),
    };
  }
};

export const printPaymentReceiptDirect = async (
  payload: PaymentReceiptTicketPayload,
  providedPrinter?: StoredPrinter | null,
  providedPaperSize?: PaperSizeMm
): Promise<ThermalPrintResult> => {
  const companyHeader = await readCompanyTicketHeader();
  const settings = await readPrinterSettings();
  const printer = providedPrinter ?? settings.printer;
  const paperSize = providedPaperSize ?? settings.paperSize;
  if (!printer?.address) {
    return { printed: false, reason: 'missing_config', message: 'No hay una impresora conectada en Ajustes.' };
  }

  if (!isBlePrinterModuleAvailable()) {
    return {
      printed: false,
      reason: 'missing_native_module',
      message: getBlePrinterMissingModuleMessage(),
    };
  }

  try {
    const logoBase64 = await resolveLogoBase64(companyHeader.logoUrl);
    if (logoBase64) {
      await printBleImageBase64(logoBase64, printer.address, {
        imageWidth: paperSize === '80' ? 420 : 280,
        imageHeight: paperSize === '80' ? 130 : 110,
        printerWidthMm: paperSize === '80' ? 80 : 58,
      });
    }

    const text = buildPaymentReceiptTicketText(payload, companyHeader, paperSize);
    await printBleText(text, printer.address);
    return { printed: true };
  } catch (error: any) {
    return {
      printed: false,
      reason: 'native_error',
      message: String(error?.message || 'No se pudo imprimir recibo en la termica.'),
    };
  }
};
