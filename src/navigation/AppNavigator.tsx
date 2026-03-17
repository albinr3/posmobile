import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '@clerk/clerk-expo';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainNavigator} />
        ) : (
          <Stack.Screen name="Auth">
            {() => <AuthNavigator initialRouteName={isLoaded && isSignedIn ? 'SelectUser' : 'Login'} />}
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
