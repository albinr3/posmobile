import { BLEPrinter, IBLEPrinter } from '@poriyaalar/react-native-thermal-receipt-printer';
import { NativeModules } from 'react-native';

export interface BlePrinterDevice {
  id: string;
  name: string;
  address: string;
  connected: boolean;
}

const MISSING_MODULE_MESSAGE = 'Esta compilacion no incluye el modulo nativo de impresion termica Bluetooth.';

let initialized = false;

const hasNativeBlePrinter = (): boolean => {
  return Boolean((NativeModules as any)?.RNBLEPrinter);
};

const ensureInitialized = async () => {
  if (!hasNativeBlePrinter()) {
    throw new Error(MISSING_MODULE_MESSAGE);
  }
  if (initialized) return;
  await BLEPrinter.init();
  initialized = true;
};

const normalizeDevice = (raw: IBLEPrinter | any, index: number): BlePrinterDevice | null => {
  if (!raw) return null;
  const address = String(raw.inner_mac_address || raw.address || raw.macAddress || '').trim();
  if (!address) return null;

  return {
    id: address,
    name: String(raw.device_name || raw.name || `Impresora ${index + 1}`),
    address,
    connected: false,
  };
};

export const isBlePrinterModuleAvailable = (): boolean => hasNativeBlePrinter();

export const getBlePrinterMissingModuleMessage = (): string => MISSING_MODULE_MESSAGE;

export const listBlePrinters = async (): Promise<BlePrinterDevice[]> => {
  await ensureInitialized();
  const devices = await BLEPrinter.getDeviceList();
  return (Array.isArray(devices) ? devices : [])
    .map((entry, index) => normalizeDevice(entry, index))
    .filter(Boolean) as BlePrinterDevice[];
};

export const connectBlePrinter = async (address: string): Promise<void> => {
  await ensureInitialized();
  await BLEPrinter.connectPrinter(address);
};

export const disconnectBlePrinter = async (): Promise<void> => {
  if (!hasNativeBlePrinter()) return;
  await BLEPrinter.closeConn();
};

export const printBleText = async (text: string, address?: string): Promise<void> => {
  await ensureInitialized();
  if (address) {
    await BLEPrinter.connectPrinter(address);
  }

  await new Promise<void>((resolve, reject) => {
    BLEPrinter.printText(
      text,
      { encoding: 'UTF8', keepConnection: true },
      () => resolve(),
      (error) => reject(error)
    );
  });
};
