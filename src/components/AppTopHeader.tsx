import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text, Icon } from 'react-native-paper';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { ui } from '../theme/ui';

type BillingStateResponse = {
  status: string;
  isTrialing: boolean;
  trialDaysRemaining: number | null;
};

export function AppTopHeader() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user, subUser, subUserToken, accountId } = useAuthStore();
  const displayName = subUser?.name || user?.name || 'Usuario';
  const avatarLetter = (displayName || 'U').charAt(0).toUpperCase();
  const [billingState, setBillingState] = useState<BillingStateResponse | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadBillingState = async () => {
      try {
        if (!subUserToken) {
          if (mounted) setBillingState(null);
          return;
        }

        const clerkToken = await getToken();
        if (!clerkToken) {
          if (mounted) setBillingState(null);
          return;
        }

        const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
        const response = await axios.get(`${API_URL}/api/billing/state`, {
          headers: {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': subUserToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
          },
        });

        if (!mounted) return;
        setBillingState(response.data || null);
      } catch (error) {
        if (!mounted) return;
        if (axios.isAxiosError(error)) {
          // En mobile dev es normal perder conectividad al volver del background.
          // Evitamos LogBox rojo por errores de red esperados.
          const isNetworkError = !error.response && error.message === 'Network Error';
          if (isNetworkError) {
            console.warn('No se pudo cargar estado de prueba (sin conexion temporal).');
          } else {
            console.warn('No se pudo cargar estado de prueba.', {
              status: error.response?.status,
              message: error.message,
            });
          }
        } else {
          console.warn('No se pudo cargar estado de prueba.');
        }
        setBillingState(null);
      }
    };

    loadBillingState();
    return () => {
      mounted = false;
    };
  }, [accountId, getToken, subUserToken]);

  const trialMessage = useMemo(() => {
    if (!billingState?.isTrialing) return null;
    const days = Number(billingState.trialDaysRemaining ?? 0);
    if (days <= 0) return 'Tu prueba vence hoy.';
    if (days === 1) return 'Te queda 1 día de prueba.';
    return `Te quedan ${days} días de prueba.`;
  }, [billingState]);

  return (
    <View style={{ paddingTop: insets.top }}>
      {trialMessage ? (
        <View style={styles.trialBar}>
          <Icon source="clock-outline" size={14} color="#7A5200" />
          <Text style={styles.trialText}>{trialMessage}</Text>
          <Text style={styles.trialLink}>Elegir plan</Text>
        </View>
      ) : null}

      <View style={styles.topHeader}>
        <View style={styles.topLeft}>
          <TouchableOpacity style={styles.menuButton} onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}>
            <Icon source="menu" size={22} color={ui.colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.userBadge}>
            <Image source={require('../../assets/movoLogo.png')} style={styles.userBadgeLogo} resizeMode="contain" />
          </View>
          <Text style={styles.userName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>{avatarLetter}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trialBar: {
    backgroundColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  trialText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  trialLink: { color: '#fff', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  topHeader: {
    backgroundColor: ui.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 8 },
  menuButton: { borderRadius: 16, marginRight: 6, padding: 2 },
  userBadge: {
    width: 30,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  userBadgeLogo: { width: 24, height: 14 },
  userName: { color: ui.colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  avatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E9D5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: ui.colors.primary, fontSize: 13, fontWeight: '800' },
});
