import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Icon, IconButton, Text } from 'react-native-paper';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { SafeAreaView } from '../../components/SafeAreaView';
import { OnboardingTarget } from '../../components/onboarding/OnboardingTarget';
import { SalePrice, SaleSummaryRow } from '../../components/sales/SalesPresentation';
import { PRACTICE_PRODUCTS, practiceTotals } from '../../services/onboarding/onboardingModel';
import { calcDocumentTotalsByTaxMode } from '../../utils/tax';
import { useOnboardingStore } from '../../store/onboardingStore';
import { ui } from '../../theme/ui';
import { useTutorialScroll } from '../../components/onboarding/useTutorialScroll';
import { useReducedMotion } from 'react-native-reanimated';
const Stack = createStackNavigator();
function PracticeHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return <View style={styles.header}>{onBack ? <IconButton icon="arrow-left" onPress={onBack} accessibilityLabel="Volver al catálogo de práctica" /> : <Icon source="cash-register" size={26} color={ui.colors.primary} />}
    <View style={{ flex: 1 }}><Text style={styles.title}>{title}</Text><Text style={styles.badge}>PRÁCTICA · DATOS DE EJEMPLO</Text></View>
    <IconButton icon="close" accessibilityLabel="Salir y conservar la práctica" onPress={() => useOnboardingStore.getState().postpone()} />
  </View>;
}
function PracticeCatalog({ navigation }: any) {
  const { scrollRef, onScroll, reveal } = useTutorialScroll();
  const quantities = useOnboardingStore(s => s.quantities);
  const totals = practiceTotals(quantities);
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <PracticeHeader title="Vender" />
    <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[styles.content, { paddingBottom: 340 }]}>
      <View style={styles.notice}><Icon source="shield-check-outline" size={20} color={ui.colors.primary} /><Text style={styles.noticeText}>Explora con tranquilidad. Esta venta no afecta tu negocio.</Text></View>
      <Text style={styles.heading}>Elige tu primer producto</Text><Text style={styles.subtitle}>Toca para agregarlo. Puedes cambiar las cantidades en el carrito.</Text>
      <View style={styles.grid}>{PRACTICE_PRODUCTS.map(product => <OnboardingTarget key={product.id} id={`practice.${product.id}`} reveal={reveal} style={{ width: '47%' }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Agregar ${product.name}`} style={styles.product}
          onPress={() => { const tutorial = useOnboardingStore.getState(); tutorial.quantity(product.id, (tutorial.quantities[product.id] || 0) + 1); }}>
          <View style={styles.productImage}><Icon source={product.icon} size={46} color={ui.colors.primary} />{!!quantities[product.id] && <View style={styles.quantityBadge}><Text style={styles.quantityText}>{quantities[product.id]}</Text></View>}</View>
          <Text style={styles.productName}>{product.name}</Text><SalePrice cents={product.priceCents} style={styles.price} /><Text style={styles.subtitle}>10 disponibles · Ejemplo</Text>
        </TouchableOpacity>
      </OnboardingTarget>)}</View>
      <OnboardingTarget id="practice.checkout" reveal={reveal}><Button mode="contained" buttonColor={ui.colors.primary} icon="cart-outline" disabled={!totals.count}
        contentStyle={styles.buttonContent} onPress={() => { useOnboardingStore.getState().go('cart'); navigation.navigate('PracticeCart'); }}>Revisar carrito · {totals.count}</Button></OnboardingTarget>
      <SaleSummaryRow label="Total" cents={totals.totalCents} total />
    </ScrollView>
  </SafeAreaView>;
}
function PracticeCart({ navigation }: any) {
  const { scrollRef, onScroll, reveal } = useTutorialScroll();
  const quantities = useOnboardingStore(s => s.quantities);
  const submitting = useRef(false);
  const items = PRACTICE_PRODUCTS.filter(p => (quantities[p.id] || 0) > 0);
  const totals = calcDocumentTotalsByTaxMode({ items: items.map(p => ({ quantity: quantities[p.id], priceCents: p.priceCents, itbisRateBp: 1800 })), salePricesIncludeItbis: true });
  const back = () => { useOnboardingStore.getState().go('catalog'); navigation.navigate('PracticeCatalog'); };
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <PracticeHeader title="Tu carrito" onBack={back} />
    <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[styles.content, { paddingBottom: 340 }]}>
      <Text style={styles.heading}>Revisa antes de cobrar</Text><Text style={styles.subtitle}>Cliente general · Contado · Efectivo</Text>
      {items.map(product => <View key={product.id} style={styles.line}>
        <View style={{ flex: 1 }}><Text style={styles.productName}>{product.name}</Text><SalePrice cents={product.priceCents} style={styles.price} /></View>
        <IconButton icon="minus" accessibilityLabel={`Quitar una unidad de ${product.name}`} onPress={() => useOnboardingStore.getState().quantity(product.id, (quantities[product.id] || 0) - 1)} />
        <Text>{quantities[product.id]}</Text><IconButton icon="plus" accessibilityLabel={`Agregar una unidad de ${product.name}`} disabled={(quantities[product.id] || 0) >= 10} onPress={() => useOnboardingStore.getState().quantity(product.id, (quantities[product.id] || 0) + 1)} />
      </View>)}
      {!items.length && <Button onPress={back}>Volver y agregar un producto</Button>}
      <View style={styles.summary}><SaleSummaryRow label="Subtotal" cents={totals.subtotalCents} /><SaleSummaryRow label="ITBIS incluido" cents={totals.itbisCents} /><SaleSummaryRow label="Total" cents={totals.totalCents} total /></View>
      <View style={styles.notice}><Icon source="cash" size={24} color={ui.colors.primary} /><Text style={styles.noticeText}>Efectivo recibido: importe exacto. En una venta real podrás calcular el cambio.</Text></View>
      <OnboardingTarget id="practice.complete" reveal={reveal}><Button mode="contained" buttonColor={ui.colors.primary} icon="check-circle-outline" contentStyle={styles.buttonContent}
        disabled={!items.length} onPress={() => {
          // Este handler nunca comparte dependencias con el guardado de ventas real.
          if (submitting.current || !items.length) return;
          submitting.current = true;
          useOnboardingStore.getState().go('practiceDone');
          navigation.replace('PracticeDone');
        }}>Completar práctica</Button></OnboardingTarget>
    </ScrollView>
  </SafeAreaView>;
}
function PracticeDone() {
  const existing = useOnboardingStore(s => s.completionProductId);
  const totals = practiceTotals(useOnboardingStore(s => s.quantities));
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}><PracticeHeader title="Práctica completada" />
    <ScrollView contentContainerStyle={[styles.content, { alignItems: 'center' }]}>
      <View style={styles.success}><Icon source="check" size={58} color={ui.colors.success} /></View>
      <Text style={[styles.heading, { textAlign: 'center' }]}>¡Ya sabes hacer una venta!</Text>
      <Text style={[styles.subtitle, { textAlign: 'center' }]}>Seleccionaste {totals.count} {totals.count === 1 ? 'unidad' : 'unidades'} y completaste el cobro de práctica.</Text>
      <View style={[styles.summary, { alignSelf: 'stretch' }]}><SaleSummaryRow label="Total de práctica" cents={totals.totalCents} total /><Text style={styles.subtitle}>Sin número de factura ni cambios en tus existencias.</Text></View>
      <Text style={[styles.heading, { fontSize: 23 }]}>{existing ? 'Tu negocio está listo' : 'Ahora, tu propio producto'}</Text>
      <Text style={styles.subtitle}>{existing ? 'Ya tienes un producto real. Puedes terminar aquí o aprender a crear otro.' : 'Te acompañaremos en el formulario habitual. El producto que guardes sí formará parte de tu inventario.'}</Text>
      <Button mode="contained" buttonColor={ui.colors.primary} style={styles.fullButton} contentStyle={styles.buttonContent}
        onPress={() => existing ? useOnboardingStore.getState().finishWithExisting(existing) : useOnboardingStore.getState().go('product')}>
        {existing ? 'Terminar tutorial' : 'Crear mi producto'}</Button>
      {existing && <Button onPress={() => useOnboardingStore.getState().go('product')}>Aprender a crear un producto</Button>}
    </ScrollView>
  </SafeAreaView>;
}
export function PracticeNavigator({ navigation }: any) {
  const reducedMotion = useReducedMotion();
  useEffect(() => navigation.addListener('beforeRemove', () => {
    const tutorial = useOnboardingStore.getState();
    if (tutorial.active && ['catalog', 'cart', 'practiceDone'].includes(tutorial.stage)) tutorial.postpone();
  }), [navigation]);
  const stage = useOnboardingStore.getState().stage;
  return <Stack.Navigator initialRouteName={stage === 'practiceDone' ? 'PracticeDone' : stage === 'cart' ? 'PracticeCart' : 'PracticeCatalog'}
    screenOptions={{ headerShown: false, gestureEnabled: false, animation: reducedMotion ? 'none' : 'fade', cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter }}>
    <Stack.Screen name="PracticeCatalog" component={PracticeCatalog} />
    <Stack.Screen name="PracticeCart" component={PracticeCart} />
    <Stack.Screen name="PracticeDone" component={PracticeDone} />
  </Stack.Navigator>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ui.colors.background }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#fff' },
  title: { color: ui.colors.text, fontWeight: '800', fontSize: 20 }, badge: { fontSize: 10, fontWeight: '800', color: ui.colors.primary, letterSpacing: 1, marginTop: 4 },
  content: { padding: 22, gap: 18, paddingBottom: 60 }, notice: { backgroundColor: '#EFE5FC', borderRadius: 16, padding: 16, flexDirection: 'row', gap: 10, alignItems: 'center' }, noticeText: { color: ui.colors.primaryDark, flex: 1, fontSize: 13, lineHeight: 20 },
  heading: { color: ui.colors.text, fontSize: 28, fontWeight: '800', marginTop: 8 }, subtitle: { color: ui.colors.textMuted, fontSize: 13, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 }, product: { padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: ui.colors.border, gap: 8 },
  productImage: { height: 94, borderRadius: 12, backgroundColor: '#F2EBFA', alignItems: 'center', justifyContent: 'center' }, productName: { color: ui.colors.text, fontWeight: '700', fontSize: 15 }, price: { color: ui.colors.primary, fontWeight: '800', fontSize: 18 },
  quantityBadge: { position: 'absolute', right: 6, top: 6, backgroundColor: ui.colors.primary, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, quantityText: { color: '#fff', fontWeight: '800' },
  buttonContent: { minHeight: 54 }, line: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 16 }, summary: { backgroundColor: '#fff', borderRadius: 20, padding: 20 },
  success: { backgroundColor: '#E4F6ED', borderRadius: 48, width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginVertical: 24 }, fullButton: { alignSelf: 'stretch' },
});
