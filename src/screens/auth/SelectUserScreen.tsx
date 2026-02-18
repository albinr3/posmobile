import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Text, Avatar, Button } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { ui } from '../../theme/ui';
import { useAuthStore } from '../../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';

interface SubUser {
  id: string;
  name: string;
  username: string;
  role: string;
  isOwner: boolean;
  email?: string | null;
}

interface SelectUserScreenProps {
  navigation: any;
}

export function SelectUserScreen({ navigation }: SelectUserScreenProps) {
  const [users, setUsers] = useState<SubUser[]>([]);
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getToken, signOut } = useAuth();
  const { logout } = useAuthStore();

  useEffect(() => {
    loadSubUsers();
  }, []);

  const loadSubUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) {
        setError('No hay token de autenticación');
        return;
      }

      const response = await axios.get(`${API_URL}/api/auth/subusers`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Clerk-Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      setAccount(response.data.account);
      setUsers(response.data.users || []);
      if (response.data.message && response.data.needsSetup) setError(response.data.message);
    } catch (err: any) {
      console.error('Error cargando subusuarios:', err);
      setError(err.response?.data?.error || 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectUser = (selectedUser: SubUser) => {
    navigation.navigate('SubUserLogin', {
      userId: selectedUser.id,
      username: selectedUser.username,
      accountId: account?.id,
    });
  };

  const handleClerkLogout = () => {
    Alert.alert('Cerrar sesión', '¿Deseas cerrar la sesión principal (correo)?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            await logout();
            navigation.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          } catch (error) {
            console.error('Error cerrando sesión de Clerk:', error);
            Alert.alert('Sesión', 'No se pudo cerrar sesión. Intenta de nuevo.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={ui.colors.primary} />
          <Text style={styles.stateText}>Cargando usuarios...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <Button mode="contained" buttonColor={ui.colors.primary} onPress={loadSubUsers}>
            Reintentar
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>Selecciona tu perfil</Text>
        <Text style={styles.subtitle}>{account?.name || 'MOVOpos'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {users.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No hay usuarios disponibles</Text>
            <Text style={styles.emptySubtitle}>Contacta al administrador para crear usuarios.</Text>
          </View>
        ) : (
          users.map((subUser) => (
            <TouchableOpacity key={subUser.id} style={styles.userCard} onPress={() => handleSelectUser(subUser)}>
              <Avatar.Text
                size={44}
                label={subUser.name.substring(0, 2).toUpperCase()}
                style={styles.avatar}
                labelStyle={styles.avatarLabel}
              />
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{subUser.name}</Text>
                <Text style={styles.userMeta}>
                  @{subUser.username} • {subUser.role}
                  {subUser.isOwner ? ' • Propietario' : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))
        )}

        <Button
          mode="outlined"
          style={styles.logoutButton}
          textColor={ui.colors.danger}
          onPress={handleClerkLogout}
          icon="logout"
        >
          Cerrar sesión de correo
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  hero: {
    backgroundColor: ui.colors.primary,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  title: { color: '#fff', fontSize: 25, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.85)', marginTop: 6, fontSize: 14 },
  scrollContent: { padding: 16, gap: 10 },
  userCard: {
    backgroundColor: ui.colors.surface,
    borderRadius: ui.radius.lg,
    borderWidth: 1,
    borderColor: ui.colors.border,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: { backgroundColor: '#EEE1FF' },
  avatarLabel: { color: ui.colors.primary, fontWeight: '700' },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '700', color: ui.colors.text },
  userMeta: { fontSize: 12, color: ui.colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 28, color: ui.colors.primary, lineHeight: 28 },
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  stateText: { marginTop: 10, color: ui.colors.textMuted },
  errorText: { color: ui.colors.danger, marginBottom: 12, textAlign: 'center' },
  emptyCard: {
    borderRadius: ui.radius.lg,
    padding: 20,
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  emptyTitle: { color: ui.colors.text, fontSize: 18, fontWeight: '700' },
  emptySubtitle: { color: ui.colors.textMuted, marginTop: 6 },
  logoutButton: {
    marginTop: 14,
    borderColor: '#F3B4B4',
    backgroundColor: '#FFF7F7',
  },
});

