import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OTPVerificationScreen } from '../screens/auth/OTPVerificationScreen';
import { EmailVerificationScreen } from '../screens/auth/EmailVerificationScreen';
import { BiometricSetupScreen } from '../screens/auth/BiometricSetupScreen';
import { SelectUserScreen } from '../screens/auth/SelectUserScreen';
import { SubUserLoginScreen } from '../screens/auth/SubUserLoginScreen';

const Stack = createStackNavigator();

interface AuthNavigatorProps {
  initialRouteName?: 'Login' | 'SelectUser';
}

export function AuthNavigator({ initialRouteName = 'Login' }: AuthNavigatorProps) {
  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="OTPVerification" component={OTPVerificationScreen} />
      <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
      <Stack.Screen name="BiometricSetup" component={BiometricSetupScreen} />
      <Stack.Screen name="SelectUser" component={SelectUserScreen} />
      <Stack.Screen name="SubUserLogin" component={SubUserLoginScreen} />
    </Stack.Navigator>
  );
}
