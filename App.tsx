import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ActivityIndicator, Alert, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { OtaUpdateBanner } from './src/components/OtaUpdateBanner';
import { NetworkToast } from './src/components/NetworkToast';
import { db } from './src/database/Database';
import {
  getBiometricEnabled,
  hasStoredSubUserSession,
  promptBiometric,
} from './src/services/auth/biometricAuthService';
import { flushErrorQueue, reportError, setErrorSubUserTokenGetter, setErrorTokenGetter } from './src/services/error/errorReporter';
import {
  evaluateOfflineSessionWindow,
  markInternetConnectionSeen,
  OFFLINE_SESSION_MAX_DAYS,
} from './src/services/auth/offlineSessionService';
import { syncService } from './src/services/sync/SyncService';
import { useOtaUpdates } from './src/services/updates/useOtaUpdates';
import { useAuthStore } from './src/store/authStore';
import { useSyncStore } from './src/store/syncStore';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a73e8',
    secondary: '#4caf50',
  },
};

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const LOCAL_DB_WIPED_ONCE_KEY = 'movopos_local_db_wiped_once_v2';
const LOCAL_HARD_RESET_ONCE_KEY = 'movopos_local_hard_reset_once_v1';
const LOCAL_HARD_RESET_STATE_KEY = 'movopos_local_hard_reset_state_v2';
const APP_AUTH_DEBUG = false;
const OFFLINE_SESSION_EXPIRED_TITLE = 'Sesion expirada';
const OFFLINE_SESSION_EXPIRED_MESSAGE = `Debes conectarte a internet al menos una vez cada ${OFFLINE_SESSION_MAX_DAYS} dias para continuar usando MOVOPos.`;

const tokenCache = {
  getToken: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  saveToken: async (key: string, value: string) => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // no-op
    }
  },
};

function RootApp() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRefreshTick, setAuthRefreshTick] = useState(0);
  const { setLoading, setUser, isAuthenticated, loadSubUserToken, logout, setBiometricEnabled } = useAuthStore();
  const { syncBlockedReason, pendingCount } = useSyncStore();
  const otaUpdates = useOtaUpdates();
  const lastSyncBlockedReasonRef = useRef<string | null>(null);
  const authHydratedRef = useRef(false);
  const offlineExpiryAlertShownRef = useRef(false);
  const clerkSignedOutDetectedAtRef = useRef<number | null>(null);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    const ErrorUtilsRef = (global as any)?.ErrorUtils;
    const defaultHandler = ErrorUtilsRef?.getGlobalHandler?.();
    if (ErrorUtilsRef?.setGlobalHandler) {
      ErrorUtilsRef.setGlobalHandler((error: Error, isFatal?: boolean) => {
        void reportError(error, {
          code: 'UNHANDLED_ERROR',
          severity: isFatal ? 'CRITICAL' : 'HIGH',
          isFatal: !!isFatal,
        });
        if (defaultHandler) {
          defaultHandler(error, isFatal);
        }
      });
    }
    initializeApp();
    return () => {
      syncService.destroy();
      db.destroy().catch((error) => {
        console.warn('No se pudo cerrar SQLite al desmontar App:', error);
      });
    };
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const hasInternet = !!state.isConnected && state.isInternetReachable !== false;
      if (!hasInternet) return;
      void markInternetConnectionSeen();
      void flushErrorQueue();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const refreshNetworkState = async () => {
      const netInfo = await NetInfo.fetch();
      const hasInternet = !!netInfo.isConnected && netInfo.isInternetReachable !== false;
      syncService.handleConnectivityChange(hasInternet);
      if (hasInternet) {
        void markInternetConnectionSeen();
        void flushErrorQueue();
        void syncService.incrementalSync();
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        setAuthRefreshTick((prev) => prev + 1);
        void refreshNetworkState();
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, []);

  // Configurar token getter cuando useAuth esté disponible
  useEffect(() => {
    if (isLoaded && getToken) {
      if (APP_AUTH_DEBUG) console.log('[App] configurando syncService.setTokenGetter');
      const tokenGetter = async () => {
        try {
          const freshToken = await (getToken as any)?.({ skipCache: true });
          if (freshToken) {
            if (APP_AUTH_DEBUG) console.log('[App] getToken(skipCache) OK', { len: freshToken.length });
            return freshToken;
          }
          const fallback = await getToken();
          if (APP_AUTH_DEBUG) console.log('[App] getToken() fallback', { hasToken: !!fallback, len: fallback?.length || 0 });
          return fallback;
        } catch (error) {
          console.error('Error obteniendo token:', error);
          return null;
        }
      };
      syncService.setTokenGetter(tokenGetter);
      setErrorTokenGetter(tokenGetter);
    }
  }, [isLoaded, getToken]);

  // Configurar token getter del subusuario
  useEffect(() => {
    if (APP_AUTH_DEBUG) console.log('[App] configurando syncService.setSubUserTokenGetter');
    const subUserTokenGetter = async () => {
      try {
        const token = useAuthStore.getState().subUserToken;
        if (APP_AUTH_DEBUG) console.log('[App] subUserToken getter', { hasToken: !!token, len: token?.length || 0 });
        return token || null;
      } catch (error) {
        console.error('Error obteniendo token de subusuario:', error);
        return null;
      }
    };
    syncService.setSubUserTokenGetter(subUserTokenGetter);
    setErrorSubUserTokenGetter(subUserTokenGetter);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const hydrateAuthState = async () => {
      const netInfo = await NetInfo.fetch();
      const hasInternet = !!netInfo.isConnected && netInfo.isInternetReachable !== false;
      const offlineWindow = await evaluateOfflineSessionWindow(hasInternet);

      if (APP_AUTH_DEBUG) {
        console.log('[App] hydrateAuthState()', {
          isSignedIn,
          hasClerkUser: !!user,
          isAuthenticated,
          clerkUserId: user?.id || null,
          hasInternet,
          offlineExpired: offlineWindow.expired,
          offlineLastOnlineAtMs: offlineWindow.lastOnlineAtMs,
        });
      }
      if (!authHydratedRef.current) {
        authHydratedRef.current = true;

        const biometricEnabled = await getBiometricEnabled();
        setBiometricEnabled(biometricEnabled);

        const hasStoredSession = await hasStoredSubUserSession();
        if (!hasInternet && offlineWindow.expired && hasStoredSession) {
          if (APP_AUTH_DEBUG) console.log('[App] sesion offline vencida (pre-biometria) -> logout()');
          await logout();

          if (!offlineExpiryAlertShownRef.current) {
            offlineExpiryAlertShownRef.current = true;
            Alert.alert(OFFLINE_SESSION_EXPIRED_TITLE, OFFLINE_SESSION_EXPIRED_MESSAGE);
          }
          return;
        }

        if (biometricEnabled && hasStoredSession) {
          const biometricResult = await promptBiometric('Desbloquea MOVOPos para continuar');
          if (!biometricResult.success) {
            await useAuthStore.getState().setSubUser(null, null, null);
            return;
          }
        }

        // Restaurar subusuario persistido para evitar relogin tras cerrar app.
        await loadSubUserToken();
      }

      const storeIsAuthenticated = useAuthStore.getState().isAuthenticated;
      if (!hasInternet && offlineWindow.expired && storeIsAuthenticated) {
        if (APP_AUTH_DEBUG) console.log('[App] sesion offline vencida -> logout()');
        await logout();

        if (!offlineExpiryAlertShownRef.current) {
          offlineExpiryAlertShownRef.current = true;
          Alert.alert(OFFLINE_SESSION_EXPIRED_TITLE, OFFLINE_SESSION_EXPIRED_MESSAGE);
        }
        return;
      }

      if (isLoaded && isSignedIn && user) {
        clerkSignedOutDetectedAtRef.current = null;
        setUser({
          id: user.id,
          name: user.fullName || user.firstName || 'Usuario',
          phone: user.primaryPhoneNumber?.phoneNumber,
          email: user.primaryEmailAddress?.emailAddress,
          companyId: '',
          role: '',
        });
        return;
      }

      if (isLoaded && !isSignedIn && storeIsAuthenticated) {
        if (hasInternet) {
          const tokenCheck = await getToken();
          if (tokenCheck) {
            clerkSignedOutDetectedAtRef.current = null;
            if (APP_AUTH_DEBUG) console.log('[App] getToken() devolvió token aunque isSignedIn=false; se evita logout');
            return;
          }

          const now = Date.now();
          if (!clerkSignedOutDetectedAtRef.current) {
            clerkSignedOutDetectedAtRef.current = now;
            if (APP_AUTH_DEBUG) console.log('[App] posible logout de Clerk detectado; iniciando ventana de confirmación');
            return;
          }

          const elapsedMs = now - clerkSignedOutDetectedAtRef.current;
          if (elapsedMs < 90_000) {
            if (APP_AUTH_DEBUG) {
              console.log('[App] Clerk sigue no firmado, pero dentro de ventana de confirmación', {
                elapsedMs,
              });
            }
            return;
          }

          if (APP_AUTH_DEBUG) console.log('[App] Clerk no firmado confirmado por 90s con internet -> logout()');
          await logout();
        } else if (APP_AUTH_DEBUG) {
          console.log('[App] Clerk no firmado sin internet -> se mantiene sesión local');
        }
      }
    };

    hydrateAuthState();
  }, [isReady, isLoaded, isSignedIn, user?.id, isAuthenticated, setUser, loadSubUserToken, logout, authRefreshTick]);

  useEffect(() => {
    if (!isReady || !syncBlockedReason || pendingCount === 0) return;
    let cancelled = false;

    const notifyBlockedReason = async () => {
      const netInfo = await NetInfo.fetch();
      const hasInternet = !!netInfo.isConnected && netInfo.isInternetReachable !== false;
      if (!hasInternet || cancelled) return;
      if (lastSyncBlockedReasonRef.current === syncBlockedReason) return;
      lastSyncBlockedReasonRef.current = syncBlockedReason;
      if (APP_AUTH_DEBUG) console.log('[App] syncBlockedReason:', syncBlockedReason);
      Alert.alert('Sincronizacion en espera', syncBlockedReason);
    };

    void notifyBlockedReason();
    return () => {
      cancelled = true;
    };
  }, [isReady, syncBlockedReason, pendingCount]);

  useEffect(() => {
    if (!isReady) return;
    void otaUpdates.checkForUpdates({ silentIfOffline: true });
  }, [isReady, otaUpdates.checkForUpdates]);

  const initializeApp = async () => {
    try {
      if (APP_AUTH_DEBUG) console.log('[App] initializeApp() start');
      // Hard reset local one-shot: borra SQLite + session storage para iniciar en cero.
      const hardResetState = await SecureStore.getItemAsync(LOCAL_HARD_RESET_STATE_KEY);
      const hardResetAlreadyStarted = hardResetState === 'started' || hardResetState === 'done';
      if (hardResetState === 'started') {
        // Si un arranque previo se interrumpió antes de marcar done, no repetir wipe destructivo.
        await SecureStore.setItemAsync(LOCAL_HARD_RESET_STATE_KEY, 'done');
      }
      if (!hardResetAlreadyStarted) {
        await SecureStore.setItemAsync(LOCAL_HARD_RESET_STATE_KEY, 'started');
        try {
          await syncService.destroy();
          await db.destroy();
        } catch (error) {
          console.warn('No se pudo detener servicios antes de hard reset:', error);
        }

        try {
          await AsyncStorage.clear();
        } catch (error) {
          console.warn('No se pudo limpiar AsyncStorage en hard reset:', error);
        }

        const secureKeys = [
          'movopos_subuser_token',
          'movopos_subuser_data',
          'movopos_account_id',
          LOCAL_DB_WIPED_ONCE_KEY,
        ];
        for (const key of secureKeys) {
          try {
            await SecureStore.deleteItemAsync(key);
          } catch (error) {
            console.warn(`No se pudo borrar SecureStore key ${key}:`, error);
          }
        }

        try {
          const sqliteDir = `${LegacyFileSystem.documentDirectory || ''}SQLite`;
          const dirInfo = await LegacyFileSystem.getInfoAsync(sqliteDir);
          if (dirInfo.exists && dirInfo.isDirectory) {
            const files = await LegacyFileSystem.readDirectoryAsync(sqliteDir);
            for (const file of files) {
              if (!file.toLowerCase().startsWith('movopos')) continue;
              const path = `${sqliteDir}/${file}`;
              try {
                await LegacyFileSystem.deleteAsync(path, { idempotent: true });
              } catch (error) {
                console.warn(`No se pudo borrar archivo SQLite ${file}:`, error);
              }
            }
          }
        } catch (error) {
          console.warn('No se pudo limpiar carpeta SQLite en hard reset:', error);
        }

        await SecureStore.setItemAsync(LOCAL_HARD_RESET_ONCE_KEY, '1');
        await SecureStore.setItemAsync(LOCAL_HARD_RESET_STATE_KEY, 'done');
      }

      // Inicializar base de datos
      await db.init();

      // Borrado completo one-shot de datos locales solicitado por usuario.
      const alreadyWiped = await SecureStore.getItemAsync(LOCAL_DB_WIPED_ONCE_KEY);
      if (alreadyWiped !== '1') {
        await db.clearAllData();
        await SecureStore.setItemAsync(LOCAL_DB_WIPED_ONCE_KEY, '1');
        if (APP_AUTH_DEBUG) console.log('[App] local DB wipe one-shot ejecutado');
      }
      
      // Inicializar servicio de sincronización
      await syncService.init();
      setLoading(false);
      if (APP_AUTH_DEBUG) console.log('[App] initializeApp() ready');
      
      setIsReady(true);
    } catch (err) {
      console.error('Error inicializando app:', err);
      setError('Error al inicializar la aplicación');
    }
  };

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#1a73e8" />
        <Text style={styles.loadingText}>Cargando MOVOPos...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <ErrorBoundary>
            <AppNavigator />
          </ErrorBoundary>
          <NetworkToast />
          <OtaUpdateBanner
            visible={otaUpdates.visible}
            status={otaUpdates.status}
            errorMessage={otaUpdates.errorMessage}
            onCheckNow={otaUpdates.checkForUpdates}
            onDownloadNow={otaUpdates.downloadUpdate}
            onReloadNow={otaUpdates.reloadApp}
            onDismiss={otaUpdates.dismiss}
          />
          <StatusBar style="auto" translucent={false} />
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  if (!publishableKey) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Falta EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY en el entorno.</Text>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <RootApp />
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#d32f2f',
    textAlign: 'center',
    padding: 20,
  },
});
