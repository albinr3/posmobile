import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Alert, Linking, Image } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { Text, Icon, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ui } from '../theme/ui';
import { AppTopHeader } from '../components/AppTopHeader';
import { useAuthStore } from '../store/authStore';
import { getBillingOverviewWithOptions } from '../services/billing/billingService';

import { DashboardScreen } from '../screens/reports/DashboardScreen';
import { DailyCloseScreen } from '../screens/reports/DailyCloseScreen';
import { ReportsMenuScreen } from '../screens/reports/ReportsMenuScreen';
import { SalesReportScreen } from '../screens/reports/SalesReportScreen';
import { AccountsReceivableReportScreen } from '../screens/reports/AccountsReceivableReportScreen';
import { ReceiptsReportScreen } from '../screens/reports/ReceiptsReportScreen';
import { ProfitReportScreen } from '../screens/reports/ProfitReportScreen';
import { InventoryReportScreen } from '../screens/reports/InventoryReportScreen';
import { POSScreen } from '../screens/sales/POSScreen';
import { QuoteScreen } from '../screens/sales/QuoteScreen';
import { QuoteListScreen } from '../screens/sales/QuoteListScreen';
import { CartScreen } from '../screens/sales/CartScreen';
import { QuoteCartScreen } from '../screens/sales/QuoteCartScreen';
import { ReceiptScreen } from '../screens/sales/ReceiptScreen';
import { BarcodeScannerScreen } from '../screens/sales/BarcodeScannerScreen';
import { SelectCustomerScreen } from '../screens/sales/SelectCustomerScreen';
import { ProductListScreen } from '../screens/inventory/ProductListScreen';
import { AddProductScreen } from '../screens/inventory/AddProductScreen';
import { ProductDetailScreen } from '../screens/inventory/ProductDetailScreen';
import { ProductEditScreen } from '../screens/inventory/ProductEditScreen';
import { CategoryListScreen } from '../screens/categories/CategoryListScreen';
import { AddCategoryScreen } from '../screens/categories/AddCategoryScreen';
import { SupplierListScreen } from '../screens/suppliers/SupplierListScreen';
import { AddSupplierScreen } from '../screens/suppliers/AddSupplierScreen';
import { PurchaseListScreen } from '../screens/purchases/PurchaseListScreen';
import { AddPurchaseScreen } from '../screens/purchases/AddPurchaseScreen';
import { OperatingExpensesScreen } from '../screens/operating-expenses/OperatingExpensesScreen';
import { AddOperatingExpenseScreen } from '../screens/operating-expenses/AddOperatingExpenseScreen';
import { CustomerListScreen } from '../screens/customers/CustomerListScreen';
import { AddCustomerScreen } from '../screens/customers/AddCustomerScreen';
import { CustomerDetailScreen } from '../screens/customers/CustomerDetailScreen';
import { ARListScreen } from '../screens/ar/ARListScreen';
import { RegisterPaymentScreen } from '../screens/ar/RegisterPaymentScreen';
import { PaymentReceiptsScreen } from '../screens/ar/PaymentReceiptsScreen';
import { PrinterSettingsScreen } from '../screens/settings/PrinterSettingsScreen';
import { CreateReturnScreen } from '../screens/returns/CreateReturnScreen';
import { ReturnReceiptScreen } from '../screens/returns/ReturnReceiptScreen';
import { InvoiceListScreen } from '../screens/billing/InvoiceListScreen';
import { BillingPlansScreen } from '../screens/billing/BillingPlansScreen';

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const commonStackOptions = {
  header: () => <AppTopHeader />,
  headerTitle: '',
};

const DRAWER_ENTRIES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'chart-bar' },
  { key: 'billing', label: 'Lista de Facturas', icon: 'card-text-outline' },
  { key: 'quotes', label: 'Cotizaciones', icon: 'file-document-outline' },
  { key: 'quotes_list', label: 'Lista de Cotizaciones', icon: 'file-document-multiple-outline' },
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
  { key: 'billing_plans', label: 'Planes y facturación', icon: 'wallet-outline' },
  { key: 'settings_menu', label: 'Ajustes', icon: 'cog-outline' },
  { key: 'backups', label: 'Backups', icon: 'database', disabled: true },
];

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

function QuotesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="QuoteMain" component={QuoteScreen} />
      <Stack.Screen name="QuoteCart" component={QuoteCartScreen} />
      <Stack.Screen name="SelectQuoteCustomer" component={SelectCustomerScreen} initialParams={{ mode: 'QUOTE' }} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function QuoteListStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="QuoteListMain" component={QuoteListScreen} />
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

function CategoriesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="CategoryList" component={CategoryListScreen} />
      <Stack.Screen name="AddCategory" component={AddCategoryScreen} />
    </Stack.Navigator>
  );
}

function SuppliersStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="SupplierList" component={SupplierListScreen} />
      <Stack.Screen name="AddSupplier" component={AddSupplierScreen} />
    </Stack.Navigator>
  );
}

function PurchasesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="PurchaseList" component={PurchaseListScreen} />
      <Stack.Screen name="AddPurchase" component={AddPurchaseScreen} />
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

function PaymentReceiptsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="PaymentReceipts" component={PaymentReceiptsScreen} />
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

function ReturnsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="CreateReturn" component={CreateReturnScreen} />
      <Stack.Screen name="ReturnReceipt" component={ReturnReceiptScreen} />
    </Stack.Navigator>
  );
}

function BillingStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="InvoiceList" component={InvoiceListScreen} />
    </Stack.Navigator>
  );
}

function BillingPlansStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="BillingPlans" component={BillingPlansScreen} />
    </Stack.Navigator>
  );
}

function OperatingExpensesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="OperatingExpenses" component={OperatingExpensesScreen} />
      <Stack.Screen name="AddOperatingExpense" component={AddOperatingExpenseScreen} />
    </Stack.Navigator>
  );
}

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="DashboardMain" component={DashboardScreen} />
      <Stack.Screen name="DailyClose" component={DailyCloseScreen} />
    </Stack.Navigator>
  );
}

function ReportsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="ReportsMenuMain" component={ReportsMenuScreen} />
      <Stack.Screen name="SalesReport" component={SalesReportScreen} />
      <Stack.Screen name="AccountsReceivableReport" component={AccountsReceivableReportScreen} />
      <Stack.Screen name="ReceiptsReport" component={ReceiptsReportScreen} />
      <Stack.Screen name="ProfitReport" component={ProfitReportScreen} />
      <Stack.Screen name="InventoryReport" component={InventoryReportScreen} />
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
        options={({ route }) => {
          const nestedRoute = getFocusedRouteNameFromRoute(route) ?? 'POSMain';
          const hideTabBar = ['Cart', 'SelectCustomer', 'Receipt', 'BarcodeScanner'].includes(nestedRoute);

          return {
            title: 'Ventas',
            tabBarLabel: '',
            tabBarItemStyle: { marginTop: -14 },
            tabBarLabelStyle: { height: 0 },
            tabBarStyle: hideTabBar ? { display: 'none' } : undefined,
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
          };
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
  const { signOut } = useAuth();
  const { logout, setSubUser, isBillingBlocked } = useAuthStore();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, StatusBar.currentHeight || 0) + 6;
  const currentRoute = props.state.routeNames[props.state.index] || 'Home';
  const entries = useMemo(
    () => (isBillingBlocked ? DRAWER_ENTRIES.filter((item) => item.key === 'billing_plans') : DRAWER_ENTRIES),
    [isBillingBlocked]
  );

  const navigateFromDrawer = (key: string, label: string) => {
    if (key === 'dashboard') {
      (props.navigation as any).navigate('Home', { screen: 'Dashboard' });
      return;
    }
    if (key === 'daily_closing') {
      (props.navigation as any).navigate('Home', { screen: 'Dashboard', params: { screen: 'DailyClose' } });
      return;
    }
    if (key === 'sell') {
      (props.navigation as any).navigate('Home', { screen: 'POS' });
      return;
    }
    if (key === 'customers') {
      (props.navigation as any).navigate('Customers', { screen: 'CustomerList' });
      return;
    }
    if (key === 'quotes') {
      (props.navigation as any).navigate('Quotes', { screen: 'QuoteMain' });
      return;
    }
    if (key === 'quotes_list') {
      (props.navigation as any).navigate('QuoteListMenu', { screen: 'QuoteListMain' });
      return;
    }
    if (key === 'returns') {
      (props.navigation as any).navigate('Returns', { screen: 'CreateReturn' });
      return;
    }
    if (key === 'reports_menu') {
      props.navigation.navigate('Reports' as never);
      return;
    }
    if (key === 'settings_menu') {
      (props.navigation as any).navigate('Settings', { screen: 'PrinterSettings' });
      return;
    }
    if (key === 'products') {
      (props.navigation as any).navigate('InventoryMenu', { screen: 'ProductList' });
      return;
    }
    if (key === 'categories') {
      (props.navigation as any).navigate('CategoriesMenu', { screen: 'CategoryList' });
      return;
    }
    if (key === 'suppliers') {
      (props.navigation as any).navigate('SuppliersMenu', { screen: 'SupplierList' });
      return;
    }
    if (key === 'purchases') {
      (props.navigation as any).navigate('PurchasesMenu', { screen: 'PurchaseList' });
      return;
    }
    if (key === 'billing') {
      (props.navigation as any).navigate('BillingMenu', { screen: 'InvoiceList' });
      return;
    }
    if (key === 'billing_plans') {
      (props.navigation as any).navigate('BillingPlansMenu', { screen: 'BillingPlans' });
      return;
    }
    if (key === 'payment_receipts') {
      (props.navigation as any).navigate('PaymentReceiptsMenu', { screen: 'PaymentReceipts' });
      return;
    }
    if (key === 'operating_expenses') {
      (props.navigation as any).navigate('OperatingExpensesMenu', { screen: 'OperatingExpenses' });
      return;
    }
    if (key === 'ar') {
      (props.navigation as any).navigate('ARMenu', { screen: 'ARList' });
      return;
    }
    (props.navigation as any).navigate('FeaturePlaceholder', { title: label });
  };

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', 'Esto cerrará el subusuario y la cuenta principal (correo). ¿Deseas continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          try {
            // Cerrar primero sesión de Clerk para que AuthNavigator no se inicialice en SelectUser.
            await signOut();
            await logout();
          } catch (error) {
            console.error('Error cerrando sesión:', error);
            Alert.alert('Sesión', 'No se pudo cerrar sesión. Intenta de nuevo.');
          }
        },
      },
    ]);
  };

  const handleSwitchUser = () => {
    Alert.alert('Cambiar usuario', 'Se cerrará el subusuario actual y volverás a selección de usuario.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cambiar',
        onPress: async () => {
          try {
            await setSubUser(null, null, null);
            props.navigation.closeDrawer();
          } catch (error) {
            console.error('Error cambiando subusuario:', error);
            Alert.alert('Usuario', 'No se pudo cambiar de usuario.');
          }
        },
      },
    ]);
  };

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={[styles.drawerContainer, { paddingTop: topInset }]}
    >
      <View style={styles.drawerHeader}>
        <View style={styles.logoWrap}>
          <Image source={require('../../assets/movoLogo.png')} style={styles.logoImage} resizeMode="contain" />
        </View>
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
            (item.key === 'quotes' && currentRoute === 'Quotes') ||
            (item.key === 'quotes_list' && currentRoute === 'QuoteListMenu') ||
            (item.key === 'returns' && currentRoute === 'Returns') ||
            (item.key === 'reports_menu' && currentRoute === 'Reports') ||
            (item.key === 'settings_menu' && currentRoute === 'Settings') ||
            (item.key === 'products' && currentRoute === 'InventoryMenu') ||
            (item.key === 'categories' && currentRoute === 'CategoriesMenu') ||
            (item.key === 'suppliers' && currentRoute === 'SuppliersMenu') ||
            (item.key === 'purchases' && currentRoute === 'PurchasesMenu') ||
            (item.key === 'billing_plans' && currentRoute === 'BillingPlansMenu') ||
            (item.key === 'billing' && currentRoute === 'BillingMenu') ||
            (item.key === 'payment_receipts' && currentRoute === 'PaymentReceiptsMenu') ||
            (item.key === 'operating_expenses' && currentRoute === 'OperatingExpensesMenu') ||
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
          const url = 'https://wa.me/18499254434?text=Hola%20MOVOPos';
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

      <TouchableOpacity style={styles.switchUserButton} onPress={handleSwitchUser}>
        <Icon source="account-switch-outline" size={22} color={ui.colors.primary} />
        <Text style={styles.switchUserText}>Cambiar usuario</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Icon source="logout" size={22} color="#DC2626" />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </TouchableOpacity>

      <View style={styles.drawerFooter}>
        <Text style={styles.drawerFooterText}>Local (1 PC) · RD$ · ITBIS incluido</Text>
      </View>
    </DrawerContentScrollView>
  );
}

export function MainNavigator() {
  const { getToken } = useAuth();
  const { subUserToken, accountId, isBillingBlocked, setBillingState } = useAuthStore();
  const [checkingBillingAccess, setCheckingBillingAccess] = useState(true);
  const getTokenRef = useRef(getToken);
  const setBillingStateRef = useRef(setBillingState);
  getTokenRef.current = getToken;
  setBillingStateRef.current = setBillingState;

  useEffect(() => {
    let mounted = true;

    const loadBillingAccess = async () => {
      if (!subUserToken) {
        setBillingStateRef.current(null);
        if (mounted) setCheckingBillingAccess(false);
        return;
      }

      try {
        if (mounted) setCheckingBillingAccess(true);
        const clerkToken = await getTokenRef.current();
        if (!clerkToken) {
          setBillingStateRef.current(null);
          return;
        }

        const overview = await getBillingOverviewWithOptions(
          {
            clerkToken,
            subUserToken,
            accountId,
          },
          { forceRefresh: true }
        );

        if (!mounted) return;
        setBillingStateRef.current(overview.state);
      } catch (error) {
        console.error('Error validando acceso por facturación:', error);
        if (!mounted) return;
        setBillingStateRef.current(null);
      } finally {
        if (mounted) setCheckingBillingAccess(false);
      }
    };

    loadBillingAccess();

    return () => {
      mounted = false;
    };
  }, [accountId, subUserToken]);

  if (checkingBillingAccess) {
    return (
      <View style={styles.loadingAccessContainer}>
        <ActivityIndicator animating color={ui.colors.primary} />
        <Text style={styles.loadingAccessText}>Validando acceso...</Text>
      </View>
    );
  }

  return (
    <Drawer.Navigator
      key={isBillingBlocked ? 'billing-blocked' : 'full-access'}
      initialRouteName={isBillingBlocked ? 'BillingPlansMenu' : 'Home'}
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: 280, backgroundColor: ui.colors.surface },
      }}
    >
      <Drawer.Screen name="BillingPlansMenu" component={BillingPlansStack} options={{ title: 'Planes y facturación' }} />
      {!isBillingBlocked ? (
        <>
          <Drawer.Screen name="Home" component={BottomTabs} options={{ title: 'Inicio' }} />
          <Drawer.Screen name="Customers" component={CustomersStack} options={{ title: 'Clientes' }} />
          <Drawer.Screen name="Quotes" component={QuotesStack} options={{ title: 'Cotizaciones' }} />
          <Drawer.Screen name="QuoteListMenu" component={QuoteListStack} options={{ title: 'Lista de Cotizaciones' }} />
          <Drawer.Screen name="Returns" component={ReturnsStack} options={{ title: 'Devoluciones' }} />
          <Drawer.Screen name="InventoryMenu" component={InventoryStack} options={{ title: 'Productos' }} />
          <Drawer.Screen name="CategoriesMenu" component={CategoriesStack} options={{ title: 'Categorías' }} />
          <Drawer.Screen name="SuppliersMenu" component={SuppliersStack} options={{ title: 'Proveedores' }} />
          <Drawer.Screen name="PurchasesMenu" component={PurchasesStack} options={{ title: 'Compras' }} />
          <Drawer.Screen name="BillingMenu" component={BillingStack} options={{ title: 'Facturación' }} />
          <Drawer.Screen name="PaymentReceiptsMenu" component={PaymentReceiptsStack} options={{ title: 'Recibos de pago' }} />
          <Drawer.Screen name="OperatingExpensesMenu" component={OperatingExpensesStack} options={{ title: 'Gastos operativos' }} />
          <Drawer.Screen name="ARMenu" component={ARStack} options={{ title: 'Cuentas por cobrar' }} />
          <Drawer.Screen name="Reports" component={ReportsStack} options={{ title: 'Reportes' }} />
          <Drawer.Screen name="Settings" component={SettingsStack} options={{ title: 'Configuración' }} />
          <Drawer.Screen name="FeaturePlaceholder" component={PlaceholderScreen} options={{ title: 'Próximamente' }} />
        </>
      ) : null}
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
  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: { width: 44, height: 26 },
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
  logoutButton: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoutText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '800',
  },
  switchUserButton: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switchUserText: {
    color: ui.colors.primary,
    fontSize: 15,
    fontWeight: '800',
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
  loadingAccessContainer: {
    flex: 1,
    backgroundColor: ui.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  loadingAccessText: {
    color: ui.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
