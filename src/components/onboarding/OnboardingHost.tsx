import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Portal, Text } from 'react-native-paper';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { useSyncStore } from '../../store/syncStore';
import { useOnboardingRuntime } from '../../services/onboarding/useOnboardingRuntime';
import { nextProductField, PRODUCT_GUIDE_FIELDS, shouldAutoStartTutorial, type ProductGuideField } from '../../services/onboarding/onboardingModel';
import { navigateTutorialHome, navigateTutorialProduct, navigationRef } from '../../navigation/navigationRef';
import { OnboardingSpotlight, type GuideStep } from './OnboardingSpotlight';
import { ui } from '../../theme/ui';

const fieldCopy: Record<ProductGuideField, [string, string]> = {
  name: ['Dale un nombre', 'Escribe el nombre de un producto de tu negocio. Cuando termines, toca Continuar o cierra el teclado.'],
  kind: ['Empieza con un producto básico', 'Selecciona Básico. Se venderá por unidad y podrás controlar sus existencias.'],
  price: ['Define su precio de venta', 'Escribe cuánto pagarían tus clientes por una unidad. Usa un importe mayor que cero.'],
  cost: ['Indica cuánto te cuesta', 'Escribe el costo por unidad para calcular tus ganancias. Debe ser mayor que cero.'],
  stock: ['Añade tus existencias', 'Indica cuántas unidades tienes disponibles. Para este recorrido, agrega al menos una.'],
  available: ['Déjalo listo para vender', 'Activa Disponible para venta para que tu producto aparezca en la caja.'],
  save: ['Guarda tu primer producto', 'Revisa los datos y pulsa Guardar Producto. Este producto sí se añadirá a tu inventario.'],
};
function realSaleInProgress() {
  const cart = useCartStore.getState();
  return cart.items.length > 0 || !!cart.editingSaleLocalId;
}
export function OnboardingHost() {
  const expectedKey = useOnboardingRuntime();
  const state = useOnboardingStore();
  const isOwner = useAuthStore(s => s.subUser?.isOwner === true);
  const online = useSyncStore(s => s.isOnline);
  const insets = useSafeAreaInsets();
  const [field, setField] = useState<ProductGuideField>('name');
  const handledOpen = useRef(state.openRequest);
  const canShow = isOwner && state.hydrated && state.sessionKey === expectedKey && state.runtimeReady;
  const postpone = () => { Keyboard.dismiss(); useOnboardingStore.getState().postpone(); };
  useEffect(() => {
    if (!canShow || !state.active || state.stage !== 'product') return;
    setField(nextProductField(useOnboardingStore.getState().draft));
  }, [canShow, state.active, state.stage, state.guideRevision]);
  useEffect(() => {
    if (!canShow || !shouldAutoStartTutorial({ isOwner, eligible: state.eligible, remoteChecked: state.remoteChecked, introSeen: state.introSeen, completedAt: state.completedAt, ready: canShow, onHome: state.routeName === 'DashboardMain', hasSale: realSaleInProgress() })) return;
    useOnboardingStore.getState().open();
  }, [canShow, state.remoteChecked, state.eligible, state.introSeen, state.completedAt, state.routeName]);
  useEffect(() => {
    if (handledOpen.current === state.openRequest) return;
    handledOpen.current = state.openRequest;
    if (!canShow || state.completedAt) return;
    if (realSaleInProgress()) {
      Alert.alert('Tienes una venta en curso', 'Termina o cancela esa venta antes de iniciar la práctica. Tu carrito se conservará.');
      return;
    }
    if (!state.remoteChecked && !state.introSeen) {
      Alert.alert('Tutorial', 'Conéctate a internet para comprobar si tu negocio ya completó el tutorial.');
      return;
    }
    useOnboardingStore.getState().open();
  }, [state.openRequest, canShow]);
  useEffect(() => {
    if (!navigationRef.isReady()) return;
    const root = navigationRef.getRootState();
    const inPractice = root.routes[root.index]?.name === 'TutorialPractice';
    if (!canShow || !state.active || state.completedAt) {
      if (inPractice && navigationRef.canGoBack()) navigationRef.goBack();
      return;
    }
    if (['catalog', 'cart', 'practiceDone'].includes(state.stage)) {
      if (!inPractice) navigationRef.navigate('TutorialPractice');
    } else if (state.stage === 'product') {
      if (inPractice && navigationRef.canGoBack()) navigationRef.goBack();
      if (state.routeName !== 'AddProduct') navigateTutorialProduct();
    } else if (state.stage === 'pending' && inPractice && navigationRef.canGoBack()) navigationRef.goBack();
    else if (state.stage === 'sell' && state.routeName !== 'DashboardMain') navigateTutorialHome();
  }, [canShow, state.active, state.stage, state.completedAt, state.routeName]);
  useEffect(() => {
    if (!canShow || (!state.active && !state.celebrating)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.celebrating) useOnboardingStore.getState().dismissCelebration();
      else postpone();
      return true;
    });
    return () => subscription.remove();
  }, [canShow, state.active, state.celebrating]);
  if (!canShow) return null;
  let step: GuideStep | null = null;
  if (state.active && !state.completedAt) {
    if (state.stage === 'sell') step = { target: 'nav.sell', title: 'Entra a Vender', description: 'Toca el botón morado de la caja. Abriremos una venta de práctica con productos de ejemplo.', index: 1, total: 9 };
    if (state.stage === 'catalog') step = practiceStep(state.quantities.coffee ? 'practice.checkout' : 'practice.coffee', !!state.quantities.coffee);
    if (state.stage === 'cart') step = { target: 'practice.complete', title: 'Completa tu venta de práctica', description: 'Puedes ajustar cantidades con + y −. Revisa el total y completa la práctica en efectivo.', index: 4, total: 9, allowScreenInteraction: true };
    if (state.stage === 'product' && state.routeName === 'AddProduct') {
      const fields = PRODUCT_GUIDE_FIELDS.filter(f => (f !== 'kind' || state.draft.productKind !== 'BASIC') && (f !== 'available' || !state.draft.isAvailableForSale));
      step = { target: `product.${field}`, title: fieldCopy[field][0], description: fieldCopy[field][1], index: 5 + Math.max(0, fields.indexOf(field)), total: 4 + fields.length,
        onNext: field === 'save' ? undefined : () => { Keyboard.dismiss(); useOnboardingStore.getState().confirmField(); } };
    }
  }
  const modal = state.celebrating ? 'completed' : state.active && (state.stage === 'welcome' || state.stage === 'pending') ? state.stage : null;
  return <>
    <OnboardingSpotlight step={step} onPostpone={postpone} />
    {modal && <Portal><View style={[styles.scrim, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
      <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)} style={styles.modal}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={[styles.hero, modal === 'completed' && styles.heroDone]}><Icon source={modal === 'completed' ? 'check-circle-outline' : modal === 'pending' ? 'cloud-sync-outline' : 'cash-register'} size={58} color={modal === 'completed' ? ui.colors.success : ui.colors.primary} /></View>
          <Text style={styles.eyebrow}>{modal === 'completed' ? 'TODO LISTO' : modal === 'pending' ? 'ÚLTIMO PASO' : 'BIENVENIDO A MOVOPOS'}</Text>
          <Text style={styles.title}>{modal === 'completed' ? '¡Tu negocio está listo!' : modal === 'pending' ? state.completionIssue ? 'Revisemos tu producto' : 'Tu producto está guardado' : 'Tu primera venta empieza aquí'}</Text>
          <Text style={styles.body}>{modal === 'completed' ? 'Ya conoces la caja y tienes un producto propio. El tutorial también quedó completado en la web.' : modal === 'pending' ? state.completionIssue === 'needs_correction' ? 'Corrige los importes del mismo producto guardado. Conservaremos tu práctica y no crearemos otro producto.' : state.completionIssue ? 'Conservamos tu práctica. Buscaremos otro producto válido del negocio para terminar; si no hay ninguno, podrás retomar el paso de producto.' : 'Estamos esperando la sincronización para confirmar que terminaste también en la web. Puedes seguir usando la app; no necesitas crear el producto de nuevo.' : 'Primero practicaremos una venta sin afectar tus datos. Después prepararemos tu primer producto real, paso a paso.'}</Text>
          {modal === 'welcome' && <View style={styles.checklist}><Text style={styles.item}>01   Practica con productos de ejemplo</Text><Text style={styles.item}>02   Crea tu producto propio</Text><Text style={styles.item}>03   Empieza a vender</Text></View>}
          {state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
          {modal === 'pending' && state.completionIssue === 'needs_correction' && state.productLocalId && <Button mode="contained-tonal" disabled={state.busy} onPress={() => {
            const productId = useOnboardingStore.getState().productLocalId;
            if (!productId) return;
            postpone();
            navigationRef.navigate('Main', { screen: 'InventoryMenu', params: { screen: 'ProductEdit', params: { productId } } });
          }}>Corregir producto</Button>}
          {modal === 'pending' && state.canRestartProduct && <Button mode="contained-tonal" disabled={!online || state.busy} onPress={() => useOnboardingStore.getState().restartProduct()}>Retomar paso de producto</Button>}
          <Button mode="contained" buttonColor={ui.colors.primary} loading={modal === 'pending' && state.busy} style={styles.button} contentStyle={{ minHeight: 52 }}
            onPress={() => {
              if (modal === 'welcome') { useOnboardingStore.getState().go('sell'); navigateTutorialHome(); }
              else if (modal === 'pending') postpone();
              else { useOnboardingStore.getState().dismissCelebration(); navigationRef.navigate('Main', { screen: 'Home', params: { screen: 'POS', params: { screen: 'POSMain' } } }); }
            }}>{modal === 'completed' ? 'Ir a vender' : modal === 'pending' ? 'Seguir usando la app' : 'Empezar tutorial'}</Button>
          <Button textColor={ui.colors.textMuted} onPress={modal === 'completed' ? () => useOnboardingStore.getState().dismissCelebration() : postpone}>{modal === 'completed' ? 'Volver al inicio' : 'Continuar después'}</Button>
        </ScrollView>
      </Animated.View>
    </View></Portal>}
  </>;
}
function practiceStep(target: string, checkout: boolean): GuideStep {
  return { target, title: checkout ? 'Revisa el carrito' : 'Agrega un Café Americano', description: checkout ? 'Tu producto ya está agregado. Pulsa Revisar carrito para ver el detalle y cobrar.' : 'Toca el Café Americano. Estos productos son ejemplos y no cambian tu inventario real.', index: checkout ? 3 : 2, total: 9 };
}
const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(22,13,40,0.68)', paddingHorizontal: 22, justifyContent: 'center' },
  modal: { maxHeight: '100%', backgroundColor: '#fff', borderRadius: 28, overflow: 'hidden', elevation: 16 }, modalContent: { padding: 26, gap: 16 },
  hero: { width: 106, height: 106, borderRadius: 32, backgroundColor: '#F0E4FD', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 8 }, heroDone: { backgroundColor: '#E5F7ED' },
  eyebrow: { color: ui.colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 10, letterSpacing: 1.5 }, title: { color: ui.colors.text, fontSize: 29, fontWeight: '800', textAlign: 'center' },
  body: { color: ui.colors.textMuted, fontSize: 14, lineHeight: 22, textAlign: 'center' }, checklist: { backgroundColor: ui.colors.background, padding: 16, borderRadius: 16, gap: 12 }, item: { color: ui.colors.text, fontSize: 13, fontWeight: '600' }, button: { borderRadius: 14 }, error: { color: ui.colors.danger, fontSize: 13, lineHeight: 20 },
});
