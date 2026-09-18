import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '@clerk/clerk-expo';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { setErrorRouteGetter } from '../services/error/errorReporter';
import { useAuthStore } from '../store/authStore';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';
import { WELCOME_SEEN_STORAGE_KEY } from '../screens/auth/WelcomeScreen';

const Stack = createStackNavigator();
const APP_NAV_DEBUG = false;
export const navigationRef = createNavigationContainerRef();

function getCurrentRoutePath(): string | null {
  if (!navigationRef.isReady()) return null;

  const routeTrail: string[] = [];
  let state: any = navigationRef.getRootState();

  while (state?.routes?.length) {
    const index = typeof state.index === 'number' ? state.index : 0;
    const route = state.routes[index];
    if (!route) break;
    if (route.name) routeTrail.push(String(route.name));
    state = route.state;
  }

  if (routeTrail.length === 0) return null;
  return routeTrail.join(' > ');
}

setErrorRouteGetter(() => getCurrentRoutePath());

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { isLoaded, isSignedIn } = useAuth();
  const [isWelcomeLoaded, setIsWelcomeLoaded] = useState(false);
  const [shouldShowWelcome, setShouldShowWelcome] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadWelcomeState = async () => {
      try {
        const welcomeSeen = await AsyncStorage.getItem(WELCOME_SEEN_STORAGE_KEY);
        if (isMounted) setShouldShowWelcome(welcomeSeen !== '1');
      } catch (error) {
        console.warn('No se pudo leer el estado de bienvenida:', error);
        if (isMounted) setShouldShowWelcome(false);
      } finally {
        if (isMounted) setIsWelcomeLoaded(true);
      }
    };

    void loadWelcomeState();
    return () => {
      isMounted = false;
    };
  }, []);

  if (APP_NAV_DEBUG) {
    console.log('[AppNavigator] render', {
      isLoading,
      isLoaded,
      isSignedIn,
      isAuthenticated,
      authInitialRoute: isSignedIn ? 'SelectUser' : 'Login',
    });
  }

  if (isLoading || !isWelcomeLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainNavigator} />
        ) : (
          <Stack.Screen name="Auth">
            {() => (
              <AuthNavigator
                initialRouteName={
                  shouldShowWelcome ? 'Welcome' : isLoaded && isSignedIn ? 'SelectUser' : 'Login'
                }
              />
            )}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
