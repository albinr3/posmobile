import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuthStore } from '../../store/authStore';
import { useUser } from '@clerk/clerk-expo';
import {
  isBiometricAvailable,
  promptBiometric,
  setBiometricEnabledPreference,
} from '../../services/auth/biometricAuthService';

interface BiometricSetupScreenProps {
  navigation: any;
}

export function BiometricSetupScreen({ navigation }: BiometricSetupScreenProps) {
  const [hasHardware, setHasHardware] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setBiometricEnabled, setUser } = useAuthStore();
  const { user } = useUser();
  const busy = useRef(false);

  useEffect(() => {
    checkBiometricSupport();
  }, []);

  const checkBiometricSupport = async () => {
    try {
      const availability = await isBiometricAvailable();
      setHasHardware(availability.hasHardware);
      setIsEnrolled(availability.isEnrolled);
    } catch (error) {
      console.error('Error validando biometria:', error);
      setHasHardware(false);
      setIsEnrolled(false);
    }
  };

  const handleEnableBiometric = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const availability = await isBiometricAvailable();
      if (!availability.isAvailable) {
        Alert.alert('Biometria', 'Tu dispositivo no tiene biometria disponible o configurada.');
        return;
      }

      const result = await promptBiometric('Activa acceso biometrico en MOVOPos');

      if (result.success) {
        await setBiometricEnabledPreference(true);
        setBiometricEnabled(true);
        if (user) {
          setUser({
            id: user.id,
            name: user.fullName || user.firstName || 'Usuario',
            phone: user.primaryPhoneNumber?.phoneNumber,
            email: user.primaryEmailAddress?.emailAddress,
            companyId: '',
            role: '',
          });
        }
        navigateToHome();
        return;
      }
      await setBiometricEnabledPreference(false);
      setBiometricEnabled(false);
    } catch (error) {
      console.error('Error configurando biométrico:', error);
      Alert.alert('Biometria', 'No se pudo activar el acceso biometrico.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const navigateToHome = () => {
    // Navegar a la pantalla de selección de subusuario
    navigation.replace('SelectUser');
  };

  const handleSkip = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
    await setBiometricEnabledPreference(false);
    setBiometricEnabled(false);
    if (user) {
      setUser({
        id: user.id,
        name: user.fullName || user.firstName || 'Usuario',
        phone: user.primaryPhoneNumber?.phoneNumber,
        email: user.primaryEmailAddress?.emailAddress,
        companyId: '',
        role: '',
      });
    }
    navigateToHome();
    } catch (error) {
      console.error('Error guardando preferencia biométrica:', error);
      Alert.alert('Biometría', 'No se pudo guardar la preferencia. Intenta nuevamente.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Surface style={styles.card}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🔐</Text>
          </View>

          <Text style={styles.title}>Acceso Rápido</Text>
          
          {hasHardware && isEnrolled ? (
            <>
              <Text style={styles.description}>
                Habilita el acceso con huella digital o Face ID para iniciar sesión más rápido
              </Text>

              <Button
                mode="contained"
                onPress={handleEnableBiometric}
                loading={loading}
                disabled={loading}
                style={styles.button}
                contentStyle={styles.buttonContent}
                icon="fingerprint"
              >
                Habilitar Biométrico
              </Button>

              <Button
                mode="text"
                onPress={handleSkip}
                disabled={loading}
                style={styles.skipButton}
              >
                Omitir por ahora
              </Button>
            </>
          ) : (
            <>
              <Text style={styles.description}>
                {!hasHardware 
                  ? 'Tu dispositivo no tiene soporte para autenticación biométrica'
                  : 'No tienes huellas o Face ID registrados en tu dispositivo'
                }
              </Text>

              <Button
                mode="contained"
                onPress={handleSkip}
                disabled={loading}
                style={styles.button}
                contentStyle={styles.buttonContent}
              >
                Continuar
              </Button>
            </>
          )}
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
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 20,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  button: {
    width: '100%',
    marginTop: 8,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  skipButton: {
    marginTop: 12,
  },
});
