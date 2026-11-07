import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const canResume = !!signUp?.id && signUp.emailAddress === email.trim() && signUp.status !== 'abandoned' && signUp.hasPassword;
  const continueAuthenticated = () => navigation.reset({ index: 0, routes: [{ name: 'BiometricSetup' }] });

  const submit = async () => {
    if (busy.current) return;
    if (isSignedIn) { continueAuthenticated(); return; }
    if (!email.trim().includes('@') || (!canResume && (!password || password !== confirmation))) {
      setError('Comprueba el correo y que las contraseñas coincidan.');
      return;
    }
    if (!isLoaded || !signUp) { setError('La autenticación aún no está lista.'); return; }
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      // Si el envío del código falló, continuar el registro existente evita volver a crear la cuenta.
      const result = canResume ? signUp : await signUp.create({ emailAddress: email.trim(), password, unsafeMetadata: { registration_device: 'mobile' } });
      setPassword('');
      setConfirmation('');
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        continueAuthenticated();
      } else if (result.unverifiedFields.includes('email_address')) {
        let deliveryError = '';
        try { await signUp.prepareEmailAddressVerification({ strategy: 'email_code' }); }
        catch (err: any) { deliveryError = err?.errors?.[0]?.longMessage || err?.message || 'No se pudo enviar el código. Solicita uno nuevo.'; }
        navigation.navigate('EmailVerification', { email: email.trim(), mode: 'signup', codeSent: !deliveryError, initialError: deliveryError });
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
      if (isSignedIn) { continueAuthenticated(); return; }
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
    } finally { busy.current = false; setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Crear cuenta</Text>
          <Text>Regístrate para configurar tu negocio.</Text>
          <TextInput label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} mode="outlined" disabled={loading} />
          <TextInput label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} mode="outlined" disabled={loading || canResume} />
          <TextInput label="Confirmar contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} mode="outlined" disabled={loading || canResume} />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button mode="contained" onPress={submit} loading={loading} disabled={loading}>{canResume ? 'Continuar registro' : 'Crear cuenta'}</Button>
          <Button mode="outlined" onPress={google} disabled={loading}>Continuar con Google</Button>
          <Button onPress={() => navigation.navigate('Login')} disabled={loading}>Ya tengo una cuenta</Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  title: { fontSize: 28, fontWeight: '700', color: ui.colors.text },
  error: { color: ui.colors.danger },
});
