import React, { useState } from 'react';
import { View, StyleSheet, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOAuth, useSignIn, useAuth } from '@clerk/clerk-expo';
import { makeRedirectUri } from 'expo-auth-session';

interface LoginScreenProps {
  navigation: any;
}

export function LoginScreen({ navigation }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { isLoaded, signIn } = useSignIn();
  const { isSignedIn, signOut } = useAuth();
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });

  const handleEmailCode = async () => {
    if (!email || !email.includes('@')) {
      return;
    }

    if (!isLoaded) {
      return;
    }

    setLoading(true);
    try {
      await signIn.create({ identifier: email.trim() });

      const factors = (signIn.supportedFirstFactors as any[]) || [];
      const emailCodeFactor = factors.find(
        (factor: any) => factor.strategy === 'email_code'
      );
      const emailAddressId = emailCodeFactor?.emailAddressId;
      if (!emailAddressId) {
        throw new Error('No email_code factor available for this identifier');
      }

      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId,
      } as any);
      navigation.navigate('EmailVerification', { email: email.trim(), emailAddressId });
    } catch (error) {
      console.error('Error enviando código:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      // Si ya hay una sesión activa, cerrarla primero
      if (isSignedIn) {
        try {
          await signOut();
        } catch (signOutError) {
          console.log('Error cerrando sesión previa:', signOutError);
          // Continuar de todas formas
        }
      }

      const redirectUrl = makeRedirectUri({
        scheme: 'movopos',
        path: 'oauth-native-callback',
      });
      const { createdSessionId, setActive } = await startOAuthFlow({ redirectUrl });

      if (createdSessionId) {
        await setActive?.({ session: createdSessionId });
        navigation.navigate('BiometricSetup');
      }
    } catch (error: any) {
      // Si el error es "already signed in", intentar usar la sesión existente
      if (error?.errors?.[0]?.message?.includes('already signed in') || 
          error?.message?.includes('already signed in')) {
        try {
          // Si ya está autenticado, navegar directamente
          if (isSignedIn) {
            navigation.navigate('BiometricSetup');
            return;
          }
        } catch (navigateError) {
          console.error('Error navegando:', navigateError);
        }
      }
      console.error('Error Google OAuth:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <Text style={styles.title}>MOVOPos</Text>
            <Text style={styles.subtitle}>Sistema de Punto de Venta</Text>
          </View>

          <Surface style={styles.card}>
            <Text style={styles.cardTitle}>Iniciar Sesión</Text>
            <Text style={styles.cardDescription}>
              Ingresa tu email o continúa con Google
            </Text>

            <TextInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              mode="outlined"
              style={styles.input}
              placeholder="correo@empresa.com"
            />

            <Button
              mode="contained"
              onPress={handleEmailCode}
              loading={loading}
              disabled={loading || !email.includes('@')}
              style={styles.button}
              contentStyle={styles.buttonContent}
            >
              Enviar código al email
            </Button>

            <Button
              mode="outlined"
              onPress={handleGoogle}
              disabled={loading}
              style={styles.secondaryButton}
              contentStyle={styles.buttonContent}
              icon="google"
            >
              Continuar con Google
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
    padding: 20,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1a73e8',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  card: {
    padding: 24,
    borderRadius: 12,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
  },
  secondaryButton: {
    marginTop: 12,
  },
  buttonContent: {
    paddingVertical: 8,
  },
});
