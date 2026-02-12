import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TextInput as RNTextInput } from 'react-native';
import { Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSignIn } from '@clerk/clerk-expo';

interface OTPVerificationScreenProps {
  navigation: any;
  route?: {
    params?: {
      phone?: string;
      phoneNumberId?: string;
    };
  };
}

export function OTPVerificationScreen({ navigation, route }: OTPVerificationScreenProps) {
  const phone = route?.params?.phone || '';
  const phoneNumberId = route?.params?.phoneNumberId;
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
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

  const handleOtpChange = (value: string, index: number) => {
    if (value.length > 1) {
      value = value[0];
    }
    
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (newOtp.every(digit => digit !== '')) {
      verifyOTP(newOtp.join(''));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyOTP = async (code: string) => {
    setLoading(true);
    try {
      if (!isLoaded || !signIn) {
        return;
      }

      const result = await signIn.attemptFirstFactor({
        strategy: 'phone_code',
        code,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
      }

      navigation.navigate('BiometricSetup');
    } catch (error) {
      console.error('Error verificando OTP:', error);
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

      if (phoneNumberId) {
        await signIn.prepareFirstFactor({ strategy: 'phone_code', phoneNumberId });
        return;
      }

      await signIn.create({ identifier: phone });
      const factors = (signIn.supportedFirstFactors as any[]) || [];
      const phoneCodeFactor = factors.find(
        (factor: any) => factor.strategy === 'phone_code'
      );
      const inferredPhoneNumberId = phoneCodeFactor?.phoneNumberId;
      if (!inferredPhoneNumberId) {
        throw new Error('No phone_code factor available for this identifier');
      }

      await signIn.prepareFirstFactor({
        strategy: 'phone_code',
        phoneNumberId: inferredPhoneNumberId,
      });
    } catch (error) {
      console.error('Error reenviando OTP:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Surface style={styles.card}>
          <Text style={styles.title}>Verificación</Text>
          <Text style={styles.description}>
            Ingresa el código de 6 dígitos enviado a{'\n'}
            <Text style={styles.phone}>{phone}</Text>
          </Text>

          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <RNTextInput
                key={index}
                ref={(ref) => { inputRefs.current[index] = ref; }}
                style={styles.otpInput}
                value={digit}
                onChangeText={(value) => handleOtpChange(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          <Button
            mode="contained"
            onPress={() => verifyOTP(otp.join(''))}
            loading={loading}
            disabled={loading || otp.some(d => d === '')}
            style={styles.button}
          >
            Verificar
          </Button>

          <View style={styles.resendContainer}>
            {resendTimer > 0 ? (
              <Text style={styles.resendText}>
                Reenviar código en {resendTimer}s
              </Text>
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
  phone: {
    fontWeight: '600',
    color: '#1a73e8',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
  },
  otpInput: {
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
