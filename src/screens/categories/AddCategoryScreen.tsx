import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { generateLocalId } from '../../utils/helpers';
import { ui } from '../../theme/ui';

interface AddCategoryScreenProps {
  navigation: any;
  route: any;
}

export function AddCategoryScreen({ navigation, route }: AddCategoryScreenProps) {
  const categoryId = route?.params?.categoryId;
  const isEditMode = !!categoryId;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [localId, setLocalId] = useState<string>('');
  const [serverId, setServerId] = useState<string | null>(null);
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();

  useFocusEffect(
    useCallback(() => {
      if (!isEditMode) return;
      const focusLoadKey = `${categoryId || ''}`;

      let isActive = true;
      const loadCategory = async () => {
        // Evita recargas redundantes durante renders mientras esta misma pantalla sigue en foco
        if (lastFocusLoadKeyRef.current === focusLoadKey) return;
        lastFocusLoadKeyRef.current = focusLoadKey;
        setLoadingCategory(true);
        try {
          const row = await db.queryFirst<any>(
            'SELECT local_id, server_id, name, description, data FROM categories WHERE local_id = ? OR server_id = ? LIMIT 1',
            [categoryId, categoryId]
          );
          if (!row) {
            Alert.alert('Error', 'Categoría no encontrada');
            navigation.goBack();
            return;
          }
          let parsed: any = null;
          try {
            parsed = row?.data ? JSON.parse(row.data) : null;
          } catch {
            parsed = null;
          }
          if (!isActive) return;
          setLocalId(String(row.local_id));
          setServerId(row.server_id ? String(row.server_id) : null);
          setName(String(row.name || parsed?.name || ''));
          setDescription(
            typeof row.description === 'string'
              ? row.description
              : typeof parsed?.description === 'string'
                ? parsed.description
                : ''
          );
        } catch (error: any) {
          if (!isActive) return;
          console.error('Error cargando categoría:', error);
          Alert.alert('Error', 'No se pudo cargar la categoría');
          navigation.goBack();
        } finally {
          if (isActive) setLoadingCategory(false);
        }
      };

      loadCategory();
      return () => {
        lastFocusLoadKeyRef.current = null;
        isActive = false;
      };
    }, [categoryId, isEditMode, navigation])
  );

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      const resolvedLocalId = isEditMode ? localId || String(categoryId || '') : generateLocalId();
      const trimmedName = name.trim();
      const trimmedDescription = description.trim() || null;
      const payload = {
        id: serverId || undefined,
        localId: resolvedLocalId,
        serverId: serverId || undefined,
        name: trimmedName,
        description: trimmedDescription,
        updatedAt: Date.now(),
      };

      if (isEditMode) {
        await db.update(
          'categories',
          resolvedLocalId,
          {
            name: trimmedName,
            description: trimmedDescription,
            synced: 0,
            data: JSON.stringify(payload),
          },
          'local_id'
        );
      } else {
        await db.insert('categories', {
          local_id: resolvedLocalId,
          name: trimmedName,
          description: trimmedDescription,
          synced: 0,
          data: JSON.stringify(payload),
        });
      }

      syncService.setGetTokenFunction(getToken);
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);

      if (isEditMode) {
        if (serverId) {
          await db.runAsync(
            "DELETE FROM sync_queue WHERE entity_type = 'category' AND action = 'update' AND entity_local_id = ? AND status IN ('pending','error')",
            [resolvedLocalId]
          );
          await syncService.queueOperation('category', 'update', payload, resolvedLocalId);
        } else {
          await db.runAsync(
            "DELETE FROM sync_queue WHERE entity_type = 'category' AND entity_local_id = ? AND status IN ('pending','error')",
            [resolvedLocalId]
          );
          await syncService.queueOperation('category', 'create', payload, resolvedLocalId);
        }
      } else {
        await syncService.queueOperation('category', 'create', payload, resolvedLocalId);
      }

      Alert.alert(
        isOnline ? 'Éxito' : 'Pendiente de sincronización',
        isOnline
          ? isEditMode
            ? 'Categoría actualizada correctamente'
            : 'Categoría creada correctamente'
          : isEditMode
            ? 'Categoría actualizada localmente. Se sincronizará cuando haya internet.'
            : 'Categoría creada localmente. Se sincronizará cuando haya internet.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      console.error(isEditMode ? 'Error actualizando categoría:' : 'Error creando categoría:', error);
      Alert.alert('Error', isEditMode ? 'No se pudo actualizar la categoría' : 'No se pudo crear la categoría');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{isEditMode ? 'Editar Categoría' : 'Nueva Categoría'}</Text>
          <Text style={styles.headerSubtitle}>{isEditMode ? 'Modifica los datos de la categoría' : 'Crea una categoría para organizar tus productos'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Información</Text>
          <TextInput
            label="Nombre de la categoría *"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            label="Descripción"
            value={description}
            onChangeText={setDescription}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
        </View>

        <Button mode="contained" onPress={handleSave} loading={loading} disabled={loading || loadingCategory} buttonColor={ui.colors.primary} style={styles.saveButton} contentStyle={styles.saveButtonContent}>
          {isEditMode ? 'Guardar Cambios' : 'Guardar Categoría'}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingBottom: 30 },
  header: { marginBottom: 10 },
  headerTitle: { color: ui.colors.text, fontSize: 25, fontWeight: '800' },
  headerSubtitle: { color: ui.colors.textMuted, marginTop: 4 },
  card: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  sectionTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  saveButton: { borderRadius: ui.radius.md },
  saveButtonContent: { height: 50 },
});
