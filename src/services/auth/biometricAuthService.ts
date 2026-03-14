import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'movopos_biometric_enabled';
const SUBUSER_TOKEN_KEY = 'movopos_subuser_token';
const SUBUSER_DATA_KEY = 'movopos_subuser_data';
const ACCOUNT_ID_KEY = 'movopos_account_id';

export interface BiometricAvailability {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
  isAvailable: boolean;
}

export async function getBiometricEnabled(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return raw === '1';
}

export async function setBiometricEnabledPreference(enabled: boolean): Promise<void> {
  if (enabled) {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, '1');
    return;
  }
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
}

export async function isBiometricAvailable(): Promise<BiometricAvailability> {
  const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  return {
    hasHardware,
    isEnrolled,
    supportedTypes,
    isAvailable: hasHardware && isEnrolled,
  };
}

export async function promptBiometric(promptMessage = 'Confirma tu identidad') {
  return LocalAuthentication.authenticateAsync({
    promptMessage,
    fallbackLabel: 'Usar codigo',
    cancelLabel: 'Cancelar',
  });
}

export async function hasStoredSubUserSession(): Promise<boolean> {
  const [token, subUser, accountId] = await Promise.all([
    SecureStore.getItemAsync(SUBUSER_TOKEN_KEY),
    SecureStore.getItemAsync(SUBUSER_DATA_KEY),
    SecureStore.getItemAsync(ACCOUNT_ID_KEY),
  ]);

  return !!token && !!subUser && !!accountId;
}
