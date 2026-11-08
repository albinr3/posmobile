import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { createStackNavigator, CardStyleInterpolators } from '@react-navigation/stack';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from '../../components/SafeAreaView';
import { TutorialCelebration } from '../../components/onboarding/TutorialCelebration';
import { POSScreen } from '../sales/POSScreen';
import { CartScreen } from '../sales/CartScreen';
import { practiceTotals } from '../../services/onboarding/onboardingModel';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useTutorialCartStore } from '../../store/tutorialCartStore';
import { ui } from '../../theme/ui';

const Stack = createStackNavigator();

function PracticeHeader({ navigation, back = false }: { navigation: any; back?: boolean }) {
  return <SafeAreaView edges={['top']} style={styles.headerArea}><View style={styles.header}>
    {back && <IconButton icon="arrow-left" accessibilityLabel="Volver a los productos" onPress={() => {
      useOnboardingStore.getState().go('catalog');
      navigation.navigate('POSMain');
    }} />}
    <View style={{ flex: 1 }}><Text style={styles.title}>{back ? 'Carrito' : 'Vender'}</Text>
      <Text style={styles.badge}>TUTORIAL · PRODUCTOS DE PRUEBA</Text></View>
    <IconButton icon="close" accessibilityLabel="Continuar tutorial después" onPress={() => useOnboardingStore.getState().postpone()} />
  </View></SafeAreaView>;
}

// Se usan los componentes de producción: tarjetas, cantidades, carrito y cobro.
function PracticeCatalog(props: any) { return <POSScreen {...props} tutorial />; }
function PracticeCart(props: any) { return <CartScreen {...props} tutorial />; }

function PracticeDone() {
  const totals = practiceTotals(useOnboardingStore(s => s.quantities));
  const existing = useOnboardingStore(s => s.completionProductId);
  return <View style={styles.screen}><TutorialCelebration
    title="¡Felicidades por tu primera venta de prueba!"
    description={`Completaste el cobro de ${totals.count} ${totals.count === 1 ? 'unidad' : 'unidades'}. Ahora aprenderás a crear un producto de tu negocio en el formulario real.`}
    primaryLabel="Seguir tutorial: crear mi primer producto"
    onPrimary={() => useOnboardingStore.getState().go('product')}
    secondaryLabel={existing ? 'Terminar con mi producto existente' : 'Continuar después'}
    onSecondary={() => existing ? useOnboardingStore.getState().finishWithExisting(existing) : useOnboardingStore.getState().postpone()}
  /></View>;
}

export function PracticeNavigator({ navigation }: any) {
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const sessionKey = useOnboardingStore.getState().sessionKey;
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      const tutorial = useOnboardingStore.getState();
      if (tutorial.active && ['catalog', 'cart', 'practiceDone'].includes(tutorial.stage)) tutorial.postpone();
    });
    return () => {
      unsubscribe();
      const tutorial = useOnboardingStore.getState();
      if (tutorial.sessionKey !== sessionKey) return;
      if (tutorial.active && ['catalog', 'cart', 'practiceDone'].includes(tutorial.stage)) tutorial.postpone();
      else useTutorialCartStore.getState().clear();
    };
  }, [navigation]);
  const stage = useOnboardingStore.getState().stage;
  return <Stack.Navigator initialRouteName={stage === 'practiceDone' ? 'PracticeDone' : stage === 'cart' ? 'Cart' : 'POSMain'}
    screenOptions={{ gestureEnabled: false, animation: reducedMotion ? 'none' : 'fade', cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter }}>
    <Stack.Screen name="POSMain" component={PracticeCatalog} options={{ header: props => <PracticeHeader navigation={props.navigation} /> }}
      listeners={{ focus: () => {
        const tutorial = useOnboardingStore.getState();
        if (tutorial.active && tutorial.stage === 'cart') tutorial.go('catalog');
      } }} />
    <Stack.Screen name="Cart" component={PracticeCart} options={{ header: props => <PracticeHeader navigation={props.navigation} back /> }} />
    <Stack.Screen name="PracticeDone" component={PracticeDone} options={{ headerShown: false }} />
  </Stack.Navigator>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: ui.colors.background }, headerArea: { backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  title: { color: ui.colors.text, fontSize: 20, fontWeight: '800' },
  badge: { color: ui.colors.primary, fontSize: 10, fontWeight: '700', marginTop: 3 },
});
