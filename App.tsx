import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { AppNavigator } from './src/navigation/AppNavigator';
import { db } from './src/database/Database';
import { syncService } from './src/services/sync/SyncService';
import { useAuthStore } from './src/store/authStore';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a73e8',
    secondary: '#4caf50',
  },
};

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    initializeApp();
  }, []);

  // Configurar token getter cuando useAuth esté disponible
  useEffect(() => {
    if (isLoaded && getToken) {
      syncService.setTokenGetter(async () => {
        try {
          return await getToken();
        } catch (error) {
          console.error('Error obteniendo token:', error);
          return null;
        }
      });
    }
  }, [isLoaded, getToken]);

  // Configurar token getter del subusuario
  useEffect(() => {
    syncService.setSubUserTokenGetter(async () => {
      try {
        const token = useAuthStore.getState().subUserToken;
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
        await logout();
      }
    };

    hydrateAuthState();
  }, [isReady, isLoaded, isSignedIn, user?.id, isAuthenticated, setUser, loadSubUserToken, logout]);

  const initializeApp = async () => {
    try {
      // Inicializar base de datos
      await db.init();
      
      // Inicializar servicio de sincronización
      await syncService.init();
      setLoading(false);
      
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
          <AppNavigator />
          <StatusBar style="auto" />
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
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
