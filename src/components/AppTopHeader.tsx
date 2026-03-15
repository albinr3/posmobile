import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Text, Icon, Menu } from 'react-native-paper';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { ui } from '../theme/ui';

type BillingStateResponse = {
  status: string;
  isTrialing: boolean;
  trialDaysRemaining: number | null;
};

type BillingStateCacheEntry = {
  fetchedAt: number;
  data: BillingStateResponse | null;
};

type CompanySettingsResponse = {
  company?: {
    logo?: string | null;
    nombre?: string | null;
    telefono?: string | null;
    direccion?: string | null;
  } | null;
  name?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  address?: string | null;
};

type CompanyHeaderData = {
  name: string;
  phone: string;
  logoUrl: string | null;
};

const BILLING_STATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BILLING_STATE_STORAGE_PREFIX = 'movopos_billing_state_v1:';
const billingStateCache = new Map<string, BillingStateCacheEntry>();
const billingStateInFlight = new Map<string, Promise<BillingStateResponse | null>>();

function normalizeCompanySettings(apiUrl: string, payload: CompanySettingsResponse | null | undefined): CompanyHeaderData {
  const rawLogo = payload?.company?.logo ?? payload?.logoUrl ?? null;
  const trimmedLogo = rawLogo && String(rawLogo).trim() ? String(rawLogo).trim() : null;
  const isAbsoluteLogo = !!trimmedLogo && /^https?:\/\//i.test(trimmedLogo);
  const logoUrl = trimmedLogo
    ? isAbsoluteLogo
      ? trimmedLogo
      : `${apiUrl}${trimmedLogo.startsWith('/') ? '' : '/'}${trimmedLogo}`
    : null;

  return {
    name: payload?.company?.nombre?.trim() || payload?.name?.trim() || 'MOVOpos',
    phone: payload?.company?.telefono?.trim() || payload?.phone?.trim() || '',
    logoUrl,
  };
}

function getBillingStateStorageKey(cacheKey: string): string {
  return `${BILLING_STATE_STORAGE_PREFIX}${cacheKey}`;
}

function isBillingStateCacheEntry(value: any): value is BillingStateCacheEntry {
  return value && typeof value.fetchedAt === 'number' && ('data' in value);
}

async function readPersistedBillingStateCache(cacheKey: string): Promise<BillingStateCacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(getBillingStateStorageKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isBillingStateCacheEntry(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePersistedBillingStateCache(cacheKey: string, entry: BillingStateCacheEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(getBillingStateStorageKey(cacheKey), JSON.stringify(entry));
  } catch {
    // no-op
  }
}

export function AppTopHeader() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const { user, subUser, subUserToken, accountId, setSubUser } = useAuthStore();
  const displayName = subUser?.name || user?.name || 'Usuario';
  const subUserName = subUser?.name || subUser?.username || 'Sin subusuario';
  const clerkEmail = clerkUser?.primaryEmailAddress?.emailAddress || user?.email || 'Sin correo en Clerk';
  const avatarLetter = (displayName || 'U').charAt(0).toUpperCase();
  const [billingState, setBillingState] = useState<BillingStateResponse | null>(null);
  const [companyData, setCompanyData] = useState<CompanyHeaderData>({ name: 'MOVOpos', phone: '', logoUrl: null });
  const [logoLoadError, setLogoLoadError] = useState(false);
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);
  const getTokenRef = useRef(getToken);
  const refreshBillingStateRef = useRef<(forceRefresh?: boolean) => Promise<void>>(async () => {});
  getTokenRef.current = getToken;

  useEffect(() => {
    let mounted = true;
    const cacheKey = accountId || subUserToken || 'default';
    let ownsInFlightEntry = false;

    const loadBillingState = async (forceRefresh = false) => {
      try {
        if (!subUserToken) {
          if (mounted) setBillingState(null);
          return;
        }

        if (!forceRefresh) {
          const now = Date.now();
          let cached = billingStateCache.get(cacheKey);

          if (!cached) {
            const persisted = await readPersistedBillingStateCache(cacheKey);
            if (persisted) {
              billingStateCache.set(cacheKey, persisted);
              cached = persisted;
            }
          }

          if (cached && now - cached.fetchedAt < BILLING_STATE_CACHE_TTL_MS) {
            if (mounted) setBillingState(cached.data);
            return;
          }
        }

        const existingRequest = billingStateInFlight.get(cacheKey);
        if (existingRequest) {
          const existingResult = await existingRequest;
          if (mounted) setBillingState(existingResult);
          return;
        }

        const requestPromise = (async (): Promise<BillingStateResponse | null> => {
          const clerkToken = await getTokenRef.current();
          if (!clerkToken) return null;

          const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
          const response = await axios.get(`${API_URL}/api/billing/state`, {
            headers: {
              Authorization: `Bearer ${clerkToken}`,
              'X-Clerk-Authorization': `Bearer ${clerkToken}`,
              'X-SubUser-Token': subUserToken,
              ...(accountId ? { 'X-Account-Id': accountId } : {}),
            },
          });

          return response.data || null;
        })();

        billingStateInFlight.set(cacheKey, requestPromise);
        ownsInFlightEntry = true;
        const freshData = await requestPromise;
        const nextCacheEntry: BillingStateCacheEntry = { fetchedAt: Date.now(), data: freshData };
        billingStateCache.set(cacheKey, nextCacheEntry);
        await writePersistedBillingStateCache(cacheKey, nextCacheEntry);

        if (!mounted) return;
        setBillingState(freshData);
      } catch (error) {
        if (!mounted) return;
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) {
            await setSubUser(null, null, null);
            setBillingState(null);
            return;
          }
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
      } finally {
        if (ownsInFlightEntry) {
          billingStateInFlight.delete(cacheKey);
        }
      }
    };

    refreshBillingStateRef.current = (forceRefresh = false) => loadBillingState(forceRefresh);
    loadBillingState();
    return () => {
      mounted = false;
      refreshBillingStateRef.current = async () => {};
    };
  }, [accountId, subUserToken]);

  useEffect(() => {
    let mounted = true;

    const loadCompanySettings = async () => {
      try {
        if (!subUserToken) {
          if (mounted) {
            setCompanyData({ name: 'MOVOpos', phone: '', logoUrl: null });
            setLogoLoadError(false);
          }
          return;
        }

        const clerkToken = await getTokenRef.current();
        if (!clerkToken) return;

        const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
        const response = await axios.get(`${API_URL}/api/company-settings`, {
          headers: {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': subUserToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
          },
        });

        if (!mounted) return;
        setCompanyData(normalizeCompanySettings(API_URL, response.data));
        setLogoLoadError(false);
      } catch (error) {
        if (!mounted) return;
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) {
            await setSubUser(null, null, null);
            return;
          }
          console.warn('No se pudo cargar informacion de empresa.', {
            status: error.response?.status,
            message: error.message,
          });
        } else {
          console.warn('No se pudo cargar informacion de empresa.');
        }
      }
    };

    loadCompanySettings();
    return () => {
      mounted = false;
    };
  }, [accountId, subUserToken]);

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
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('BillingPlansMenu', { screen: 'BillingPlans' });
            }}
          >
            <Text style={styles.trialLink}>Elegir plan</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.topHeader}>
        <View style={styles.topLeft}>
          <TouchableOpacity style={styles.menuButton} onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}>
            <Icon source="menu" size={30} color={ui.colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.userBadge}>
            <Image
              source={
                companyData.logoUrl && !logoLoadError
                  ? { uri: companyData.logoUrl }
                  : require('../../assets/movoLogo.png')
              }
              style={styles.userBadgeLogo}
              resizeMode="contain"
              onError={() => setLogoLoadError(true)}
            />
          </View>
          <View style={styles.companyMeta}>
            <Text style={styles.userName} numberOfLines={1}>
              {companyData.name}
            </Text>
          </View>
        </View>
        <Menu
          visible={profileMenuVisible}
          onDismiss={() => setProfileMenuVisible(false)}
          contentStyle={styles.profileMenu}
          anchor={
            <TouchableOpacity
              style={styles.avatarButton}
              activeOpacity={0.8}
              onPress={() => setProfileMenuVisible(true)}
            >
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarLetter}>{avatarLetter}</Text>
              </View>
            </TouchableOpacity>
          }
        >
          <View style={styles.profileMenuContent}>
            <Text style={styles.profileLabel}>Empresa</Text>
            <Text style={styles.profileValue}>{companyData.name}</Text>
            {companyData.phone ? (
              <>
                <Text style={styles.profileLabel}>Telefono</Text>
                <Text style={styles.profileValue}>{companyData.phone}</Text>
              </>
            ) : null}
            <Text style={styles.profileLabel}>Subusuario</Text>
            <Text style={styles.profileValue}>{subUserName}</Text>
            <Text style={styles.profileLabel}>Correo Clerk</Text>
            <Text style={styles.profileValue}>{clerkEmail}</Text>
          </View>
        </Menu>
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
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userBadge: {
    width: 50,
    height: 36,
    borderRadius: 9,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  userBadgeLogo: { width: 46, height: 30 },
  companyMeta: { flex: 1, minWidth: 0 },
  userName: { color: ui.colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1 },
  avatarButton: { borderRadius: 20 },
  avatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E9D5FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: ui.colors.primary, fontSize: 13, fontWeight: '800' },
  profileMenu: {
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  profileMenuContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 220,
    maxWidth: 280,
  },
  profileLabel: {
    color: ui.colors.textMuted,
    fontSize: 12,
    marginBottom: 2,
  },
  profileValue: {
    color: ui.colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
});
