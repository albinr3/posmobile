import React, { useState, useRef } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, TextInput as RNTextInput } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { ui } from '../../theme/ui';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
const SUBUSER_LOGIN_DEBUG = false;

function shortToken(token: string | null | undefined): string {
  if (!token) return 'null';
  return `${token.slice(0, 12)}...(${token.length})`;
}

export function SubUserLoginScreen({ navigation, route }: any) {
  const username = route?.params?.username || '';
  const accountId = route?.params?.accountId || '';
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
      if (SUBUSER_LOGIN_DEBUG) {
        console.log('[SubUserLogin] intento login', {
          username,
          accountIdFromRoute: accountId || null,
        });
      }
      const clerkToken = await getToken();
      if (SUBUSER_LOGIN_DEBUG) {
        console.log('[SubUserLogin] clerkToken obtenido', { clerkToken: shortToken(clerkToken) });
      }
      if (!clerkToken) {
        setError('No hay token de autenticación');
        return;
      }

      const response = await axios.post(
        `${API_URL}/api/auth/subuser/login`,
        { username, password },
        {
          headers: {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.success && response.data.token && response.data.user) {
        if (SUBUSER_LOGIN_DEBUG) {
          console.log('[SubUserLogin] login API success', {
            apiUserId: response.data.user?.id || null,
            apiUsername: response.data.user?.username || null,
            apiAccountId: response.data.user?.accountId || null,
            subUserToken: shortToken(response.data.token),
          });
        }
        await setSubUser(response.data.user, response.data.token, accountId || response.data.user.accountId);
        try {
          syncService.setTokenGetter(getToken);
          syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
          if (SUBUSER_LOGIN_DEBUG) {
            const state = useAuthStore.getState();
            console.log('[SubUserLogin] estado tras setSubUser', {
              stateAccountId: state.accountId,
              stateUsername: state.subUser?.username || null,
              stateToken: shortToken(state.subUserToken),
            });
          }
          await syncService.fullSync(clerkToken);
        } catch (syncError: any) {
          console.error('Error en sincronización inicial:', syncError);
        }
      } else {
        setError('Error al iniciar sesión');
      }
    } catch (err: any) {
      console.error('Error al iniciar sesión:', err);
      if (err.response?.status === 401) setError('Usuario o contraseña incorrectos');
      else if (err.response?.data?.error) setError(err.response.data.error);
      else setError('Error de conexión. Verifica tu internet.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <View style={styles.content}>
          <View style={styles.lockBubble}>
            <Text style={styles.lockText}>🔒</Text>
          </View>
          <Text style={styles.title}>Ingresa tu contraseña</Text>
          <Text style={styles.subtitle}>@{username}</Text>

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
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button
            mode="contained"
            onPress={handleLogin}
            loading={loading}
            disabled={loading || !password || password.length < 4}
            buttonColor={ui.colors.primary}
            style={styles.loginButton}
            contentStyle={styles.buttonContent}
          >
            Iniciar Sesión
          </Button>

          <Button mode="text" onPress={() => navigation.goBack()} disabled={loading} textColor={ui.colors.primary}>
            Volver
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  keyboardView: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 22 },
  lockBubble: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EEDFFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  lockText: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: '800', color: ui.colors.text, textAlign: 'center' },
  subtitle: { fontSize: 15, color: ui.colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  input: { marginBottom: 8, backgroundColor: ui.colors.surface },
  errorText: { color: ui.colors.danger, textAlign: 'center', marginBottom: 8 },
  loginButton: { marginTop: 8, borderRadius: ui.radius.md },
  buttonContent: { height: 50 },
});

