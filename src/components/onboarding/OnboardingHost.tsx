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
import { leaveTutorialPractice, navigateTutorialHome, navigateTutorialProduct, navigationRef } from '../../navigation/navigationRef';
import { OnboardingSpotlight, type GuideStep } from './OnboardingSpotlight';
import { TutorialCelebration } from './TutorialCelebration';
import { useTutorialCartStore } from '../../store/tutorialCartStore';
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
  const [cartReviewed, setCartReviewed] = useState(false);
  const practiceItems = useTutorialCartStore(s => s.items);
  const handledOpen = useRef(state.openRequest);
  const canShow = isOwner && state.hydrated && state.sessionKey === expectedKey && state.runtimeReady;
  const postpone = () => { Keyboard.dismiss(); useOnboardingStore.getState().postpone(); };
  useEffect(() => { if (state.stage !== 'cart') setCartReviewed(false); }, [state.stage]);
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
      if (inPractice) leaveTutorialPractice();
      return;
    }
    if (['catalog', 'cart', 'practiceDone'].includes(state.stage)) {
      if (!inPractice) navigationRef.navigate('TutorialPractice');
    } else if (state.stage === 'product') {
      if (inPractice) leaveTutorialPractice();
      if (state.routeName !== 'AddProduct') navigateTutorialProduct();
    } else if (state.stage === 'pending' && inPractice) leaveTutorialPractice();
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
  const fields = PRODUCT_GUIDE_FIELDS.filter(f => (f !== 'kind' || state.draft.productKind !== 'BASIC') && (f !== 'available' || !state.draft.isAvailableForSale));
  const total = 5 + fields.length;
  let step: GuideStep | null = null;
  if (state.active && !state.completedAt) {
    if (state.stage === 'sell') step = { target: 'nav.sell', title: 'Entra a Vender', description: 'Toca el botón morado de la caja. Usarás la pantalla habitual con tres productos de prueba.', index: 1, total, onRecover: navigateTutorialHome };
    if (state.stage === 'catalog') step = {
      target: practiceItems.length ? 'sale.checkout' : 'sale.products',
      title: practiceItems.length ? 'Abre el carrito' : 'Elige un producto de prueba',
      description: practiceItems.length ? 'Ya agregaste tu producto. Pulsa Facturar para abrir el carrito, revisar las cantidades y cobrar.' : 'Toca Café Americano, Botella de Agua o Snack para agregarlo. Son las mismas tarjetas que usarás al vender tus productos.',
      index: practiceItems.length ? 3 : 2, total, allowScreenInteraction: true,
      placement: practiceItems.length ? undefined : 'above',
      onRecover: () => navigationRef.navigate('TutorialPractice', { screen: 'POSMain' }),
    };
    if (state.stage === 'cart') step = {
      target: !practiceItems.length ? 'sale.addProducts' : cartReviewed ? 'sale.complete' : 'sale.quantities',
      title: !practiceItems.length ? 'Agrega un producto para continuar' : cartReviewed ? 'Completa tu primera venta' : 'Prueba las cantidades del carrito',
      description: !practiceItems.length ? 'Tu carrito está vacío. Pulsa Agregar Productos y elige cualquiera de los tres ejemplos.' : cartReviewed ? 'Revisa el total y pulsa Completar Venta. Este cobro de prueba no crea facturas ni modifica tus existencias.' : 'Usa + para aumentar y − para rebajar las unidades. También puedes quitar un producto. Cuando termines, continúa para cobrar.',
      index: cartReviewed ? 5 : 4, total, allowScreenInteraction: true,
      onNext: practiceItems.length && !cartReviewed ? () => setCartReviewed(true) : undefined,
      nextLabel: 'Ya revisé las cantidades',
      onRecover: () => navigationRef.navigate('TutorialPractice', { screen: 'Cart' }),
    };
    if (state.stage === 'product' && state.routeName === 'AddProduct') {
      step = { target: `product.${field}`, title: fieldCopy[field][0], description: fieldCopy[field][1], index: 6 + Math.max(0, fields.indexOf(field)), total,
        onNext: field === 'save' ? undefined : () => { Keyboard.dismiss(); useOnboardingStore.getState().confirmField(); },
        onRecover: () => useOnboardingStore.getState().confirmField() };
    }
  }
  const modal = state.active && !state.celebrating && (state.stage === 'welcome' || state.stage === 'pending') ? state.stage : null;
  return <>
    <OnboardingSpotlight step={step} onPostpone={postpone} />
    {state.celebrating && <TutorialCelebration completed
      title="¡Terminaste el tutorial!"
      description={state.completedAt ? 'Ya sabes vender y tu producto está listo. Los productos de prueba se retiraron; tu producto se conserva en el inventario.' : 'Tu producto está guardado y los ejemplos ya se retiraron de la caja. Puedes empezar a usarlo; confirmaremos el tutorial en la web al sincronizar.'}
      primaryLabel="Ir a vender"
      onPrimary={() => {
        useOnboardingStore.getState().dismissCelebration();
        navigationRef.navigate('Main', { screen: 'Home', params: { screen: 'POS', params: { screen: 'POSMain' } } });
      }}
      secondaryLabel="Volver al inicio"
      onSecondary={() => { useOnboardingStore.getState().dismissCelebration(); navigateTutorialHome(); }}
    />}
    {modal && <Portal><View style={[styles.scrim, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
      <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)} style={styles.modal}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={styles.hero}><Icon source={modal === 'pending' ? 'cloud-sync-outline' : 'cash-register'} size={58} color={ui.colors.primary} /></View>
          <Text style={styles.eyebrow}>{modal === 'pending' ? 'SINCRONIZACIÓN' : 'BIENVENIDO A MOVOPOS'}</Text>
          <Text style={styles.title}>{modal === 'pending' ? state.completionIssue ? 'Revisemos tu producto' : 'Tu tutorial ya terminó en este dispositivo' : 'Tu primera venta empieza aquí'}</Text>
          <Text style={styles.body}>{modal === 'pending' ? state.completionIssue === 'needs_correction' ? 'Corrige los importes del mismo producto guardado. No necesitas crear otro producto.' : state.completionIssue ? 'Buscaremos otro producto válido del negocio para confirmar el tutorial en la web; si no hay ninguno, podrás retomar la creación del producto.' : 'Tu producto está guardado. Solo falta confirmar el progreso en la web al sincronizar. Puedes seguir usando la app y no necesitas repetir ningún paso.' : 'Primero practicarás una venta con los controles reales de la caja. Después crearás tu primer producto, paso a paso.'}</Text>
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
            }}>{modal === 'pending' ? 'Entendido, seguir usando la app' : 'Empezar tutorial'}</Button>
          {modal === 'welcome' && <Button textColor={ui.colors.textMuted} onPress={postpone}>Continuar después</Button>}
        </ScrollView>
      </Animated.View>
    </View></Portal>}
  </>;
}
const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(22,13,40,0.68)', paddingHorizontal: 22, justifyContent: 'center' },
  modal: { maxHeight: '100%', backgroundColor: '#fff', borderRadius: 28, overflow: 'hidden', elevation: 16 }, modalContent: { padding: 26, gap: 16 },
  hero: { width: 106, height: 106, borderRadius: 32, backgroundColor: '#F0E4FD', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginVertical: 8 },
  eyebrow: { color: ui.colors.primary, textAlign: 'center', fontWeight: '800', fontSize: 10, letterSpacing: 1.5 }, title: { color: ui.colors.text, fontSize: 29, fontWeight: '800', textAlign: 'center' },
  body: { color: ui.colors.textMuted, fontSize: 14, lineHeight: 22, textAlign: 'center' }, checklist: { backgroundColor: ui.colors.background, padding: 16, borderRadius: 16, gap: 12 }, item: { color: ui.colors.text, fontSize: 13, fontWeight: '600' }, button: { borderRadius: 14 }, error: { color: ui.colors.danger, fontSize: 13, lineHeight: 20 },
});
