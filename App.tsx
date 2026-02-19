import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { db } from './src/database/Database';
import { syncService } from './src/services/sync/SyncService';
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
const APP_AUTH_DEBUG = false;

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
  const { setLoading, setUser, isAuthenticated, loadSubUserToken, logout } = useAuthStore();
  const { syncBlockedReason } = useSyncStore();
  const lastSyncBlockedReasonRef = useRef<string | null>(null);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    initializeApp();
    return () => {
      syncService.destroy();
      db.destroy().catch((error) => {
        console.warn('No se pudo cerrar SQLite al desmontar App:', error);
      });
    };
  }, []);

  // Configurar token getter cuando useAuth esté disponible
  useEffect(() => {
    if (isLoaded && getToken) {
      if (APP_AUTH_DEBUG) console.log('[App] configurando syncService.setTokenGetter');
      syncService.setTokenGetter(async () => {
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
      });
    }
  }, [isLoaded, getToken]);

  // Configurar token getter del subusuario
  useEffect(() => {
    if (APP_AUTH_DEBUG) console.log('[App] configurando syncService.setSubUserTokenGetter');
    syncService.setSubUserTokenGetter(async () => {
      try {
        const token = useAuthStore.getState().subUserToken;
        if (APP_AUTH_DEBUG) console.log('[App] subUserToken getter', { hasToken: !!token, len: token?.length || 0 });
        return token || null;
      } catch (error) {
        console.error('Error obteniendo token de subusuario:', error);
        return null;
      }
    });
  }, []);

  useEffect(() => {
    if (!isReady || !isLoaded) return;

    const hydrateAuthState = async () => {
      if (APP_AUTH_DEBUG) {
        console.log('[App] hydrateAuthState()', {
          isSignedIn,
          hasClerkUser: !!user,
          isAuthenticated,
          clerkUserId: user?.id || null,
        });
      }
      if (isSignedIn && user) {
        setUser({
          id: user.id,
          name: user.fullName || user.firstName || 'Usuario',
          phone: user.primaryPhoneNumber?.phoneNumber,
          email: user.primaryEmailAddress?.emailAddress,
          companyId: '',
          role: '',
        });

        // Restaurar subusuario persistido para evitar relogin tras cerrar app.
        await loadSubUserToken();
        return;
      }

      if (!isSignedIn && isAuthenticated) {
        if (APP_AUTH_DEBUG) console.log('[App] Clerk no firmado pero authStore autenticado -> logout()');
        await logout();
      }
    };

    hydrateAuthState();
  }, [isReady, isLoaded, isSignedIn, user?.id, isAuthenticated, setUser, loadSubUserToken, logout]);

  useEffect(() => {
    if (!isReady || !syncBlockedReason) return;
    if (lastSyncBlockedReasonRef.current === syncBlockedReason) return;
    lastSyncBlockedReasonRef.current = syncBlockedReason;
    if (APP_AUTH_DEBUG) console.log('[App] syncBlockedReason:', syncBlockedReason);
    Alert.alert('Sincronizacion en espera', syncBlockedReason);
  }, [isReady, syncBlockedReason]);

  const initializeApp = async () => {
    try {
      if (APP_AUTH_DEBUG) console.log('[App] initializeApp() start');
      // Hard reset local one-shot: borra SQLite + session storage para iniciar en cero.
      const hardResetDone = await SecureStore.getItemAsync(LOCAL_HARD_RESET_ONCE_KEY);
      if (hardResetDone !== '1') {
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
        } catch (error) {
          console.warn('No se pudo limpiar carpeta SQLite en hard reset:', error);
        }

        await SecureStore.setItemAsync(LOCAL_HARD_RESET_ONCE_KEY, '1');
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
