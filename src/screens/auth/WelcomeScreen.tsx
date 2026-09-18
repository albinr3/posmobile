import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { ui } from '../../theme/ui';

export const WELCOME_SEEN_STORAGE_KEY = 'movopos_welcome_seen_v1';

const SIGN_UP_URL = 'https://www.movopos.com/login?signup=true';

interface WelcomeScreenProps {
  navigation: any;
}

export function WelcomeScreen({ navigation }: WelcomeScreenProps) {
  const [isContinuing, setIsContinuing] = useState(false);

  const finishWelcome = async (openSignUp: boolean) => {
    if (isContinuing) return;

    setIsContinuing(true);
    try {
      // Se guarda antes de navegar para que esta pantalla solo se muestre una vez por dispositivo.
      await AsyncStorage.setItem(WELCOME_SEEN_STORAGE_KEY, '1');
      navigation.replace('Login');

      if (openSignUp) {
        const canOpen = await Linking.canOpenURL(SIGN_UP_URL);
        if (!canOpen) throw new Error('No se puede abrir el enlace de registro');
        await Linking.openURL(SIGN_UP_URL);
      }
    } catch (error) {
      console.warn('No se pudo completar la bienvenida:', error);
      if (openSignUp) {
        Alert.alert('No se pudo abrir el registro', 'Intenta nuevamente desde www.movopos.com.');
      }
    } finally {
      setIsContinuing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.orbTop} />
        <View style={styles.orbBottom} />
        <View style={styles.logoMark}>
          <View style={styles.logoBarShort} />
          <View style={styles.logoBarTall} />
          <View style={styles.logoBarMedium} />
        </View>
        <Text style={styles.brand}>MOVOpos</Text>
        <Text style={styles.tagline}>Tu negocio, siempre en movimiento.</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>¡Bienvenido!</Text>
        <Text style={styles.description}>
          Comienza a vender, administrar tu inventario y llevar el control de tu negocio desde un solo lugar.
        </Text>

        <Button
          mode="contained"
          onPress={() => void finishWelcome(false)}
          loading={isContinuing}
          disabled={isContinuing}
          buttonColor={ui.colors.primary}
          textColor="#fff"
          style={styles.primaryButton}
          contentStyle={styles.buttonContent}
        >
          Ya tengo una cuenta
        </Button>

        <TouchableOpacity
          onPress={() => void finishWelcome(true)}
          disabled={isContinuing}
          style={[styles.secondaryButton, isContinuing && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Deseo crear una cuenta"
        >
          <Text style={styles.secondaryButtonText}>Deseo crear una cuenta</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Gestiona tu negocio de forma simple y segura.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.surface,
  },
  hero: {
    flex: 0.9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: ui.colors.primary,
  },
  orbTop: {
    position: 'absolute',
    width: 290,
    height: 290,
    borderRadius: 145,
    top: -145,
    right: -76,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  orbBottom: {
    position: 'absolute',
    width: 235,
    height: 235,
    borderRadius: 118,
    bottom: -128,
    left: -78,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  logoMark: {
    width: 82,
    height: 82,
    borderRadius: 26,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 19,
    shadowColor: '#3D0878',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  logoBarShort: {
    width: 10,
    height: 18,
    borderRadius: 5,
    backgroundColor: ui.colors.primaryLight,
  },
  logoBarTall: {
    width: 10,
    height: 36,
    borderRadius: 5,
    backgroundColor: ui.colors.primary,
  },
  logoBarMedium: {
    width: 10,
    height: 26,
    borderRadius: 5,
    backgroundColor: ui.colors.primaryDark,
  },
  brand: {
    marginTop: 18,
    color: '#fff',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  tagline: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
  },
  content: {
    flex: 1.1,
    marginTop: -26,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: ui.colors.surface,
    paddingHorizontal: 24,
    paddingTop: 34,
  },
  title: {
    color: ui.colors.text,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    marginTop: 10,
    color: ui.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 30,
    borderRadius: ui.radius.lg,
  },
  buttonContent: {
    height: 52,
  },
  secondaryButton: {
    height: 52,
    marginTop: 12,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: ui.colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 12,
    color: ui.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
});
