import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Button, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useOAuth, useSignIn, useAuth } from '@clerk/clerk-expo';
import { makeRedirectUri } from 'expo-auth-session';
import { ui } from '../../theme/ui';

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
    if (!email || !email.includes('@')) return;
    if (!isLoaded) return;

    setLoading(true);
    try {
      await signIn.create({ identifier: email.trim() });
      const factors = (signIn.supportedFirstFactors as any[]) || [];
      const emailCodeFactor = factors.find((factor: any) => factor.strategy === 'email_code');
      const emailAddressId = emailCodeFactor?.emailAddressId;
      if (!emailAddressId) throw new Error('No email_code factor available for this identifier');

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
      if (isSignedIn) {
        try {
          await signOut();
        } catch (signOutError) {
          console.log('Error cerrando sesión previa:', signOutError);
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
      if (error?.errors?.[0]?.message?.includes('already signed in') || error?.message?.includes('already signed in')) {
        if (isSignedIn) {
          navigation.navigate('BiometricSetup');
          return;
        }
      }
      console.error('Error Google OAuth:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <View style={styles.hero}>
          <View style={styles.heroBubbleTop} />
          <View style={styles.heroBubbleBottom} />
          <Text style={styles.brand}>MOVOpos</Text>
          <Text style={styles.brandSubtitle}>Sistema de Punto de Venta</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Bienvenido</Text>
          <Text style={styles.panelSubtitle}>Ingresa tu correo para continuar</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="correo@empresa.com"
            placeholderTextColor={ui.colors.textMuted}
            style={styles.input}
          />

          <Button
            mode="contained"
            onPress={handleEmailCode}
            loading={loading}
            disabled={loading || !email.includes('@')}
            buttonColor={ui.colors.primary}
            textColor="#fff"
            style={styles.primaryButton}
            contentStyle={styles.buttonContent}
          >
            Enviar código
          </Button>

          <TouchableOpacity onPress={handleGoogle} disabled={loading} style={styles.googleButton}>
            <Text style={styles.googleButtonText}>Continuar con Google</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  keyboardView: { flex: 1 },
  hero: {
    height: '43%',
    backgroundColor: ui.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroBubbleTop: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 240,
    top: -120,
    right: -90,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroBubbleBottom: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 220,
    bottom: -110,
    left: -80,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  brand: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: 0.4 },
  brandSubtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 8 },
  panel: {
    flex: 1,
    marginTop: -24,
    backgroundColor: ui.colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  panelTitle: { fontSize: 28, color: ui.colors.text, fontWeight: '700' },
  panelSubtitle: { marginTop: 4, marginBottom: 20, color: ui.colors.textMuted, fontSize: 14 },
  input: {
    height: 54,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 16,
    fontSize: 16,
    color: ui.colors.text,
    backgroundColor: '#F9F8FC',
  },
  primaryButton: { marginTop: 18, borderRadius: ui.radius.lg },
  buttonContent: { height: 50 },
  googleButton: {
    marginTop: 12,
    height: 50,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: { color: ui.colors.text, fontWeight: '600' },
});

