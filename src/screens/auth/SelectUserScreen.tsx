import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Text, Surface, Button, List, Avatar, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import axios from 'axios';

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
  const { getToken } = useAuth();
  const { setSubUser, user } = useAuthStore();

  useEffect(() => {
    loadSubUsers();
  }, []);

  const loadSubUsers = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      console.log('🔍 [SelectUserScreen] Token obtenido:', token ? `${token.substring(0, 20)}...` : 'null');
      if (!token) {
        setError('No hay token de autenticación');
        return;
      }

      console.log('🔍 [SelectUserScreen] Enviando petición a:', `${API_URL}/api/auth/subusers`);
      console.log('🔍 [SelectUserScreen] Header Authorization completo:', `Bearer ${token.substring(0, 30)}...`);
      
      const response = await axios.get(`${API_URL}/api/auth/subusers`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Clerk-Authorization': `Bearer ${token}`, // Header personalizado para evitar interceptación de Vercel
          'Content-Type': 'application/json',
        },
      });

      setAccount(response.data.account);
      setUsers(response.data.users || []);
      
      // Si hay un mensaje de que no hay usuarios, mostrarlo
      if (response.data.message && response.data.needsSetup) {
        setError(response.data.message);
      }
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#1a73e8" />
          <Text style={styles.loadingText}>Cargando usuarios...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error}</Text>
          <Button
            mode="contained"
            onPress={loadSubUsers}
            style={styles.retryButton}
          >
            Reintentar
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  if (users.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>No hay usuarios disponibles</Text>
          <Text style={styles.description}>
            Contacta al administrador para crear un usuario
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Seleccionar Usuario</Text>
          {account && (
            <Text style={styles.subtitle}>{account.name}</Text>
          )}
        </View>

        <Surface style={styles.card}>
          <Text style={styles.cardTitle}>Selecciona tu usuario</Text>
          <Text style={styles.cardDescription}>
            Elige el usuario con el que deseas trabajar
          </Text>

          <Divider style={styles.divider} />

          {users.map((subUser, index) => (
            <React.Fragment key={subUser.id}>
              <List.Item
                title={subUser.name}
                description={`@${subUser.username} • ${subUser.role}${subUser.isOwner ? ' • Propietario' : ''}`}
                left={(props) => (
                  <Avatar.Text
                    {...props}
                    size={48}
                    label={subUser.name.charAt(0).toUpperCase()}
                    style={styles.avatar}
                  />
                )}
                right={(props) => (
                  <List.Icon {...props} icon="chevron-right" />
                )}
                onPress={() => handleSelectUser(subUser)}
                style={styles.listItem}
              />
              {index < users.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a73e8',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  card: {
    borderRadius: 12,
    elevation: 2,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    padding: 20,
    paddingBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  divider: {
    marginHorizontal: 20,
  },
  listItem: {
    paddingVertical: 12,
  },
  avatar: {
    backgroundColor: '#1a73e8',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 16,
    color: '#d32f2f',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    marginTop: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
});
