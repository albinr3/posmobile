import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { API_URL } from '../sync/syncShared';

const INSTALLATION_ID_KEY = 'movopos_mobile_installation_id_v1';
const LAST_SUCCESSFUL_HEARTBEAT_KEY = 'movopos_mobile_installation_heartbeat_at_v1';
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;

let installationIdPromise: Promise<string> | null = null;
let heartbeatPromise: Promise<boolean> | null = null;

function createInstallationId(): string {
  const randomPart = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 13)).join('');
  return `movopos_install_${Date.now().toString(36)}_${randomPart}`;
}

async function getInstallationId(): Promise<string> {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      const savedId = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
      if (savedId && savedId.startsWith('movopos_install_')) return savedId;

      const installationId = createInstallationId();
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, installationId);
      return installationId;
    })();
  }

  try {
    return await installationIdPromise;
  } catch (error) {
    installationIdPromise = null;
    throw error;
  }
}

function getAppVersion(): string {
  return Constants.expoConfig?.version || Constants.nativeAppVersion || 'unknown';
}

/**
 * Reporta una instalación de forma anónima. Solo se marca como enviada tras una respuesta exitosa,
 * para reintentar cuando la app recupere conexión sin afectar el arranque ni la autenticación.
 */
export async function reportMobileInstallationActivity(): Promise<boolean> {
  if (heartbeatPromise) return heartbeatPromise;

  heartbeatPromise = (async () => {
    try {
      const lastSuccessfulHeartbeat = Number(
        await AsyncStorage.getItem(LAST_SUCCESSFUL_HEARTBEAT_KEY) || '0',
      );
      if (Number.isFinite(lastSuccessfulHeartbeat) && Date.now() - lastSuccessfulHeartbeat < HEARTBEAT_INTERVAL_MS) {
        return false;
      }

      const installationId = await getInstallationId();
      await axios.post(
        `${API_URL}/api/mobile/installations/heartbeat`,
        {
          installationId,
          platform: Platform.OS,
          appVersion: getAppVersion(),
        },
        { timeout: 10_000 },
      );
      await AsyncStorage.setItem(LAST_SUCCESSFUL_HEARTBEAT_KEY, String(Date.now()));
      return true;
    } catch (error) {
      console.warn('No se pudo registrar la actividad de la instalación:', error);
      return false;
    } finally {
      heartbeatPromise = null;
    }
  })();

  return heartbeatPromise;
}
