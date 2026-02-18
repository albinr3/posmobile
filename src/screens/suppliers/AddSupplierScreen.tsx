import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { TextInput, Button, Text, Checkbox } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { syncService } from '../../services/sync/SyncService';
import { db } from '../../database/Database';
import { generateLocalId } from '../../utils/helpers';
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
  const [itbisRatePercent, setItbisRatePercent] = useState('18');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSupplier, setLoadingSupplier] = useState(false);
  const [localId, setLocalId] = useState<string>('');
  const [serverId, setServerId] = useState<string | null>(null);
  const lastFocusLoadKeyRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { isOnline } = useSyncStore();

  useFocusEffect(
    useCallback(() => {
      if (!isEditMode) return;
      const focusLoadKey = `${supplierId || ''}`;

      let isActive = true;
      const loadSupplier = async () => {
        // Evita recargas redundantes mientras la misma pantalla sigue en foco
        if (lastFocusLoadKeyRef.current === focusLoadKey) return;
        lastFocusLoadKeyRef.current = focusLoadKey;
        setLoadingSupplier(true);
        try {
          const row = await db.queryFirst<any>(
            'SELECT local_id, server_id, name, discount_percent_bp, charges_itbis, itbis_rate_bp, data FROM suppliers WHERE local_id = ? OR server_id = ? LIMIT 1',
            [supplierId, supplierId]
          );
          if (!row) {
            Alert.alert('Error', 'Proveedor no encontrado');
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
          setContactName(String(parsed?.contactName || ''));
          setPhone(String(parsed?.phone || ''));
          setEmail(String(parsed?.email || ''));
          setAddress(String(parsed?.address || ''));
          setNotes(String(parsed?.notes || ''));
          const chargesRaw =
            typeof row.charges_itbis === 'number'
              ? row.charges_itbis === 1
              : Boolean(parsed?.chargesItbis);
          setChargesItbis(chargesRaw);
          const discountBp = Number(
            row.discount_percent_bp ?? parsed?.discountPercentBp ?? 0
          );
          setDiscountPercent(discountBp ? String(discountBp / 100) : '');
          const itbisRateBpRaw = row.itbis_rate_bp ?? parsed?.itbisRateBp;
          setItbisRatePercent(
            itbisRateBpRaw !== null && itbisRateBpRaw !== undefined
              ? String(Number(itbisRateBpRaw) / 100)
              : '18'
          );
        } catch (error: any) {
          if (!isActive) return;
          console.error('Error cargando proveedor:', error);
          Alert.alert('Error', 'No se pudo cargar el proveedor');
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
    }, [isEditMode, navigation, supplierId])
  );

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }

    setLoading(true);
    try {
      const resolvedLocalId = isEditMode ? localId || String(supplierId || '') : generateLocalId();
      const discountValue = Number((discountPercent || '0').replace(',', '.'));
      const discountPercentBp = Number.isFinite(discountValue) && discountValue > 0 ? Math.round(discountValue * 100) : 0;
      const itbisRateValue = Number((itbisRatePercent || '18').replace(',', '.'));
      const itbisRateBp =
        chargesItbis && Number.isFinite(itbisRateValue)
          ? Math.min(10000, Math.max(0, Math.round(itbisRateValue * 100)))
          : null;

      const trimmedName = name.trim();
      const payload = {
        id: serverId || undefined,
        localId: resolvedLocalId,
        serverId: serverId || undefined,
        name: trimmedName,
        contactName: contactName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        discountPercentBp,
        chargesItbis,
        itbisRateBp,
      };

      if (isEditMode) {
        await db.update(
          'suppliers',
          resolvedLocalId,
          {
            name: trimmedName,
            discount_percent_bp: discountPercentBp,
            charges_itbis: chargesItbis ? 1 : 0,
            itbis_rate_bp: itbisRateBp,
            synced: 0,
            data: JSON.stringify(payload),
          },
          'local_id'
        );
      } else {
        await db.insert('suppliers', {
          local_id: resolvedLocalId,
          name: trimmedName,
          discount_percent_bp: discountPercentBp,
          charges_itbis: chargesItbis ? 1 : 0,
          itbis_rate_bp: itbisRateBp,
          synced: 0,
          data: JSON.stringify(payload),
        });
      }

      syncService.setGetTokenFunction(getToken);
      syncService.setGetSubUserTokenFunction(async () => useAuthStore.getState().subUserToken);

      if (isEditMode) {
        if (serverId) {
          await db.runAsync(
            "DELETE FROM sync_queue WHERE entity_type = 'supplier' AND action = 'update' AND entity_local_id = ? AND status IN ('pending','error')",
            [resolvedLocalId]
          );
          await syncService.queueOperation('supplier', 'update', payload, resolvedLocalId);
        } else {
          await db.runAsync(
            "DELETE FROM sync_queue WHERE entity_type = 'supplier' AND entity_local_id = ? AND status IN ('pending','error')",
            [resolvedLocalId]
          );
          await syncService.queueOperation('supplier', 'create', payload, resolvedLocalId);
        }
      } else {
        await syncService.queueOperation('supplier', 'create', payload, resolvedLocalId);
      }

      Alert.alert(
        isOnline ? 'Éxito' : 'Pendiente de sincronización',
        isOnline
          ? isEditMode
            ? 'Proveedor actualizado correctamente'
            : 'Proveedor creado correctamente'
          : isEditMode
            ? 'Proveedor actualizado localmente. Se sincronizará cuando haya internet.'
            : 'Proveedor creado localmente. Se sincronizará cuando haya internet.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      console.error(isEditMode ? 'Error actualizando proveedor:' : 'Error creando proveedor:', error);
      Alert.alert('Error', isEditMode ? 'No se pudo actualizar el proveedor' : 'No se pudo crear el proveedor');
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
              <Text style={styles.fieldHelp}>Si se marca, se sumará ITBIS al costo según la tasa configurada abajo.</Text>
            </View>
          </View>
          {chargesItbis ? (
            <>
              <Text style={styles.fieldLabel}>Tasa ITBIS de compra (%)</Text>
              <TextInput
                placeholder="Ej: 18 para 18%"
                value={itbisRatePercent}
                onChangeText={setItbisRatePercent}
                mode="outlined"
                keyboardType="decimal-pad"
                style={styles.input}
                outlineColor={ui.colors.border}
                activeOutlineColor={ui.colors.primary}
              />
            </>
          ) : null}
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
