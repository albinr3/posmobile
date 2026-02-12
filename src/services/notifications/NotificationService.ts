import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configurar cómo manejar notificaciones cuando la app está en primer plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

class NotificationService {
  private expoPushToken: string | null = null;

  async init(): Promise<void> {
    await this.registerForPushNotifications();
    this.setupNotificationListeners();
  }

  private async registerForPushNotifications(): Promise<void> {
    if (!Device.isDevice) {
      console.log('Notificaciones push solo funcionan en dispositivos físicos');
      return;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('No se otorgaron permisos para notificaciones');
      return;
    }

    try {
      const token = await Notifications.getExpoPushTokenAsync();
      this.expoPushToken = token.data;
      await AsyncStorage.setItem('expo_push_token', token.data);
      
      // TODO: Enviar token al servidor
      console.log('Push token:', token.data);
    } catch (error) {
      console.error('Error obteniendo push token:', error);
    }

    // Configuración específica de Android
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1a73e8',
      });
    }
  }

  private setupNotificationListeners(): void {
    // Listener para cuando se recibe una notificación
    Notifications.addNotificationReceivedListener(notification => {
      console.log('Notificación recibida:', notification);
    });

    // Listener para cuando el usuario interactúa con la notificación
    Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      console.log('Respuesta a notificación:', data);
      
      // TODO: Navegar a la pantalla correspondiente según el tipo de notificación
    });
  }

  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: Record<string, any>,
    trigger?: Notifications.NotificationTriggerInput
  ): Promise<string> {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
      },
      trigger: trigger || null,
    });
    return identifier;
  }

  async notifyLowStock(productName: string, currentStock: number): Promise<void> {
    await this.scheduleLocalNotification(
      'Stock Bajo',
      `${productName} tiene solo ${currentStock} unidades`,
      { type: 'low_stock', productName }
    );
  }

  async notifyOverdueInvoices(count: number): Promise<void> {
    await this.scheduleLocalNotification(
      'Facturas Vencidas',
      `Tienes ${count} facturas vencidas por cobrar`,
      { type: 'overdue_invoices', count }
    );
  }

  async notifySaleCompleted(invoiceCode: string, total: string): Promise<void> {
    await this.scheduleLocalNotification(
      'Venta Completada',
      `Factura ${invoiceCode} por ${total}`,
      { type: 'sale_completed', invoiceCode }
    );
  }

  async notifyPaymentReceived(customerName: string, amount: string): Promise<void> {
    await this.scheduleLocalNotification(
      'Pago Recibido',
      `${customerName} pagó ${amount}`,
      { type: 'payment_received', customerName }
    );
  }

  async notifySyncCompleted(pendingCount: number): Promise<void> {
    if (pendingCount > 0) {
      await this.scheduleLocalNotification(
        'Sincronización',
        `${pendingCount} items pendientes de sincronizar`,
        { type: 'sync_pending', pendingCount }
      );
    }
  }

  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async cancelNotification(identifier: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  }

  getExpoPushToken(): string | null {
    return this.expoPushToken;
  }
}

export const notificationService = new NotificationService();
