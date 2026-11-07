import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TextInput as RNTextInput } from 'react-native';
import { Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';

interface EmailVerificationScreenProps {
  navigation: any;
  route?: {
    params?: {
      email?: string;
      emailAddressId?: string;
      mode?: 'signup' | 'signin';
      codeSent?: boolean;
      initialError?: string;
    };
  };
}

export function EmailVerificationScreen({ navigation, route }: EmailVerificationScreenProps) {
  const email = route?.params?.email || '';
  const emailAddressId = route?.params?.emailAddressId;
  const isSignUp = route?.params?.mode === 'signup';
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(route?.params?.codeSent === false ? 0 : 60);
  const inputRefs = useRef<(RNTextInput | null)[]>([]);
  const { isLoaded, signIn, setActive } = useSignIn();
  const signUpState = useSignUp();
  const busy = useRef(false);
  const [errorMessage, setErrorMessage] = useState(route?.params?.initialError || '');

  useEffect(() => {
    setCode(['', '', '', '', '', '']);
    setErrorMessage(route?.params?.initialError || '');
    setResendTimer(route?.params?.codeSent === false ? 0 : 60);
  }, [email, emailAddressId, isSignUp, route?.params?.codeSent, route?.params?.initialError]);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleChange = (value: string, index: number) => {
    if (value.length > 1) {
      value = value[0];
    }

    const next = [...code];
    next[index] = value;
    setCode(next);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d !== '')) {
      verifyCode(next.join(''));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyCode = async (otp: string) => {
    if (busy.current || otp.length !== 6) return;
    busy.current = true;
    setLoading(true);
    setErrorMessage('');
    try {
      if (isSignUp ? !signUpState.isLoaded || !signUpState.signUp : !isLoaded || !signIn) throw new Error('La autenticación aún no está lista.');
      const resource = isSignUp ? signUpState.signUp! : signIn!;
      // La verificación puede haber terminado aunque setActive falle por falta de red.
      // Reintentar la activación sin volver a consumir un código ya verificado.
      const result = resource.status === 'complete' ? resource : isSignUp
        ? await signUpState.signUp!.attemptEmailAddressVerification({ code: otp })
        : await signIn!.attemptFirstFactor({ strategy: 'email_code', code: otp });

      if (result.status !== 'complete' || !result.createdSessionId) throw new Error('Faltan pasos para completar la autenticación.');
      await (isSignUp ? signUpState.setActive : setActive)!({ session: result.createdSessionId });
      navigation.reset({ index: 0, routes: [{ name: 'BiometricSetup' }] });
    } catch (error: any) {
      console.error('Error verificando código:', error);
      setErrorMessage(error?.errors?.[0]?.longMessage || error?.message || 'No se pudo verificar el código.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (busy.current || resendTimer > 0) return;
    busy.current = true;
    setLoading(true);
    setErrorMessage('');
    try {
      if (isSignUp) {
        if (!signUpState.isLoaded || !signUpState.signUp) throw new Error('La autenticación aún no está lista.');
        await signUpState.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      } else {
        if (!isLoaded || !signIn) throw new Error('La autenticación aún no está lista.');
        if (!emailAddressId) throw new Error('No se encontró el correo de verificación. Vuelve al inicio de sesión.');
        await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId });
      }
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setResendTimer(60);
    } catch (error: any) {
      console.error('Error reenviando código:', error);
      setErrorMessage(error?.errors?.[0]?.longMessage || error?.message || 'No se pudo reenviar el código.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Surface style={styles.card}>
          <Text style={styles.title}>{isSignUp ? 'Verifica tu registro' : 'Verifica tu acceso'}</Text>
          <Text style={styles.description}>
            Ingresa el código enviado a{'\n'}
            <Text style={styles.email}>{email}</Text>
          </Text>

          <View style={styles.codeContainer}>
            {code.map((digit, index) => (
              <RNTextInput
                key={index}
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={styles.codeInput}
                value={digit}
                editable={!loading}
                onChangeText={(value) => handleChange(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          {!!errorMessage && <Text style={{ color: '#b00020', textAlign: 'center' }}>{errorMessage}</Text>}
          <Button
            mode="contained"
            onPress={() => verifyCode(code.join(''))}
            loading={loading}
            disabled={loading || code.some((d) => d === '')}
            style={styles.button}
          >
            Verificar
          </Button>

          <View style={styles.resendContainer}>
            {resendTimer > 0 ? (
              <Text style={styles.resendText}>Reenviar código en {resendTimer}s</Text>
            ) : (
              <Button mode="text" onPress={handleResend} disabled={loading}>
                Reenviar código
              </Button>
            )}
          </View>
        </Surface>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    padding: 24,
    borderRadius: 12,
    elevation: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  email: {
    fontWeight: '600',
    color: '#1a73e8',
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
  },
  codeInput: {
    width: 45,
    height: 55,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 8,
    fontSize: 24,
    textAlign: 'center',
    backgroundColor: '#fff',
  },
  button: {
    marginTop: 8,
  },
  resendContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  resendText: {
    color: '#666',
  },
});
