import axios from 'axios';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { navigationRef } from '../../navigation/AppNavigator';
import { API_URL } from '../sync/syncShared';

const EXPO_PROJECT_ID =
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
  process.env.EXPO_PUBLIC_EXPO_PROJECT_ID ||
  '59b5e5bf-ada1-4727-9376-d8d92466ad7a';

let lastRegistrationKey: string | null = null;
let responseSubscription: Notifications.Subscription | null = null;
const handledNotificationIds = new Set<string>();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushRegistrationAuth {
  clerkToken: string;
  subUserToken: string;
  accountId: string | null;
}

function getNotificationData(response: Notifications.NotificationResponse): Record<string, unknown> {
  const data = response.notification.request.content.data;
  return data && typeof data === 'object' ? data : {};
}

function navigateToAccountsReceivable(attempt = 0) {
  if (!navigationRef.isReady()) {
    if (attempt < 8) {
      setTimeout(() => navigateToAccountsReceivable(attempt + 1), 500);
    }
    return;
  }

  try {
    (navigationRef as any).navigate('Main', {
      screen: 'ARMenu',
      params: { screen: 'ARList' },
    });
  } catch (error) {
    console.warn('No se pudo navegar a cuentas por cobrar desde la notificacion:', error);
  }
}

export function setupPushNotificationResponseHandler() {
  if (responseSubscription) return;

  const handleResponse = (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const notificationId = response.notification.request.identifier;
    if (handledNotificationIds.has(notificationId)) return;
    handledNotificationIds.add(notificationId);

    const data = getNotificationData(response);
    if (data.type === 'AR_OVERDUE' || data.screen === 'ARMenu') {
      navigateToAccountsReceivable();
    }
  };

  responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  void Notifications.getLastNotificationResponseAsync()
    .then(handleResponse)
    .catch((error) => {
      console.warn('No se pudo leer la ultima respuesta de notificacion:', error);
    });
}

export function teardownPushNotificationResponseHandler() {
  responseSubscription?.remove();
  responseSubscription = null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('ar-overdue', {
    name: 'Cuentas por cobrar',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function requestNotificationPermission(): Promise<boolean> {
  const currentPermissions = await Notifications.getPermissionsAsync();
  if (currentPermissions.granted) return true;

  const requestedPermissions = await Notifications.requestPermissionsAsync();
  return requestedPermissions.granted;
}

export async function registerPushTokenForCurrentDevice(auth: PushRegistrationAuth): Promise<boolean> {
  if (!auth.clerkToken || !auth.subUserToken) return false;
  if (!Device.isDevice) return false;

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) return false;

  await ensureAndroidChannel();

  const tokenResult = await Notifications.getExpoPushTokenAsync({
    projectId: EXPO_PROJECT_ID,
  });
  const expoPushToken = tokenResult.data;
  const registrationKey = `${auth.accountId || 'unknown'}:${expoPushToken}`;

  if (lastRegistrationKey === registrationKey) return true;

  await axios.post(
    `${API_URL}/api/push-tokens`,
    {
      expoPushToken,
      platform: Platform.OS,
      deviceName: Device.deviceName || null,
      appVersion: process.env.EXPO_PUBLIC_APP_VERSION || null,
    },
    {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${auth.clerkToken}`,
        'X-Clerk-Authorization': `Bearer ${auth.clerkToken}`,
        'X-SubUser-Token': auth.subUserToken,
        ...(auth.accountId ? { 'X-Account-Id': auth.accountId } : {}),
        'Content-Type': 'application/json',
      },
    }
  );

  lastRegistrationKey = registrationKey;
  return true;
}
