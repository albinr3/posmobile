import React from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Alert, Linking } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text, Avatar, Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ui } from '../theme/ui';
import { AppTopHeader } from '../components/AppTopHeader';

import { DashboardScreen } from '../screens/reports/DashboardScreen';
import { POSScreen } from '../screens/sales/POSScreen';
import { CartScreen } from '../screens/sales/CartScreen';
import { ReceiptScreen } from '../screens/sales/ReceiptScreen';
import { BarcodeScannerScreen } from '../screens/sales/BarcodeScannerScreen';
import { SelectCustomerScreen } from '../screens/sales/SelectCustomerScreen';
import { ProductListScreen } from '../screens/inventory/ProductListScreen';
import { AddProductScreen } from '../screens/inventory/AddProductScreen';
import { ProductDetailScreen } from '../screens/inventory/ProductDetailScreen';
import { ProductEditScreen } from '../screens/inventory/ProductEditScreen';
import { CustomerListScreen } from '../screens/customers/CustomerListScreen';
import { AddCustomerScreen } from '../screens/customers/AddCustomerScreen';
import { CustomerDetailScreen } from '../screens/customers/CustomerDetailScreen';
import { ARListScreen } from '../screens/ar/ARListScreen';
import { RegisterPaymentScreen } from '../screens/ar/RegisterPaymentScreen';
import { PrinterSettingsScreen } from '../screens/settings/PrinterSettingsScreen';

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const commonStackOptions = {
  header: () => <AppTopHeader />,
  headerTitle: '',
};

function SalesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="POSMain" component={POSScreen} />
      <Stack.Screen name="Cart" component={CartScreen} />
      <Stack.Screen name="SelectCustomer" component={SelectCustomerScreen} />
      <Stack.Screen name="Receipt" component={ReceiptScreen} options={{ headerLeft: () => null }} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function InventoryStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="ProductList" component={ProductListScreen} />
      <Stack.Screen name="AddProduct" component={AddProductScreen} />
      <Stack.Screen name="ProductEdit" component={ProductEditScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function CustomersStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="CustomerList" component={CustomerListScreen} />
      <Stack.Screen name="AddCustomer" component={AddCustomerScreen} />
      <Stack.Screen name="CustomerDetail" component={CustomerDetailScreen} />
    </Stack.Navigator>
  );
}

function ARStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="ARList" component={ARListScreen} />
      <Stack.Screen name="RegisterPayment" component={RegisterPaymentScreen} />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="PrinterSettings" component={PrinterSettingsScreen} />
    </Stack.Navigator>
  );
}

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="DashboardMain" component={DashboardScreen} />
    </Stack.Navigator>
  );
}

function PlaceholderScreen({ route }: any) {
  return (
    <View style={styles.placeholderContainer}>
      <Text style={styles.placeholderTitle}>{route?.params?.title || 'Módulo'}</Text>
      <Text style={styles.placeholderSubtitle}>Próximamente</Text>
    </View>
  );
}

function BottomTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ui.colors.primary,
        tabBarInactiveTintColor: ui.colors.textMuted,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 0,
          borderTopColor: 'transparent',
          elevation: 0,
          shadowColor: 'transparent',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0,
          shadowRadius: 0,
          height: 62 + insets.bottom,
          paddingBottom: 4 + insets.bottom,
          paddingTop: 4,
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardStack}
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => <Icon source="home" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="POS"
        component={SalesStack}
        options={{
          title: 'Ventas',
          tabBarLabel: '',
          tabBarItemStyle: { marginTop: -14 },
          tabBarLabelStyle: { height: 0 },
          tabBarIcon: ({ focused }) => (
            <View
              style={{
                width: 66,
                height: 66,
                borderRadius: 33,
                backgroundColor: ui.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: '#fff',
                elevation: focused ? 9 : 5,
                marginTop: 2,
              }}
            >
              <Icon source="cash-register" color="#fff" size={30} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="AR"
        component={ARStack}
        options={{
          title: 'Cobros',
          tabBarIcon: ({ color, size }) => <Icon source="cash-plus" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, StatusBar.currentHeight || 0) + 6;
  const currentRoute = props.state.routeNames[props.state.index] || 'Home';
  const entries = [
    { key: 'dashboard', label: 'Dashboard', icon: 'chart-bar' },
    { key: 'quotes', label: 'Cotizaciones', icon: 'file-document-outline' },
    { key: 'returns', label: 'Devoluciones', icon: 'backup-restore' },
    { key: 'customers', label: 'Clientes', icon: 'account-group-outline' },
    { key: 'products', label: 'Productos', icon: 'package-variant-closed' },
    { key: 'categories', label: 'Categorías', icon: 'tag-outline' },
    { key: 'suppliers', label: 'Proveedores', icon: 'store-outline' },
    { key: 'purchases', label: 'Compras', icon: 'basket-outline' },
    { key: 'payment_receipts', label: 'Recibos de pago', icon: 'receipt-text-outline' },
    { key: 'daily_closing', label: 'Cuadre diario', icon: 'clipboard-text-outline' },
    { key: 'reports_menu', label: 'Reportes', icon: 'chart-box-outline' },
    { key: 'shipping_labels', label: 'Etiquetas de envío', icon: 'truck-outline' },
    { key: 'operating_expenses', label: 'Gastos operativos', icon: 'currency-usd' },
    { key: 'billing', label: 'Facturación', icon: 'card-text-outline' },
    { key: 'settings_menu', label: 'Ajustes', icon: 'cog-outline' },
    { key: 'backups', label: 'Backups', icon: 'database', disabled: true },
  ];

  const navigateFromDrawer = (key: string, label: string) => {
    if (key === 'dashboard') {
      (props.navigation as any).navigate('Home', { screen: 'Dashboard' });
      return;
    }
    if (key === 'sell') {
      (props.navigation as any).navigate('Home', { screen: 'POS' });
      return;
    }
    if (key === 'customers') {
      props.navigation.navigate('Customers' as never);
      return;
    }
    if (key === 'reports_menu') {
      props.navigation.navigate('Reports' as never);
      return;
    }
    if (key === 'settings_menu') {
      props.navigation.navigate('Settings' as never);
      return;
    }
    if (key === 'products') {
      props.navigation.navigate('InventoryMenu' as never);
      return;
    }
    if (key === 'ar') {
      props.navigation.navigate('ARMenu' as never);
      return;
    }
    (props.navigation as any).navigate('FeaturePlaceholder', { title: label });
  };

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={[styles.drawerContainer, { paddingTop: topInset }]}
    >
      <View style={styles.drawerHeader}>
        <Avatar.Text size={52} label="MO" style={styles.drawerAvatar} labelStyle={styles.drawerAvatarLabel} />
        <View>
          <Text style={styles.drawerTitle}>MOVOpos</Text>
          <Text style={styles.drawerSubtitle}>Panel principal</Text>
        </View>
      </View>

      <View style={styles.drawerList}>
        {entries.map((item) => {
          const selected =
            (item.key === 'dashboard' && currentRoute === 'Home') ||
            (item.key === 'customers' && currentRoute === 'Customers') ||
            (item.key === 'reports_menu' && currentRoute === 'Reports') ||
            (item.key === 'settings_menu' && currentRoute === 'Settings') ||
            (item.key === 'products' && currentRoute === 'InventoryMenu') ||
            (item.key === 'ar' && currentRoute === 'ARMenu');

          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.drawerItem, selected && styles.drawerItemActive, item.disabled && styles.drawerItemDisabled]}
              onPress={() => {
                if (item.disabled) return;
                navigateFromDrawer(item.key, item.label);
              }}
            >
              <Icon source={item.icon} size={20} color={item.disabled ? '#9CA3AF' : selected ? '#fff' : ui.colors.text} />
              <Text style={[styles.drawerItemText, selected && styles.drawerItemTextActive, item.disabled && styles.drawerItemTextDisabled]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={styles.whatsAppButton}
        onPress={async () => {
          const rawNumber = (process.env.EXPO_PUBLIC_WHATSAPP_SUPPORT_NUMBER || process.env.WHATSAPP_PHONE_NUMBER_ID || '').replace(/\D/g, '');
          if (!rawNumber) {
            Alert.alert('WhatsApp', 'Configura EXPO_PUBLIC_WHATSAPP_SUPPORT_NUMBER para abrir el chat.');
            return;
          }
          const url = `https://wa.me/${rawNumber}`;
          const supported = await Linking.canOpenURL(url);
          if (!supported) {
            Alert.alert('WhatsApp', 'No se pudo abrir WhatsApp en este dispositivo.');
            return;
          }
          await Linking.openURL(url);
        }}
      >
        <Icon source="whatsapp" size={22} color="#22C55E" />
        <Text style={styles.whatsAppText}>Ayuda por WhatsApp</Text>
      </TouchableOpacity>

      <View style={styles.drawerFooter}>
        <Text style={styles.drawerFooterText}>Local (1 PC) · RD$ · ITBIS incluido</Text>
      </View>
    </DrawerContentScrollView>
  );
}

export function MainNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: 280, backgroundColor: ui.colors.surface },
      }}
    >
      <Drawer.Screen name="Home" component={BottomTabs} options={{ title: 'Inicio' }} />
      <Drawer.Screen name="Customers" component={CustomersStack} options={{ title: 'Clientes' }} />
      <Drawer.Screen name="InventoryMenu" component={InventoryStack} options={{ title: 'Productos' }} />
      <Drawer.Screen name="ARMenu" component={ARStack} options={{ title: 'Cuentas por cobrar' }} />
      <Drawer.Screen name="Reports" component={DashboardScreen} options={{ title: 'Reportes' }} />
      <Drawer.Screen name="Settings" component={SettingsStack} options={{ title: 'Configuración' }} />
      <Drawer.Screen name="FeaturePlaceholder" component={PlaceholderScreen} options={{ title: 'Próximamente' }} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawerContainer: { flexGrow: 1, backgroundColor: ui.colors.surface, paddingBottom: 8 },
  drawerHeader: {
    backgroundColor: '#F2E7FF',
    borderRadius: ui.radius.lg,
    marginHorizontal: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawerAvatar: { backgroundColor: ui.colors.primary },
  drawerAvatarLabel: { color: '#fff', fontWeight: '700' },
  drawerTitle: { color: ui.colors.text, fontSize: 18, fontWeight: '800' },
  drawerSubtitle: { color: ui.colors.textMuted, fontSize: 12, marginTop: 2 },
  drawerList: { marginTop: 12, paddingHorizontal: 10 },
  drawerItem: {
    borderRadius: ui.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  drawerItemActive: { backgroundColor: ui.colors.primary },
  drawerItemDisabled: { opacity: 0.7 },
  drawerItemText: { color: ui.colors.text, fontSize: 14, fontWeight: '700' },
  drawerItemTextActive: { color: '#fff' },
  drawerItemTextDisabled: { color: '#8C8C8C' },
  drawerFooter: {
    marginTop: 'auto',
    borderTopWidth: 1,
    borderTopColor: ui.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#F7F5FB',
  },
  drawerFooterText: {
    color: ui.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  whatsAppButton: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.colors.border,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  whatsAppText: {
    color: ui.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  placeholderContainer: {
    flex: 1,
    backgroundColor: ui.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: ui.colors.text,
  },
  placeholderSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: ui.colors.textMuted,
  },
});
