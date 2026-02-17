import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text, Checkbox } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import axios from 'axios';
import { useAuthStore } from '../../store/authStore';
import { ui } from '../../theme/ui';

interface AddSupplierScreenProps {
  navigation: any;
  route: any;
}

export function AddSupplierScreen({ navigation, route }: AddSupplierScreenProps) {
  const supplierId = route?.params?.supplierId;
  const isEditMode = !!supplierId;
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [chargesItbis, setChargesItbis] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSupplier, setLoadingSupplier] = useState(false);
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      if (!isEditMode) return;
      const focusLoadKey = `${supplierId || ''}:${accountId || ''}:${subUserToken || ''}`;

      let isActive = true;
      const loadSupplier = async () => {
        // Evita recargas redundantes mientras la misma pantalla sigue en foco
        if (lastFocusLoadKeyRef.current === focusLoadKey) return;
        lastFocusLoadKeyRef.current = focusLoadKey;
        setLoadingSupplier(true);
        try {
          const clerkToken = await getToken();
          if (!clerkToken || !subUserToken) {
            Alert.alert('Sesión', 'No hay sesión activa para editar proveedores.');
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
          const response = await axios.get(`${API_URL}/api/suppliers/${supplierId}`, { headers });
          const item = response.data || {};
          if (!isActive) return;
          setName(String(item.name || ''));
          setContactName(String(item.contactName || ''));
          setPhone(String(item.phone || ''));
          setEmail(String(item.email || ''));
          setAddress(String(item.address || ''));
          setNotes(String(item.notes || ''));
          setChargesItbis(Boolean(item.chargesItbis));
          setDiscountPercent(item.discountPercentBp ? String(Number(item.discountPercentBp) / 100) : '');
        } catch (error: any) {
          if (!isActive) return;
          console.error('Error cargando proveedor:', error);
          const apiError = error?.response?.data?.error;
          Alert.alert('Error', apiError ? String(apiError) : 'No se pudo cargar el proveedor');
          navigation.goBack();
        } finally {
          if (isActive) setLoadingSupplier(false);
        }
      };

      loadSupplier();
      return () => {
        lastFocusLoadKeyRef.current = null;
        isActive = false;
      };
    }, [accountId, isEditMode, navigation, subUserToken, supplierId])
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
        Alert.alert('Sesión', 'No hay sesión activa para crear proveedores.');
        return;
      }

      const API_URL = process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'https://movopos.com';
      const headers = {
        Authorization: `Bearer ${clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${clerkToken}`,
        'X-SubUser-Token': subUserToken,
        ...(accountId ? { 'X-Account-Id': accountId } : {}),
      };
      const discountValue = Number((discountPercent || '0').replace(',', '.'));
      const discountPercentBp = Number.isFinite(discountValue) && discountValue > 0 ? Math.round(discountValue * 100) : 0;

      const payload = {
        name: name.trim(),
        contactName: contactName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        discountPercentBp,
        chargesItbis,
      };

      if (isEditMode) {
        await axios.put(`${API_URL}/api/suppliers/${supplierId}`, payload, { headers });
      } else {
        await axios.post(`${API_URL}/api/suppliers`, payload, { headers });
      }

      Alert.alert('Éxito', isEditMode ? 'Proveedor actualizado correctamente' : 'Proveedor creado correctamente', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      console.error(isEditMode ? 'Error actualizando proveedor:' : 'Error creando proveedor:', error);
      const apiError = error?.response?.data?.error;
      Alert.alert('Error', apiError ? String(apiError) : isEditMode ? 'No se pudo actualizar el proveedor' : 'No se pudo crear el proveedor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{isEditMode ? 'Editar Proveedor' : 'Nuevo Proveedor'}</Text>
          <Text style={styles.headerSubtitle}>{isEditMode ? 'Modifica los datos del proveedor' : 'Ingresa los datos del proveedor'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Información general</Text>
          <TextInput
            label="Nombre del proveedor *"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            label="Nombre de contacto"
            value={contactName}
            onChangeText={setContactName}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            label="Teléfono"
            value={phone}
            onChangeText={setPhone}
            mode="outlined"
            keyboardType="phone-pad"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            label="Dirección"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <Text style={styles.fieldLabel}>Descuento por defecto (%)</Text>
          <TextInput
            placeholder="Ej: 10 para 10%"
            value={discountPercent}
            onChangeText={setDiscountPercent}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <Text style={styles.fieldHelp}>Este descuento se aplicará automáticamente al registrar compras de este proveedor.</Text>
          <View style={styles.checkRow}>
            <Checkbox status={chargesItbis ? 'checked' : 'unchecked'} onPress={() => setChargesItbis((prev) => !prev)} color={ui.colors.primary} />
            <View style={styles.checkTextWrap}>
              <Text style={styles.checkTitle}>Sumar ITBIS en compras</Text>
              <Text style={styles.fieldHelp}>Si se marca, se sumará el 18% de ITBIS al costo de los productos de este proveedor.</Text>
            </View>
          </View>
          <TextInput
            label="Notas"
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
        </View>

        <Button mode="contained" onPress={handleSave} loading={loading} disabled={loading || loadingSupplier} buttonColor={ui.colors.primary} style={styles.saveButton} contentStyle={styles.saveButtonContent}>
          {isEditMode ? 'Guardar Cambios' : 'Guardar Proveedor'}
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
  fieldLabel: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 6, marginTop: 2 },
  fieldHelp: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  checkTextWrap: { flex: 1, marginTop: 8 },
  checkTitle: { color: ui.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  saveButton: { borderRadius: ui.radius.md },
  saveButtonContent: { height: 50 },
});
