import { createNavigationContainerRef } from '@react-navigation/native';
export const navigationRef = createNavigationContainerRef<any>();

export function navigateTutorialHome() {
  if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Home', params: { screen: 'Dashboard', params: { screen: 'DashboardMain' } } });
}
export function navigateTutorialProduct() {
  if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'InventoryMenu', params: { screen: 'AddProduct' } });
}
