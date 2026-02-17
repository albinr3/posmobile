import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '@clerk/clerk-expo';
import { useAuthStore } from '../store/authStore';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';

const Stack = createStackNavigator();
const APP_NAV_DEBUG = false;

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { isLoaded, isSignedIn } = useAuth();

  if (APP_NAV_DEBUG) {
    console.log('[AppNavigator] render', {
      isLoading,
      isLoaded,
      isSignedIn,
      isAuthenticated,
      authInitialRoute: isSignedIn ? 'SelectUser' : 'Login',
    });
  }

  if (isLoading || !isLoaded) {
    // TODO: Mostrar splash screen
    return null;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainNavigator} />
        ) : (
          <Stack.Screen name="Auth">
            {() => <AuthNavigator initialRouteName={isSignedIn ? 'SelectUser' : 'Login'} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
