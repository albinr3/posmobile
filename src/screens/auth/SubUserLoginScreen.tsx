import React, { useState, useRef } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import axios from 'axios';
import { TextInput as RNTextInput } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';

interface SubUserLoginScreenProps {
  navigation: any;
  route: {
    params: {
      userId: string;
      username: string;
      accountId: string;
    };
  };
}

export function SubUserLoginScreen({ navigation, route }: SubUserLoginScreenProps) {
  const { userId, username, accountId } = route.params;
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInputRef = useRef<RNTextInput>(null);
  const { getToken } = useAuth();
  const { setSubUser } = useAuthStore();

  const handleLogin = async () => {
    if (!password || password.length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const clerkToken = await getToken();
      if (!clerkToken) {
        setError('No hay token de autenticación');
        return;
      }

      const response = await axios.post(
        `${API_URL}/api/auth/subuser/login`,
        {
          username,
          password,
        },
        {
          headers: {
            'Authorization': `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.success && response.data.token && response.data.user) {
        console.log('✅ Login exitoso - Usuario:', response.data.user.username);
        console.log('🔑 Token de subusuario recibido:', response.data.token ? `${response.data.token.substring(0, 20)}...` : 'NO TOKEN');
        console.log('🔑 Clerk token disponible:', clerkToken ? `${clerkToken.substring(0, 20)}...` : 'NO TOKEN');
        
        await setSubUser(
          response.data.user,
          response.data.token,
          accountId || response.data.user.accountId
        );

        console.log('🔄 Iniciando sincronización inicial...');
        try {
          syncService.setGetTokenFunction(getToken);
          syncService.setGetSubUserTokenFunction(async () => {
            console.log('🔑 GetSubUserToken llamado - retornando token');
            return response.data.token;
          });
          
          await syncService.fullSync(clerkToken);
          console.log('✅ Sincronización inicial completada');
        } catch (syncError: any) {
          console.error('⚠️ Error en sincronización inicial:', syncError);
          if (syncError.response) {
            console.error('⚠️ Status:', syncError.response.status);
            console.error('⚠️ Data:', syncError.response.data);
          }
        }
      } else {
        setError('Error al iniciar sesión');
      }
    } catch (err: any) {
      console.error('Error al iniciar sesión:', err);
      if (err.response?.status === 401) {
        setError('Usuario o contraseña incorrectos');
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Error de conexión. Verifica tu internet.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <Surface style={styles.card} elevation={2}>
            <Text variant="headlineMedium" style={styles.title}>
              Iniciar Sesión
            </Text>

            <Text variant="bodyLarge" style={styles.subtitle}>
              Hola, {username}
            </Text>

            <TextInput
              ref={passwordInputRef}
              label="Contraseña"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError(null);
              }}
              secureTextEntry
              mode="outlined"
              style={styles.input}
              placeholder="Ingresa tu contraseña"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            <Button
              mode="contained"
              onPress={handleLogin}
              loading={loading}
              disabled={loading || !password || password.length < 4}
              style={styles.button}
              contentStyle={styles.buttonContent}
            >
              Iniciar Sesión
            </Button>

            <Button
              mode="text"
              onPress={() => navigation.goBack()}
              disabled={loading}
              style={styles.backButton}
            >
              Volver
            </Button>
          </Surface>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    padding: 24,
    borderRadius: 12,
    backgroundColor: 'white',
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    width: '100%',
    marginBottom: 16,
  },
  errorText: {
    color: '#d32f2f',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    marginTop: 8,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  backButton: {
    marginTop: 12,
  },
});
