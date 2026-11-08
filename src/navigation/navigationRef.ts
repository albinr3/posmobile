import { createNavigationContainerRef, StackActions } from '@react-navigation/native';
export const navigationRef = createNavigationContainerRef<any>();

export function leaveTutorialPractice() {
  if (!navigationRef.isReady()) return;
  const root = navigationRef.getRootState();
  if (root.routes[root.index]?.name !== 'TutorialPractice' || root.index === 0) return;
  // Dirigir el pop al stack raíz evita volver primero a un carrito ya terminado.
  navigationRef.dispatch({ ...StackActions.pop(1), target: root.key });
}

export function navigateTutorialHome() {
  if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Home', params: { screen: 'Dashboard', params: { screen: 'DashboardMain' } } });
}
export function navigateTutorialProduct() {
  if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'InventoryMenu', params: { screen: 'AddProduct' } });
}
