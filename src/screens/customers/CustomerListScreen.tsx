import React, { useState, useCallback, useRef } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { Searchbar, Text, Surface, FAB, Avatar, IconButton, Chip, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { Customer } from '../../types';

interface CustomerListScreenProps {
  navigation: any;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';

export function CustomerListScreen({ navigation }: CustomerListScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // NUEVO: Agregar hooks para autenticación
  const { getToken } = useAuth();
  const { subUserToken } = useAuthStore();
  const isSyncingOnFocusRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (isSyncingOnFocusRef.current) return;
      isSyncingOnFocusRef.current = true;
      setLoading(true);
      const syncAndLoad = async () => {
        try {
          const clerkToken = await getToken();
          if (clerkToken && subUserToken) {
            syncService.setGetTokenFunction(getToken);
            syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
            await syncService.fullSync(clerkToken);
          }
        } catch (error) {
          console.error('Error sincronizando clientes al abrir pantalla:', error);
        }

        await loadCustomers();
        isSyncingOnFocusRef.current = false;
      };

      syncAndLoad();

      return () => {
        isSyncingOnFocusRef.current = false;
      };
    }, [])
  );

  const loadCustomers = async () => {
    try {
      const result = await db.query<any>(
        'SELECT * FROM customers WHERE server_id IS NOT NULL ORDER BY name'
      );
      const mapped = result.map(row => ({
        localId: row.local_id,
        serverId: row.server_id,
        name: row.name,
        phone: row.phone,
        synced: row.synced === 1,
        data: row.data,
      }));
      setCustomers(mapped);
    } catch (error) {
      console.error('Error cargando clientes:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // MODIFICADO: Agregar sincronización con el servidor
  const onRefresh = async () => {
    setRefreshing(true);
    
    try {
      // Sincronizar con el servidor
      const clerkToken = await getToken();
      if (clerkToken && subUserToken) {
        console.log('🔄 Sincronizando clientes desde el servidor...');
        
        // Configurar funciones de obtención de tokens
        syncService.setGetTokenFunction(getToken);
        syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);
        
        // Ejecutar sincronización
        await syncService.fullSync(clerkToken);
        console.log('✅ Clientes sincronizados correctamente');
      } else {
        console.warn('⚠️ No hay tokens de autenticación disponibles para sincronizar');
      }
    } catch (error) {
      console.error('❌ Error sincronizando clientes:', error);
      // No mostrar error al usuario, solo registrar en consola
    }
    
    // Recargar clientes de la BD local
    await loadCustomers();
  };

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (customer.phone && customer.phone.includes(searchQuery))
  );

  const renderCustomer = ({ item }: { item: Customer }) => (
    <Surface 
      style={styles.customerCard}
      onTouchEnd={() => navigation.navigate('CustomerDetail', { customerId: item.localId })}
    >
      <View style={styles.customerInfo}>
        <Avatar.Text 
          size={40} 
          label={item.name.substring(0, 2).toUpperCase()} 
          style={styles.avatar}
        />
        <View style={styles.customerDetails}>
          <Text style={styles.customerName}>{item.name}</Text>
          {item.phone && <Text style={styles.customerPhone}>{item.phone}</Text>}
          {!item.synced && (
            <Chip compact style={styles.pendingChip} textStyle={styles.pendingChipText}>
              Pendiente
            </Chip>
          )}
        </View>
      </View>
      <IconButton
        icon="chevron-right"
        size={20}
        onPress={() => navigation.navigate('CustomerDetail', { customerId: item.localId })}
      />
    </Surface>
  );

  const handleSanitizeCustomers = () => {
    Alert.alert(
      'Sanear clientes',
      'Esto eliminara de la base local los clientes que no existen actualmente en la web.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sanear',
          style: 'destructive',
          onPress: async () => {
            try {
              const clerkToken = await getToken();
              if (!clerkToken || !subUserToken) {
                Alert.alert('Error', 'No hay sesion activa para consultar la web');
                return;
              }

              const remoteResponse = await axios.get(`${API_URL}/api/customers`, {
                headers: {
                  'X-Clerk-Authorization': `Bearer ${clerkToken}`,
                  'X-SubUser-Token': subUserToken,
                },
              });
              const remoteCustomers = remoteResponse.data?.data || remoteResponse.data || [];
              const remoteIds = new Set<string>(remoteCustomers.map((c: any) => String(c.id)));

              const localServerCustomers = await db.query<{ local_id: string; server_id: string }>(
                'SELECT local_id, server_id FROM customers WHERE server_id IS NOT NULL'
              );
              const localIdsToDelete = localServerCustomers
                .filter((c) => !remoteIds.has(String(c.server_id)))
                .map((c) => c.local_id);

              let deletedFromServerSet = 0;
              for (const localId of localIdsToDelete) {
                await db.runAsync(
                  "DELETE FROM sync_queue WHERE entity_type = 'customer' AND entity_local_id = ?",
                  [localId]
                );
                await db.runAsync('DELETE FROM customers WHERE local_id = ?', [localId]);
                deletedFromServerSet += 1;
              }

              const orphanCountResult = await db.queryFirst<{ count: number }>(
                'SELECT COUNT(*) as count FROM customers WHERE server_id IS NULL'
              );
              const orphanCount = orphanCountResult?.count || 0;
              if (orphanCount > 0) {
                await db.runAsync(
                  `DELETE FROM sync_queue 
                   WHERE entity_type = 'customer' 
                   AND entity_local_id IN (SELECT local_id FROM customers WHERE server_id IS NULL)`
                );
                await db.runAsync('DELETE FROM customers WHERE server_id IS NULL');
              }

              await loadCustomers();
              Alert.alert(
                'Sanitizado completado',
                `Eliminados por no existir en web: ${deletedFromServerSet}\nEliminados locales sin server_id: ${orphanCount}`
              );
            } catch (error) {
              console.error('Error saneando clientes locales:', error);
              Alert.alert('Error', 'No se pudo completar el saneamiento');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Buscar clientes..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
        />
        <Button mode="outlined" onPress={handleSanitizeCustomers} style={styles.sanitizeButton}>
          Sanear local
        </Button>
      </View>

      <FlatList
        data={filteredCustomers}
        renderItem={renderCustomer}
        keyExtractor={(item) => item.localId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#1a73e8']}
            tintColor="#1a73e8"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {loading ? 'Cargando clientes...' : 'No hay clientes'}
            </Text>
            {!loading && (
              <Text style={[styles.emptyText, { marginTop: 8, fontSize: 14 }]}>
                Desliza hacia abajo para sincronizar
              </Text>
            )}
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('AddCustomer')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchbar: {
    marginBottom: 0,
  },
  sanitizeButton: {
    marginTop: 10,
    alignSelf: 'flex-end',
  },
  list: {
    padding: 16,
  },
  customerCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: 'white',
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    backgroundColor: '#1a73e8',
  },
  customerDetails: {
    marginLeft: 12,
    flex: 1,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
  },
  customerPhone: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  pendingChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    height: 24,
  },
  pendingChipText: {
    fontSize: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: '#1a73e8',
  },
});
