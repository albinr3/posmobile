import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
  Linking,
  RefreshControl,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import { Button, Chip, Icon, Text, TextInput, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from '../../components/SafeAreaView';
import { useAuthStore } from '../../store/authStore';
import { ui } from '../../theme/ui';
import {
  BillingAuthContext,
  BillingOverview,
  BillingProfileInput,
  BillingPayment,
  createDopPayment,
  getBillingOverviewWithOptions,
  getUsdCheckoutUrl,
  isBillingEndpointUnavailableError,
  saveBillingProfile,
  submitPaymentProof,
  uploadPaymentProofFromUri,
} from '../../services/billing/billingService';

const DEFAULT_PROFILE_FORM: BillingProfileInput = {
  legalName: '',
  taxId: '',
  address: '',
  email: '',
  phone: '',
};

function formatMoney(cents: number, currency: string): string {
  const value = Number(cents || 0) / 100;
  if (String(currency).toUpperCase() === 'USD') {
    return `$${value.toFixed(2)} USD`;
  }
  return `RD$${Math.round(value).toLocaleString('es-DO')} DOP`;
}

function formatDate(rawDate: string): string {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getStatusLabel(status: string): string {
  const value = String(status).toUpperCase();
  if (value === 'TRIALING') return 'Periodo de prueba';
  if (value === 'ACTIVE') return 'Activo';
  if (value === 'GRACE') return 'Periodo de gracia';
  if (value === 'BLOCKED') return 'Bloqueado';
  if (value === 'CANCELED') return 'Cancelado';
  return value;
}

function getStatusChipStyle(status: string) {
  const value = String(status).toUpperCase();
  if (value === 'ACTIVE' || value === 'PAID') return styles.statusChipSuccess;
  if (value === 'TRIALING') return styles.statusChipInfo;
  if (value === 'PENDING' || value === 'GRACE') return styles.statusChipWarning;
  if (value === 'BLOCKED' || value === 'CANCELED' || value === 'FAILED' || value === 'REJECTED') return styles.statusChipDanger;
  return styles.statusChipDefault;
}

export function BillingPlansScreen() {
  const { getToken } = useAuth();
  const { subUserToken, accountId } = useAuthStore();
  const getTokenRef = useRef(getToken);
  const subUserTokenRef = useRef(subUserToken);
  const accountIdRef = useRef(accountId);
  getTokenRef.current = getToken;
  subUserTokenRef.current = subUserToken;
  accountIdRef.current = accountId;

  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paymentTab, setPaymentTab] = useState<'dop' | 'usd'>('dop');
  const [profileForm, setProfileForm] = useState<BillingProfileInput>(DEFAULT_PROFILE_FORM);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [proofLocalUri, setProofLocalUri] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [sendingProof, setSendingProof] = useState(false);
  const [payingUsd, setPayingUsd] = useState(false);

  const buildAuthContext = useCallback(async (): Promise<BillingAuthContext> => {
    const clerkToken = await getTokenRef.current();
    const currentSubUserToken = subUserTokenRef.current;
    if (!clerkToken || !currentSubUserToken) {
      throw new Error('Tu sesión no está lista. Inicia sesión nuevamente.');
    }
    return {
      clerkToken,
      subUserToken: currentSubUserToken,
      accountId: accountIdRef.current,
    };
  }, []);

  const loadOverview = useCallback(
    async (isRefresh = false) => {
      if (!subUserTokenRef.current) {
        setOverview(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        const auth = await buildAuthContext();
        const data = await getBillingOverviewWithOptions(auth, { forceRefresh: isRefresh });
        setOverview(data);
        setSelectedBankAccountId((current) => {
          if (current && data.bankAccounts.some((acc) => acc.id === current)) return current;
          return data.bankAccounts[0]?.id || '';
        });
        const nextProfileForm: BillingProfileInput = {
          legalName: data.profile?.legalName || '',
          taxId: data.profile?.taxId || '',
          address: data.profile?.address || '',
          email: data.profile?.email || '',
          phone: data.profile?.phone || '',
        };
        setProfileForm((current) => {
          if (
            current.legalName === nextProfileForm.legalName &&
            current.taxId === nextProfileForm.taxId &&
            current.address === nextProfileForm.address &&
            current.email === nextProfileForm.email &&
            (current.phone || '') === (nextProfileForm.phone || '')
          ) {
            return current;
          }
          return nextProfileForm;
        });
      } catch (error) {
        console.error('Error cargando pantalla de planes/facturación:', error);
        if (isBillingEndpointUnavailableError(error)) {
          Alert.alert(
            'Endpoints faltantes',
            'Solo está disponible el estado básico de facturación. Debes crear los endpoints de billing para habilitar pagos, perfil e historial.'
          );
        } else {
          Alert.alert('Error', 'No se pudo cargar la información de facturación.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [buildAuthContext]
  );

  useFocusEffect(
    useCallback(() => {
      loadOverview(false);
    }, [loadOverview])
  );

  const state = overview?.state || null;
  const latestPayment = overview?.payments?.[0] || null;
  const paymentNeedingProof = useMemo(() => {
    if (!overview?.payments?.length) return null;
    return overview.payments.find((payment) => payment.status === 'PENDING' && payment.proofs.length === 0) || null;
  }, [overview?.payments]);

  const selectedBankAccount = useMemo(() => {
    if (!overview?.bankAccounts?.length) return null;
    return overview.bankAccounts.find((account) => account.id === selectedBankAccountId) || overview.bankAccounts[0];
  }, [overview?.bankAccounts, selectedBankAccountId]);

  const needsPaymentSection = !!(state && (state.needsPayment || state.isBlocked || state.isTrialing));
  const backendLimitedMode = !!overview?.isLimited;

  const handleSaveProfile = async () => {
    if (!profileForm.legalName.trim() || !profileForm.taxId.trim() || !profileForm.address.trim() || !profileForm.email.trim()) {
      Alert.alert('Datos requeridos', 'Completa nombre legal, cédula/RNC, dirección y email.');
      return;
    }

    try {
      setSavingProfile(true);
      const auth = await buildAuthContext();
      await saveBillingProfile(auth, profileForm);
      await loadOverview(false);
      Alert.alert('Facturación', 'Datos de facturación guardados.');
    } catch (error: any) {
      console.error('Error guardando perfil de facturación:', error);
      Alert.alert('Error', String(error?.message || 'No se pudo guardar el perfil.'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCreateDopPayment = async () => {
    if (!selectedBankAccount?.id) {
      Alert.alert('Banco', 'Selecciona una cuenta bancaria para continuar.');
      return;
    }

    try {
      setCreatingPayment(true);
      const auth = await buildAuthContext();
      await createDopPayment(auth, selectedBankAccount.id);
      await loadOverview(false);
      Alert.alert('Pago creado', 'Ahora sube el comprobante de transferencia.');
    } catch (error: any) {
      console.error('Error creando pago manual:', error);
      Alert.alert('Error', String(error?.message || 'No se pudo crear el pago.'));
    } finally {
      setCreatingPayment(false);
    }
  };

  const handlePickProofImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) {
        Alert.alert('Comprobante', 'No se pudo obtener la imagen seleccionada.');
        return;
      }
      setProofLocalUri(uri);
    } catch (error) {
      console.error('Error seleccionando comprobante:', error);
      Alert.alert('Error', 'No se pudo seleccionar la imagen.');
    }
  };

  const handleSubmitProof = async () => {
    if (!paymentNeedingProof?.id) {
      Alert.alert('Comprobante', 'No hay un pago pendiente para asociar el comprobante.');
      return;
    }

    if (!proofLocalUri && !proofUrl.trim()) {
      Alert.alert('Comprobante', 'Selecciona una imagen o pega una URL para el comprobante.');
      return;
    }

    try {
      setSendingProof(true);
      const auth = await buildAuthContext();
      const resolvedProofUrl = proofLocalUri ? await uploadPaymentProofFromUri(auth, proofLocalUri) : proofUrl.trim();
      await submitPaymentProof(auth, paymentNeedingProof.id, resolvedProofUrl);
      setProofLocalUri(null);
      setProofUrl('');
      await loadOverview(false);
      Alert.alert('Comprobante enviado', 'Tu comprobante fue enviado correctamente.');
    } catch (error: any) {
      console.error('Error enviando comprobante:', error);
      Alert.alert('Error', String(error?.message || 'No se pudo enviar el comprobante.'));
    } finally {
      setSendingProof(false);
    }
  };

  const handlePayUsd = async () => {
    try {
      setPayingUsd(true);
      const auth = await buildAuthContext();
      const checkoutUrl = await getUsdCheckoutUrl(auth);
      await Linking.openURL(checkoutUrl);
    } catch (error: any) {
      console.error('Error iniciando pago USD:', error);
      Alert.alert('Error', String(error?.message || 'No se pudo iniciar el pago con tarjeta.'));
    } finally {
      setPayingUsd(false);
    }
  };

  const openProof = async (payment: BillingPayment) => {
    const url = payment.proofs?.[0]?.url;
    if (!url) return;
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Comprobante', 'No se pudo abrir el comprobante.');
      return;
    }
    await Linking.openURL(url);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator animating color={ui.colors.primary} />
        <Text style={styles.loadingText}>Cargando facturación...</Text>
      </SafeAreaView>
    );
  }

  if (!state) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <Text style={styles.emptyTitle}>No se pudo cargar Facturación</Text>
        <Button mode="contained" buttonColor={ui.colors.primary} onPress={() => loadOverview(false)}>
          Reintentar
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadOverview(true)} tintColor={ui.colors.primary} />}
      >
        <View style={styles.headerCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.headerTitle}>Planes y Facturación</Text>
            <Chip style={getStatusChipStyle(state.status)} textStyle={styles.statusText}>
              {getStatusLabel(state.status)}
            </Chip>
          </View>
          <Text style={styles.headerPrice}>
            {formatMoney(state.priceInCents, state.currency)}
            <Text style={styles.headerPriceHint}> / mes</Text>
          </Text>

          {state.isTrialing ? (
            <Text style={styles.headerHint}>
              {state.trialDaysRemaining === 0
                ? 'Tu período de prueba termina hoy.'
                : `Te quedan ${state.trialDaysRemaining ?? 0} días de prueba.`}
            </Text>
          ) : null}
          {state.isGrace ? (
            <Text style={styles.headerHintWarning}>
              {state.graceDaysRemaining === 0
                ? 'Tu período de gracia termina hoy.'
                : `Te quedan ${state.graceDaysRemaining ?? 0} días de gracia.`}
            </Text>
          ) : null}
          {state.isBlocked ? <Text style={styles.headerHintDanger}>Tu cuenta está bloqueada. Debes realizar un pago.</Text> : null}
          {latestPayment?.status === 'REJECTED' && latestPayment.rejectionReason ? (
            <Text style={styles.headerHintDanger}>Pago rechazado: {latestPayment.rejectionReason}</Text>
          ) : null}
        </View>

        {backendLimitedMode ? (
          <View style={styles.noticeCard}>
            <Icon source="alert-circle-outline" size={18} color="#92400E" />
            <Text style={styles.noticeText}>
              El backend solo expone `GET /api/billing/state`. Para pagos, perfil e historial debes agregar endpoints de billing.
            </Text>
          </View>
        ) : null}

        {needsPaymentSection ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Métodos de pago</Text>
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabButton, paymentTab === 'dop' && styles.tabButtonActive]}
                onPress={() => setPaymentTab('dop')}
              >
                <Icon source="bank-outline" size={16} color={paymentTab === 'dop' ? '#fff' : ui.colors.text} />
                <Text style={[styles.tabButtonText, paymentTab === 'dop' && styles.tabButtonTextActive]}>Transferencia (DOP)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, paymentTab === 'usd' && styles.tabButtonActive]}
                onPress={() => setPaymentTab('usd')}
              >
                <Icon source="credit-card-outline" size={16} color={paymentTab === 'usd' ? '#fff' : ui.colors.text} />
                <Text style={[styles.tabButtonText, paymentTab === 'usd' && styles.tabButtonTextActive]}>Tarjeta (USD)</Text>
              </TouchableOpacity>
            </View>

            {paymentTab === 'dop' ? (
              <View>
                {!overview?.bankAccounts?.length ? (
                  <Text style={styles.infoWarning}>No hay cuentas bancarias configuradas.</Text>
                ) : (
                  <>
                    <Text style={styles.sectionHint}>Selecciona el banco para la transferencia:</Text>
                    <View style={styles.bankChipWrap}>
                      {overview.bankAccounts.map((account) => (
                        <Chip
                          key={account.id}
                          selected={selectedBankAccount?.id === account.id}
                          onPress={() => setSelectedBankAccountId(account.id)}
                          style={[
                            styles.bankChip,
                            selectedBankAccount?.id === account.id && styles.bankChipSelected,
                          ]}
                          textStyle={[
                            styles.bankChipText,
                            selectedBankAccount?.id === account.id && styles.bankChipTextSelected,
                          ]}
                          showSelectedOverlay={false}
                        >
                          {account.bankName}
                        </Chip>
                      ))}
                    </View>

                    {selectedBankAccount ? (
                      <View style={styles.bankCard}>
                        <View style={styles.bankHeaderRow}>
                          <Text style={styles.bankCardTitle}>{selectedBankAccount.bankName}</Text>
                          {selectedBankAccount.bankLogo ? (
                            <Image source={{ uri: selectedBankAccount.bankLogo }} style={styles.bankLogo} resizeMode="contain" />
                          ) : null}
                        </View>
                        <Text style={styles.bankCardLine}>Tipo: {selectedBankAccount.accountType}</Text>
                        <Text style={styles.bankCardLine}>Número: {selectedBankAccount.accountNumber}</Text>
                        <Text style={styles.bankCardLine}>A nombre de: {selectedBankAccount.accountName}</Text>
                        <Text style={styles.bankCardLineStrong}>
                          Monto: {formatMoney(overview?.subscription?.priceDopCents || 130000, 'DOP')}
                        </Text>
                        {selectedBankAccount.instructions ? (
                          <Text style={styles.bankInstructions}>{selectedBankAccount.instructions}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                )}

                {paymentNeedingProof ? (
                  <View style={styles.proofCard}>
                    <Text style={styles.sectionSubTitle}>Subir comprobante</Text>
                    <Text style={styles.sectionHint}>
                      Pago pendiente: {formatMoney(paymentNeedingProof.amountCents, paymentNeedingProof.currency)}
                    </Text>
                    <Button
                      mode="outlined"
                      onPress={handlePickProofImage}
                      style={styles.secondaryButton}
                      icon="image-plus"
                      disabled={backendLimitedMode}
                    >
                      Seleccionar imagen
                    </Button>
                    {proofLocalUri ? <Text style={styles.proofSelected}>Imagen seleccionada: {proofLocalUri.split('/').pop()}</Text> : null}
                    <TextInput
                      mode="outlined"
                      label="o pega URL del comprobante"
                      value={proofUrl}
                      onChangeText={setProofUrl}
                      style={styles.input}
                      outlineColor={ui.colors.border}
                      activeOutlineColor={ui.colors.primary}
                      autoCapitalize="none"
                      disabled={backendLimitedMode}
                    />
                    <Button
                      mode="contained"
                      buttonColor={ui.colors.primary}
                      onPress={handleSubmitProof}
                      loading={sendingProof}
                      disabled={backendLimitedMode || sendingProof}
                    >
                      Enviar comprobante
                    </Button>
                  </View>
                ) : (
                  <Button
                    mode="contained"
                    buttonColor={ui.colors.primary}
                    onPress={handleCreateDopPayment}
                    loading={creatingPayment}
                    disabled={backendLimitedMode || creatingPayment || !selectedBankAccount}
                  >
                    Hice la transferencia, subir comprobante
                  </Button>
                )}
              </View>
            ) : (
              <View>
                <View style={styles.usdPriceCard}>
                  <Text style={styles.usdPriceText}>{formatMoney(overview?.subscription?.priceUsdCents || 2000, 'USD')}</Text>
                  <Text style={styles.usdPriceHint}>Pago recurrente con tarjeta de crédito/débito</Text>
                </View>
                <Button
                  mode="contained"
                  buttonColor={ui.colors.primary}
                  onPress={handlePayUsd}
                  loading={payingUsd}
                  disabled={backendLimitedMode || payingUsd}
                  icon="open-in-new"
                >
                  Pagar con tarjeta
                </Button>
              </View>
            )}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Datos de facturación</Text>
          <Text style={styles.sectionHint}>Estos datos se usan para generar recibos.</Text>
          <TextInput
            mode="outlined"
            label="Nombre legal o razón social"
            value={profileForm.legalName}
            onChangeText={(value) => setProfileForm((prev) => ({ ...prev, legalName: value }))}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            mode="outlined"
            label="Cédula o RNC"
            value={profileForm.taxId}
            onChangeText={(value) => setProfileForm((prev) => ({ ...prev, taxId: value }))}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            mode="outlined"
            label="Dirección"
            value={profileForm.address}
            onChangeText={(value) => setProfileForm((prev) => ({ ...prev, address: value }))}
            style={styles.input}
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            mode="outlined"
            label="Email para recibos"
            value={profileForm.email}
            onChangeText={(value) => setProfileForm((prev) => ({ ...prev, email: value }))}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <TextInput
            mode="outlined"
            label="Teléfono (opcional)"
            value={profileForm.phone || ''}
            onChangeText={(value) => setProfileForm((prev) => ({ ...prev, phone: value }))}
            style={styles.input}
            keyboardType="phone-pad"
            outlineColor={ui.colors.border}
            activeOutlineColor={ui.colors.primary}
          />
          <Button
            mode="contained"
            buttonColor={ui.colors.primary}
            onPress={handleSaveProfile}
            loading={savingProfile}
            disabled={backendLimitedMode || savingProfile}
          >
            Guardar datos de facturación
          </Button>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Historial de pagos</Text>
          {!overview?.payments?.length ? (
            <Text style={styles.emptyText}>No hay pagos registrados aún.</Text>
          ) : (
            overview.payments.map((payment) => (
              <View key={payment.id} style={styles.paymentRow}>
                <View style={styles.paymentMain}>
                  <Text style={styles.paymentAmount}>{formatMoney(payment.amountCents, payment.currency)}</Text>
                  <Text style={styles.paymentDate}>{formatDate(payment.createdAt)}</Text>
                  {payment.status === 'REJECTED' && payment.rejectionReason ? (
                    <Text style={styles.paymentRejected}>Motivo: {payment.rejectionReason}</Text>
                  ) : null}
                </View>
                <View style={styles.paymentActions}>
                  {payment.proofs?.length ? (
                    <TouchableOpacity style={styles.proofButton} onPress={() => openProof(payment)}>
                      <Icon source="file-document-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  ) : null}
                  <Chip style={getStatusChipStyle(payment.status)} textStyle={styles.statusText}>
                    {getStatusLabel(payment.status)}
                  </Chip>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.colors.background },
  content: { padding: 14, paddingBottom: 24 },
  loadingContainer: {
    flex: 1,
    backgroundColor: ui.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: { color: ui.colors.textMuted, fontSize: 13 },
  emptyTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  headerCard: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 10,
  },
  noticeText: { flex: 1, color: '#92400E', fontSize: 12, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerTitle: { color: ui.colors.text, fontSize: 22, fontWeight: '800', flex: 1 },
  headerPrice: { color: ui.colors.primary, fontSize: 24, fontWeight: '800', marginTop: 8 },
  headerPriceHint: { color: ui.colors.textMuted, fontSize: 13, fontWeight: '600' },
  headerHint: { color: ui.colors.textMuted, marginTop: 8, fontSize: 12 },
  headerHintWarning: { color: '#B45309', marginTop: 8, fontSize: 12, fontWeight: '700' },
  headerHintDanger: { color: '#B91C1C', marginTop: 8, fontSize: 12, fontWeight: '700' },
  card: {
    backgroundColor: ui.colors.surface,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.lg,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: { color: ui.colors.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  sectionSubTitle: { color: ui.colors.text, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  sectionHint: { color: ui.colors.textMuted, fontSize: 12, marginBottom: 8 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tabButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  tabButtonActive: { backgroundColor: ui.colors.primary, borderColor: ui.colors.primary },
  tabButtonText: { color: ui.colors.text, fontSize: 12, fontWeight: '700' },
  tabButtonTextActive: { color: '#fff' },
  infoWarning: {
    color: '#92400E',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: ui.radius.md,
    padding: 10,
    fontSize: 12,
    fontWeight: '700',
  },
  bankChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  bankChip: { backgroundColor: '#F3F4F6' },
  bankChipSelected: { backgroundColor: '#E9D5FF' },
  bankChipText: { color: '#4B5563', fontSize: 12, fontWeight: '700' },
  bankChipTextSelected: { color: ui.colors.primary, fontSize: 12, fontWeight: '800' },
  bankCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 10,
  },
  bankHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bankCardTitle: { color: ui.colors.text, fontSize: 14, fontWeight: '800' },
  bankLogo: { width: 28, height: 28 },
  bankCardLine: { color: ui.colors.textMuted, fontSize: 12, marginTop: 4 },
  bankCardLineStrong: { color: ui.colors.text, fontSize: 13, fontWeight: '800', marginTop: 6 },
  bankInstructions: { color: ui.colors.textMuted, fontSize: 11, marginTop: 8, borderTopWidth: 1, borderTopColor: ui.colors.border, paddingTop: 8 },
  proofCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: '#FCFCFD',
    padding: 10,
    marginTop: 6,
  },
  proofSelected: { color: ui.colors.textMuted, fontSize: 11, marginTop: 8, marginBottom: 2 },
  secondaryButton: { marginTop: 4, marginBottom: 6 },
  usdPriceCard: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    backgroundColor: '#F9FAFB',
    padding: 12,
    marginBottom: 10,
    alignItems: 'center',
  },
  usdPriceText: { color: ui.colors.text, fontSize: 23, fontWeight: '800' },
  usdPriceHint: { color: ui.colors.textMuted, marginTop: 4, fontSize: 12 },
  input: { marginBottom: 10, backgroundColor: ui.colors.surface },
  emptyText: { color: ui.colors.textMuted, fontSize: 12 },
  paymentRow: {
    borderWidth: 1,
    borderColor: ui.colors.border,
    borderRadius: ui.radius.md,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  paymentMain: { flex: 1 },
  paymentAmount: { color: ui.colors.text, fontSize: 14, fontWeight: '800' },
  paymentDate: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  paymentRejected: { color: '#B91C1C', fontSize: 11, marginTop: 2 },
  paymentActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  proofButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusChipDefault: { backgroundColor: '#E5E7EB' },
  statusChipInfo: { backgroundColor: '#DBEAFE' },
  statusChipSuccess: { backgroundColor: '#DCFCE7' },
  statusChipWarning: { backgroundColor: '#FEF3C7' },
  statusChipDanger: { backgroundColor: '#FEE2E2' },
  statusText: { fontSize: 11, fontWeight: '700' },
});
