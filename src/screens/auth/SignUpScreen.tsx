import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
} from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useAuth, useOAuth, useSignUp } from '@clerk/clerk-expo';
import { makeRedirectUri } from 'expo-auth-session';
import { SafeAreaView } from '../../components/SafeAreaView';
import { ui } from '../../theme/ui';

export function SignUpScreen({ navigation }: any) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const { isSignedIn } = useAuth();
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const canResume = !!signUp?.id && signUp.emailAddress === email.trim() && signUp.status !== 'abandoned' && signUp.hasPassword;
  const continueAuthenticated = () => navigation.reset({ index: 0, routes: [{ name: 'BiometricSetup' }] });

  const submit = async () => {
    if (busy.current) return;
    if (isSignedIn) {
      continueAuthenticated();
      return;
    }

    const cleanEmail = email.trim();
    if (!cleanEmail.includes('@')) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }

    if (!canResume) {
      if (!password || !confirmation) {
        setError('Ingresa y confirma tu contraseña.');
        return;
      }
      if (password !== confirmation) {
        setError('Las contraseñas no coinciden.');
        return;
      }
      if (password.length < 8) {
        setError('La contraseña debe tener al minímo 8 caracteres.');
        return;
      }
    }

    if (!isLoaded || !signUp) {
      setError('La autenticación aún no está lista.');
      return;
    }

    busy.current = true;
    setLoading(true);
    setError('');
    try {
      // Si el envío del código falló, continuar el registro existente evita volver a crear la cuenta.
      const result = canResume
        ? signUp
        : await signUp.create({
            emailAddress: cleanEmail,
            password,
            unsafeMetadata: { registration_device: 'mobile' },
          });

      setPassword('');
      setConfirmation('');

      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        continueAuthenticated();
      } else if (result.unverifiedFields.includes('email_address')) {
        let deliveryError = '';
        try {
          await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        } catch (err: any) {
          deliveryError = err?.errors?.[0]?.longMessage || err?.message || 'No se pudo enviar el código. Solicita uno nuevo.';
        }
        navigation.navigate('EmailVerification', {
          email: cleanEmail,
          mode: 'signup',
          codeSent: !deliveryError,
          initialError: deliveryError,
        });
      } else {
        setError('No se pudo completar el registro. Intenta iniciar sesión o contacta con soporte.');
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || 'No se pudo crear la cuenta.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const google = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      if (isSignedIn) {
        continueAuthenticated();
        return;
      }
      const result = await startOAuthFlow({
        redirectUrl: makeRedirectUri({ scheme: 'movopos', path: 'oauth-native-callback' }),
        unsafeMetadata: { registration_device: 'mobile' },
      });
      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        continueAuthenticated();
      } else if (result.authSessionResult?.type !== 'cancel' && result.authSessionResult?.type !== 'dismiss') {
        setError('No se completó el acceso con Google. Intenta nuevamente.');
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage || err?.message || 'No se pudo continuar con Google.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroBubbleTop} />
            <View style={styles.heroBubbleBottom} />
            <Text style={styles.brand}>MOVOpos</Text>
            <Text style={styles.brandSubtitle}>Sistema de Punto de Venta</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Crear cuenta</Text>
            <Text style={styles.panelSubtitle}>Regístrate para configurar tu negocio</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Correo electrónico</Text>
              <TextInput
                accessibilityLabel="Correo"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="correo@empresa.com"
                placeholderTextColor={ui.colors.textMuted}
                style={styles.input}
                editable={!loading}
              />
            </View>

            {!canResume && (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Contraseña</Text>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      accessibilityLabel="Contraseña"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Mínimo 8 caracteres"
                      placeholderTextColor={ui.colors.textMuted}
                      style={styles.passwordInput}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword((prev) => !prev)}
                      style={styles.passwordToggle}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.passwordToggleText}>{showPassword ? 'Ocultar' : 'Ver'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Confirmar contraseña</Text>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      accessibilityLabel="Confirmar contraseña"
                      value={confirmation}
                      onChangeText={setConfirmation}
                      secureTextEntry={!showConfirmation}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Repite tu contraseña"
                      placeholderTextColor={ui.colors.textMuted}
                      style={styles.passwordInput}
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowConfirmation((prev) => !prev)}
                      style={styles.passwordToggle}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.passwordToggleText}>{showConfirmation ? 'Ocultar' : 'Ver'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={submit}
              loading={loading}
              disabled={loading || !email.includes('@') || (!canResume && (!password || password !== confirmation))}
              buttonColor={ui.colors.primary}
              textColor="#fff"
              style={styles.primaryButton}
              contentStyle={styles.buttonContent}
            >
              {canResume ? 'Continuar registro' : 'Crear cuenta'}
            </Button>

            <TouchableOpacity onPress={google} disabled={loading} style={styles.googleButton}>
              <Image source={require('../../../assets/search.png')} style={styles.googleIcon} resizeMode="contain" />
              <Text style={styles.googleButtonText}>Continuar con Google</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              disabled={loading}
              style={styles.footerLink}
            >
              <Text style={styles.footerLinkText}>
                ¿Ya tienes una cuenta? <Text style={styles.footerLinkHighlight}>Inicia sesión</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  hero: {
    minHeight: 180,
    paddingTop: 36,
    paddingBottom: 48,
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
  brand: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  brandSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 6,
  },
  panel: {
    flex: 1,
    marginTop: -24,
    backgroundColor: ui.colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 36,
  },
  panelTitle: {
    fontSize: 28,
    color: ui.colors.text,
    fontWeight: '700',
  },
  panelSubtitle: {
    marginTop: 4,
    marginBottom: 20,
    color: ui.colors.textMuted,
    fontSize: 14,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ui.colors.text,
    marginBottom: 6,
  },
  input: {
    height: 52,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    paddingHorizontal: 16,
    fontSize: 15,
    color: ui.colors.text,
    backgroundColor: '#F9F8FC',
  },
  passwordContainer: {
    height: 52,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#F9F8FC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: ui.colors.text,
    padding: 0,
  },
  passwordToggle: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  passwordToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: ui.colors.primary,
  },
  errorBox: {
    backgroundColor: '#FEECEC',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: ui.radius.md,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    color: ui.colors.danger,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 6,
    borderRadius: ui.radius.lg,
  },
  buttonContent: {
    height: 50,
  },
  googleButton: {
    marginTop: 12,
    height: 50,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  googleIcon: {
    width: 18,
    height: 18,
    marginRight: 8,
  },
  googleButtonText: {
    color: ui.colors.text,
    fontWeight: '600',
  },
  footerLink: {
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  footerLinkText: {
    fontSize: 14,
    color: ui.colors.textMuted,
  },
  footerLinkHighlight: {
    color: ui.colors.primary,
    fontWeight: '700',
  },
});
