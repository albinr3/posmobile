import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TextInput as RNTextInput } from 'react-native';
import { Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSignIn } from '@clerk/clerk-expo';

interface EmailVerificationScreenProps {
  navigation: any;
  route?: {
    params?: {
      email?: string;
      emailAddressId?: string;
    };
  };
}

export function EmailVerificationScreen({ navigation, route }: EmailVerificationScreenProps) {
  const email = route?.params?.email || '';
  const emailAddressId = route?.params?.emailAddressId;
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const inputRefs = useRef<(RNTextInput | null)[]>([]);
  const { isLoaded, signIn, setActive } = useSignIn();

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
    setLoading(true);
    try {
      if (!isLoaded || !signIn) {
        return;
      }

      const result = await signIn.attemptFirstFactor({
        strategy: 'email_code',
        code: otp,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
      }

      navigation.navigate('BiometricSetup');
    } catch (error) {
      console.error('Error verificando código:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendTimer(60);
    try {
      if (!isLoaded || !signIn) {
        return;
      }

      if (!emailAddressId) {
        throw new Error('Missing emailAddressId');
      }

      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId,
      } as any);
    } catch (error) {
      console.error('Error reenviando código:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Surface style={styles.card}>
          <Text style={styles.title}>Verificación</Text>
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
                onChangeText={(value) => handleChange(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

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
              <Button mode="text" onPress={handleResend}>
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
