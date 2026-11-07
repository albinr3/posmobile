import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { ui } from '../../theme/ui';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
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
        const { data } = await axios.post<SetupResponse>(`${API_URL}/api/auth/setup`,
          { businessName: businessName.trim(), whatsappPhone: whatsappPhone.trim() },
          { timeout: 20000, headers: { 'X-Clerk-Authorization': `Bearer ${clerkToken}` } });
        if (!data.success || !data.user || !data.token || !data.account?.id) throw new Error('No se pudo iniciar la sesión.');
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
        setError(sessionStored.current
          ? 'Tu cuenta ya está creada, pero no se pudieron sincronizar los datos. Puedes reintentarlo o entrar y sincronizar después.'
          : 'Tu cuenta ya está creada, pero no se pudo guardar la sesión en este dispositivo. Reintenta para continuar.');
      } else {
        setError(err?.response?.data?.error || err?.message || 'No se pudo guardar. Intenta de nuevo.');
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
    } catch { setError('No se pudo cerrar la sesión. Intenta nuevamente.'); }
    finally { busy.current = false; setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Configura tu negocio</Text>
          <TextInput label="Nombre del negocio" value={businessName} onChangeText={setBusinessName} mode="outlined" editable={!configured && !loading} maxLength={200} />
          <TextInput label="WhatsApp" value={whatsappPhone} onChangeText={setWhatsappPhone} keyboardType="phone-pad" mode="outlined" editable={!configured && !loading} maxLength={50} />
          <Text>Se creará el usuario admin con PIN temporal 1234. Este PIN es distinto de la contraseña de tu cuenta.</Text>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button mode="contained" onPress={submit} loading={loading} disabled={loading}>{configured ? 'Reintentar' : 'Guardar y continuar'}</Button>
          {sessionReady && <Button disabled={loading} onPress={() => useAuthStore.getState().activateSubUser()}>Entrar y sincronizar después</Button>}
          <Button disabled={loading} onPress={closeSession}>Cerrar sesión de correo</Button>
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
