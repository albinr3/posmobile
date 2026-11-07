import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { ui } from '../../theme/ui';
import { API_URL } from '../../services/apiConfig';

type SetupResponse = {
  success: boolean;
  user: NonNullable<ReturnType<typeof useAuthStore.getState>['subUser']>;
  token: string;
  account: { id: string };
};

export function SetupBusinessScreen({ navigation }: any) {
  const [businessName, setBusinessName] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const busy = useRef(false);
  const createdSession = useRef<SetupResponse | null>(null);
  const sessionStored = useRef(false);
  const { getToken, signOut } = useAuth();

  const submit = async () => {
    if (busy.current) return;
    if (!configured && (!businessName.trim() || !whatsappPhone.trim())) {
      setError('Ingresa el nombre del negocio y el número de WhatsApp.');
      return;
    }

    busy.current = true;
    setLoading(true);
    setError('');
    let setupSaved = !!createdSession.current;

    try {
      const clerkToken = await getToken();
      if (!clerkToken) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');

      if (!setupSaved) {
        const { data } = await axios.post<SetupResponse>(
          `${API_URL}/api/auth/setup`,
          { businessName: businessName.trim(), whatsappPhone: whatsappPhone.trim() },
          {
            timeout: 20000,
            headers: { 'X-Clerk-Authorization': `Bearer ${clerkToken}` },
          }
        );

        if (!data.success || !data.user || !data.token || !data.account?.id) {
          throw new Error('No se pudo iniciar la sesión.');
        }

        // Conservar la respuesta antes de SecureStore/SQLite: un fallo local no debe repetir el POST ya confirmado.
        createdSession.current = data;
        setupSaved = true;
        setConfigured(true);
      }

      syncService.setTokenGetter(getToken);
      syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);

      if (!sessionStored.current) {
        const data = createdSession.current!;
        await useAuthStore.getState().setSubUser(data.user, data.token, data.account.id, false);
        sessionStored.current = true;
        setSessionReady(true);
      }

      await syncService.fullSync(clerkToken, { ignoreCooldown: true, throwOnError: true });
      useAuthStore.getState().activateSubUser();
    } catch (err: any) {
      if (!setupSaved && err?.response?.status === 409) {
        navigation.replace('SelectUser');
      } else if (setupSaved) {
        setError(
          sessionStored.current
            ? 'Tu cuenta ya está creada, pero no se pudieron sincronizar los datos. Puedes reintentarlo o entrar y sincronizar después.'
            : 'Tu cuenta ya está creada, pero no se pudo guardar la sesión en este dispositivo. Reintenta para continuar.'
        );
      } else {
        const ambiguousNetworkFailure = !err?.response &&
          (['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(err?.code) || err?.message === 'Network Error');
        if (ambiguousNetworkFailure) {
          // Un fallo de transporte puede ocurrir después del commit. Consultar el
          // estado antes de sugerir otro envío; una cuenta configurada exige su PIN.
          try {
            const token = await getToken();
            if (token) {
              const { data } = await axios.get(`${API_URL}/api/auth/subusers`, {
                timeout: 10000,
                headers: { 'X-Clerk-Authorization': `Bearer ${token}` },
              });
              if (data.needsInitialSetup === false && data.users?.length > 0) {
                navigation.replace('SelectUser');
                return;
              }
            }
          } catch { /* La cuenta puede seguir pendiente o la conexión seguir caída. */ }
          setError('No se pudo confirmar la configuración por un problema de conexión. Tu cuenta de correo ya está creada. Reintenta sin registrarte nuevamente.');
        } else {
          setError(err?.response?.data?.error || err?.message || 'No se pudo guardar. Intenta de nuevo.');
        }
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  const closeSession = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      await signOut();
      await useAuthStore.getState().logout();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch {
      setError('No se pudo cerrar la sesión. Intenta nuevamente.');
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
            <View style={styles.badge}>
              <Text style={styles.badgeText}>CONFIGURACIÓN INICIAL</Text>
            </View>
            <Text style={styles.heroTitle}>Configura tu negocio</Text>
            <Text style={styles.heroSubtitle}>Prepara tu punto de venta en pocos segundos</Text>
          </View>

          <View style={styles.panel}>
            <View style={styles.infoCard}>
              <View style={styles.infoIconBox}>
                <Text style={styles.infoIcon}>🔑</Text>
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Usuario Administrador</Text>
                <Text style={styles.infoDescription}>
                  Se creará tu usuario <Text style={styles.infoBold}>admin</Text> con PIN temporal{' '}
                  <Text style={styles.infoBold}>1234</Text>. Podrás cambiarlo más tarde en ajustes.
                </Text>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Nombre del negocio *</Text>
              <TextInput
                accessibilityLabel="Nombre del negocio"
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="Ej. Comercial Los Ángeles"
                placeholderTextColor={ui.colors.textMuted}
                style={styles.input}
                editable={!configured && !loading}
                maxLength={200}
              />
              <Text style={styles.fieldHint}>Nombre que aparecerá en tus facturas y reportes</Text>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Número de WhatsApp *</Text>
              <TextInput
                accessibilityLabel="WhatsApp"
                value={whatsappPhone}
                onChangeText={setWhatsappPhone}
                placeholder="Ej. +1 809 555 0123"
                placeholderTextColor={ui.colors.textMuted}
                keyboardType="phone-pad"
                style={styles.input}
                editable={!configured && !loading}
                maxLength={50}
              />
              <Text style={styles.fieldHint}>Para compartir recibos digitales y notificaciones</Text>
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Button
              mode="contained"
              onPress={submit}
              loading={loading}
              disabled={loading || (!configured && (!businessName.trim() || !whatsappPhone.trim()))}
              buttonColor={ui.colors.primary}
              textColor="#fff"
              style={styles.primaryButton}
              contentStyle={styles.buttonContent}
            >
              {configured ? 'Reintentar sincronización' : 'Guardar y continuar'}
            </Button>

            {sessionReady && (
              <Button
                mode="outlined"
                disabled={loading}
                onPress={() => useAuthStore.getState().activateSubUser()}
                textColor={ui.colors.primary}
                style={styles.secondaryButton}
                contentStyle={styles.buttonContent}
              >
                Entrar y sincronizar después
              </Button>
            )}

            <TouchableOpacity
              disabled={loading}
              onPress={closeSession}
              style={styles.logoutButton}
            >
              <Text style={styles.logoutButtonText}>Cerrar sesión de correo</Text>
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
    paddingTop: 32,
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
  badge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  panel: {
    flex: 1,
    marginTop: -24,
    backgroundColor: ui.colors.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 36,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#F7F3FF',
    borderWidth: 1,
    borderColor: '#E8DCFC',
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 20,
    alignItems: 'center',
  },
  infoIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECE0FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoIcon: {
    fontSize: 20,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: ui.colors.primaryDark,
    marginBottom: 2,
  },
  infoDescription: {
    fontSize: 12,
    color: ui.colors.textMuted,
    lineHeight: 17,
  },
  infoBold: {
    fontWeight: '700',
    color: ui.colors.text,
  },
  fieldGroup: {
    marginBottom: 16,
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
  fieldHint: {
    fontSize: 11,
    color: ui.colors.textMuted,
    marginTop: 4,
    marginLeft: 2,
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
    marginTop: 8,
    borderRadius: ui.radius.lg,
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: ui.radius.lg,
    borderColor: ui.colors.primary,
  },
  buttonContent: {
    height: 50,
  },
  logoutButton: {
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  logoutButtonText: {
    fontSize: 14,
    color: ui.colors.textMuted,
    fontWeight: '500',
  },
});
