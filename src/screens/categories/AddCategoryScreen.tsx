import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
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
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      if (!isEditMode) return;
      const focusLoadKey = `${categoryId || ''}:${accountId || ''}:${subUserToken || ''}`;

      let isActive = true;
      const loadCategory = async () => {
        // Evita recargas redundantes durante renders mientras esta misma pantalla sigue en foco
        if (lastFocusLoadKeyRef.current === focusLoadKey) return;
        lastFocusLoadKeyRef.current = focusLoadKey;
        setLoadingCategory(true);
        try {
          const clerkToken = await getToken();
          if (!clerkToken || !subUserToken) {
            Alert.alert('Sesión', 'No hay sesión activa para editar categorías.');
            navigation.goBack();
            return;
          }
          const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
          const headers = {
            Authorization: `Bearer ${clerkToken}`,
            'X-Clerk-Authorization': `Bearer ${clerkToken}`,
            'X-SubUser-Token': subUserToken,
            ...(accountId ? { 'X-Account-Id': accountId } : {}),
          };
          const response = await axios.get(`${API_URL}/api/categories/${categoryId}`, { headers });
          const item = response.data?.data || response.data || {};
          if (!isActive) return;
          setName(String(item.name || ''));
          setDescription(String(item.description || ''));
        } catch (error: any) {
          if (!isActive) return;
          console.error('Error cargando categoría:', error);
          const apiError = error?.response?.data?.error;
          Alert.alert('Error', apiError ? String(apiError) : 'No se pudo cargar la categoría');
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
    }, [accountId, categoryId, isEditMode, navigation, subUserToken])
  );

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      const clerkToken = await getToken();
      if (!clerkToken || !subUserToken) {
        Alert.alert('Sesión', 'No hay sesión activa para crear categorías.');
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
      };

      if (isEditMode) {
        await axios.put(`${API_URL}/api/categories/${categoryId}`, payload, { headers });
      } else {
        const candidatePaths = ['/api/categories', '/api/category'];
        let saved = false;
        let lastError: any = null;

        for (const path of candidatePaths) {
          try {
            await axios.post(`${API_URL}${path}`, payload, { headers });
            saved = true;
            break;
          } catch (error: any) {
            lastError = error;
            if (error?.response?.status !== 404) {
              throw error;
            }
          }
        }

        if (!saved) {
          throw lastError || new Error('No se encontró endpoint para crear categorías');
        }
      }

      Alert.alert('Éxito', isEditMode ? 'Categoría actualizada correctamente' : 'Categoría creada correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      console.error(isEditMode ? 'Error actualizando categoría:' : 'Error creando categoría:', error);
      const apiError = error?.response?.data?.error;
      Alert.alert('Error', apiError ? String(apiError) : isEditMode ? 'No se pudo actualizar la categoría' : 'No se pudo crear la categoría');
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
