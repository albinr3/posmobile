import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Alert, Linking, Image, Platform, AppState } from 'react-native';
import { createDrawerNavigator, DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import { Text, Icon, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ui } from '../theme/ui';
import { AppTopHeader } from '../components/AppTopHeader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuthStore } from '../store/authStore';
import { getBillingOverviewWithOptions } from '../services/billing/billingService';
import { syncService } from '../services/sync/SyncService';
import { useSyncStore } from '../store/syncStore';

import { DashboardScreen } from '../screens/reports/DashboardScreen';
import { DailyCloseScreen } from '../screens/reports/DailyCloseScreen';
import { ReportsMenuScreen } from '../screens/reports/ReportsMenuScreen';
import { SalesReportScreen } from '../screens/reports/SalesReportScreen';
import { AccountsReceivableReportScreen } from '../screens/reports/AccountsReceivableReportScreen';
import { ReceiptsReportScreen } from '../screens/reports/ReceiptsReportScreen';
import { ProfitReportScreen } from '../screens/reports/ProfitReportScreen';
import { InventoryReportScreen } from '../screens/reports/InventoryReportScreen';
import { OperatingExpensesReportScreen } from '../screens/reports/OperatingExpensesReportScreen';
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
import { PrinterDevicesScreen } from '../screens/settings/PrinterDevicesScreen';
import { CreateReturnScreen } from '../screens/returns/CreateReturnScreen';
import { ReturnReceiptScreen } from '../screens/returns/ReturnReceiptScreen';
import { InvoiceListScreen } from '../screens/billing/InvoiceListScreen';
import { BillingPlansScreen } from '../screens/billing/BillingPlansScreen';
import { TreasuryScreen } from '../screens/treasury/TreasuryScreen';

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();
const BILLING_TOKEN_TIMEOUT_MS = 4000;
const APP_RESUME_SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos

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
  { key: 'ar', label: 'Cuentas por Cobrar', icon: 'cash-plus' },
  { key: 'payment_receipts', label: 'Recibos de pago', icon: 'receipt-text-outline' },
  { key: 'daily_closing', label: 'Cuadre diario', icon: 'clipboard-text-outline' },
  { key: 'reports_menu', label: 'Reportes', icon: 'chart-box-outline' },
  { key: 'shipping_labels', label: 'Etiquetas de envío', icon: 'truck-outline' },
  { key: 'operating_expenses', label: 'Gastos operativos', icon: 'currency-usd' },
  { key: 'treasury', label: 'Tesorería', icon: 'bank-outline' },
  { key: 'billing_plans', label: 'Planes y facturación', icon: 'wallet-outline' },
  { key: 'settings_menu', label: 'Ajustes', icon: 'cog-outline' },
  { key: 'backups', label: 'Backups', icon: 'database', disabled: true },
];

function withScreenBoundary<TProps extends object>(
  Component: React.ComponentType<TProps>,
  boundaryName: string
) {
  const Wrapped = (props: TProps) => (
    <ErrorBoundary boundaryName={boundaryName}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `WithScreenBoundary(${boundaryName})`;
  return Wrapped;
}

const POSScreenWithBoundary = withScreenBoundary(POSScreen, 'POSScreen');
const QuoteScreenWithBoundary = withScreenBoundary(QuoteScreen, 'QuoteScreen');
const QuoteListScreenWithBoundary = withScreenBoundary(QuoteListScreen, 'QuoteListScreen');
const CartScreenWithBoundary = withScreenBoundary(CartScreen, 'CartScreen');
const QuoteCartScreenWithBoundary = withScreenBoundary(QuoteCartScreen, 'QuoteCartScreen');
const ReceiptScreenWithBoundary = withScreenBoundary(ReceiptScreen, 'ReceiptScreen');
const BarcodeScannerScreenWithBoundary = withScreenBoundary(BarcodeScannerScreen, 'BarcodeScannerScreen');
const SelectCustomerScreenWithBoundary = withScreenBoundary(SelectCustomerScreen, 'SelectCustomerScreen');
const ProductListScreenWithBoundary = withScreenBoundary(ProductListScreen, 'ProductListScreen');
const AddProductScreenWithBoundary = withScreenBoundary(AddProductScreen, 'AddProductScreen');
const ProductDetailScreenWithBoundary = withScreenBoundary(ProductDetailScreen, 'ProductDetailScreen');
const ProductEditScreenWithBoundary = withScreenBoundary(ProductEditScreen, 'ProductEditScreen');
const CategoryListScreenWithBoundary = withScreenBoundary(CategoryListScreen, 'CategoryListScreen');
const AddCategoryScreenWithBoundary = withScreenBoundary(AddCategoryScreen, 'AddCategoryScreen');
const SupplierListScreenWithBoundary = withScreenBoundary(SupplierListScreen, 'SupplierListScreen');
const AddSupplierScreenWithBoundary = withScreenBoundary(AddSupplierScreen, 'AddSupplierScreen');
const PurchaseListScreenWithBoundary = withScreenBoundary(PurchaseListScreen, 'PurchaseListScreen');
const AddPurchaseScreenWithBoundary = withScreenBoundary(AddPurchaseScreen, 'AddPurchaseScreen');
const OperatingExpensesScreenWithBoundary = withScreenBoundary(OperatingExpensesScreen, 'OperatingExpensesScreen');
const AddOperatingExpenseScreenWithBoundary = withScreenBoundary(AddOperatingExpenseScreen, 'AddOperatingExpenseScreen');
const CustomerListScreenWithBoundary = withScreenBoundary(CustomerListScreen, 'CustomerListScreen');
const AddCustomerScreenWithBoundary = withScreenBoundary(AddCustomerScreen, 'AddCustomerScreen');
const CustomerDetailScreenWithBoundary = withScreenBoundary(CustomerDetailScreen, 'CustomerDetailScreen');
const ARListScreenWithBoundary = withScreenBoundary(ARListScreen, 'ARListScreen');
const RegisterPaymentScreenWithBoundary = withScreenBoundary(RegisterPaymentScreen, 'RegisterPaymentScreen');
const PaymentReceiptsScreenWithBoundary = withScreenBoundary(PaymentReceiptsScreen, 'PaymentReceiptsScreen');
const PrinterSettingsScreenWithBoundary = withScreenBoundary(PrinterSettingsScreen, 'PrinterSettingsScreen');
const PrinterDevicesScreenWithBoundary = withScreenBoundary(PrinterDevicesScreen, 'PrinterDevicesScreen');
const CreateReturnScreenWithBoundary = withScreenBoundary(CreateReturnScreen, 'CreateReturnScreen');
const ReturnReceiptScreenWithBoundary = withScreenBoundary(ReturnReceiptScreen, 'ReturnReceiptScreen');
const InvoiceListScreenWithBoundary = withScreenBoundary(InvoiceListScreen, 'InvoiceListScreen');
const BillingPlansScreenWithBoundary = withScreenBoundary(BillingPlansScreen, 'BillingPlansScreen');
const TreasuryScreenWithBoundary = withScreenBoundary(TreasuryScreen, 'TreasuryScreen');
const DashboardScreenWithBoundary = withScreenBoundary(DashboardScreen, 'DashboardScreen');
const DailyCloseScreenWithBoundary = withScreenBoundary(DailyCloseScreen, 'DailyCloseScreen');
const ReportsMenuScreenWithBoundary = withScreenBoundary(ReportsMenuScreen, 'ReportsMenuScreen');
const SalesReportScreenWithBoundary = withScreenBoundary(SalesReportScreen, 'SalesReportScreen');
const AccountsReceivableReportScreenWithBoundary = withScreenBoundary(AccountsReceivableReportScreen, 'AccountsReceivableReportScreen');
const ReceiptsReportScreenWithBoundary = withScreenBoundary(ReceiptsReportScreen, 'ReceiptsReportScreen');
const ProfitReportScreenWithBoundary = withScreenBoundary(ProfitReportScreen, 'ProfitReportScreen');
const InventoryReportScreenWithBoundary = withScreenBoundary(InventoryReportScreen, 'InventoryReportScreen');
const OperatingExpensesReportScreenWithBoundary = withScreenBoundary(OperatingExpensesReportScreen, 'OperatingExpensesReportScreen');
const PlaceholderScreenWithBoundary = withScreenBoundary(PlaceholderScreen, 'FeaturePlaceholder');

function SalesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="POSMain" component={POSScreenWithBoundary} />
      <Stack.Screen name="Cart" component={CartScreenWithBoundary} />
      <Stack.Screen name="SelectCustomer" component={SelectCustomerScreenWithBoundary} />
      <Stack.Screen name="AddCustomer" component={AddCustomerScreenWithBoundary} />
      <Stack.Screen name="Receipt" component={ReceiptScreenWithBoundary} options={{ headerLeft: () => null }} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreenWithBoundary} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function QuotesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="QuoteMain" component={QuoteScreenWithBoundary} />
      <Stack.Screen name="QuoteCart" component={QuoteCartScreenWithBoundary} />
      <Stack.Screen name="SelectQuoteCustomer" component={SelectCustomerScreenWithBoundary} initialParams={{ mode: 'QUOTE' }} />
      <Stack.Screen name="AddCustomer" component={AddCustomerScreenWithBoundary} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreenWithBoundary} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function QuoteListStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="QuoteListMain" component={QuoteListScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function InventoryStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="ProductList" component={ProductListScreenWithBoundary} />
      <Stack.Screen name="AddProduct" component={AddProductScreenWithBoundary} />
      <Stack.Screen name="ProductEdit" component={ProductEditScreenWithBoundary} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreenWithBoundary} />
      <Stack.Screen name="AddCategory" component={AddCategoryScreenWithBoundary} />
      <Stack.Screen name="AddSupplier" component={AddSupplierScreenWithBoundary} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreenWithBoundary} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function CategoriesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="CategoryList" component={CategoryListScreenWithBoundary} />
      <Stack.Screen name="AddCategory" component={AddCategoryScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function SuppliersStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="SupplierList" component={SupplierListScreenWithBoundary} />
      <Stack.Screen name="AddSupplier" component={AddSupplierScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function PurchasesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="PurchaseList" component={PurchaseListScreenWithBoundary} />
      <Stack.Screen name="AddPurchase" component={AddPurchaseScreenWithBoundary} />
      <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreenWithBoundary} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function CustomersStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="CustomerList" component={CustomerListScreenWithBoundary} />
      <Stack.Screen name="AddCustomer" component={AddCustomerScreenWithBoundary} />
      <Stack.Screen name="CustomerDetail" component={CustomerDetailScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function ARStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="ARList" component={ARListScreenWithBoundary} />
      <Stack.Screen name="RegisterPayment" component={RegisterPaymentScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function PaymentReceiptsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="PaymentReceipts" component={PaymentReceiptsScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="PrinterSettings" component={PrinterSettingsScreenWithBoundary} />
      <Stack.Screen name="Printers" component={PrinterDevicesScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function ReturnsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="CreateReturn" component={CreateReturnScreenWithBoundary} />
      <Stack.Screen name="ReturnReceipt" component={ReturnReceiptScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function BillingStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="InvoiceList" component={InvoiceListScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function BillingPlansStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="BillingPlans" component={BillingPlansScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function OperatingExpensesStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="OperatingExpenses" component={OperatingExpensesScreenWithBoundary} />
      <Stack.Screen name="AddOperatingExpense" component={AddOperatingExpenseScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function DashboardStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="DashboardMain" component={DashboardScreenWithBoundary} />
      <Stack.Screen name="DailyClose" component={DailyCloseScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function ReportsStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="ReportsMenuMain" component={ReportsMenuScreenWithBoundary} />
      <Stack.Screen name="SalesReport" component={SalesReportScreenWithBoundary} />
      <Stack.Screen name="AccountsReceivableReport" component={AccountsReceivableReportScreenWithBoundary} />
      <Stack.Screen name="ReceiptsReport" component={ReceiptsReportScreenWithBoundary} />
      <Stack.Screen name="ProfitReport" component={ProfitReportScreenWithBoundary} />
      <Stack.Screen name="InventoryReport" component={InventoryReportScreenWithBoundary} />
      <Stack.Screen name="OperatingExpensesReport" component={OperatingExpensesReportScreenWithBoundary} />
    </Stack.Navigator>
  );
}

function TreasuryStack() {
  return (
    <Stack.Navigator screenOptions={commonStackOptions}>
      <Stack.Screen name="Treasury" component={TreasuryScreenWithBoundary} />
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
  const defaultTabBarStyle = {
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
  };

  return (
    <Tab.Navigator
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ui.colors.primary,
        tabBarInactiveTintColor: ui.colors.textMuted,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
        tabBarStyle: defaultTabBarStyle,
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
          const hideTabBar = ['Cart', 'SelectCustomer', 'AddCustomer', 'Receipt', 'BarcodeScanner'].includes(nestedRoute);

          return {
            title: 'Ventas',
            tabBarLabel: '',
            tabBarItemStyle: { marginTop: -14 },
            tabBarLabelStyle: { height: 0 },
            tabBarStyle: hideTabBar ? { display: 'none' } : defaultTabBarStyle,
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
  const bottomInset = Math.max(insets.bottom, 12);
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
    if (key === 'treasury') {
      (props.navigation as any).navigate('TreasuryMenu', { screen: 'Treasury' });
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
      contentContainerStyle={[styles.drawerContainer, { paddingTop: topInset, paddingBottom: bottomInset }]}
    >
      <View style={styles.drawerHeader}>
        <View style={styles.logoWrap}>
          <Image source={require('../../assets/movoLogoDark.png')} style={styles.logoImage} resizeMode="contain" />
        </View>
      </View>

      {!isBillingBlocked && (
        <TouchableOpacity
          style={styles.sellButton}
          activeOpacity={0.8}
          onPress={() => navigateFromDrawer('sell', 'Vender')}
        >
          <View style={styles.sellButtonIconWrap}>
            <Icon source="cash-register" size={26} color="#fff" />
          </View>
          <Text style={styles.sellButtonText}>VENDER</Text>
          <Icon source="chevron-right" size={22} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      )}

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
            (item.key === 'ar' && currentRoute === 'ARMenu') ||
            (item.key === 'treasury' && currentRoute === 'TreasuryMenu');

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

    </DrawerContentScrollView>
  );
}

export function MainNavigator() {
  const { getToken } = useAuth();
  const { subUserToken, accountId, isBillingBlocked, setBillingState, setSubUser } = useAuthStore();
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
        const netInfo = await NetInfo.fetch();
        const hasInternet = !!netInfo.isConnected && netInfo.isInternetReachable !== false;
        if (!hasInternet) {
          setBillingStateRef.current(null);
          return;
        }

        const clerkToken = await Promise.race<string | null>([
          getTokenRef.current(),
          new Promise<string | null>((resolve) => {
            setTimeout(() => resolve(null), BILLING_TOKEN_TIMEOUT_MS);
          }),
        ]);
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
        if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) {
          await setSubUser(null, null, null);
        } else {
          console.error('Error validando acceso por facturación:', error);
        }
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

  // Auto-sync: fullSync al montar y al volver del background (con cooldown de 10 min)
  useEffect(() => {
    if (!subUserToken) return;

    const runSync = async () => {
      try {
        const netInfo = await NetInfo.fetch();
        const hasInternet = !!netInfo.isConnected && netInfo.isInternetReachable !== false;
        if (!hasInternet) return;

        const clerkToken = await getTokenRef.current();
        if (!clerkToken) return;

        syncService.setTokenGetter(() => getTokenRef.current());
        syncService.setSubUserTokenGetter(async () => useAuthStore.getState().subUserToken);
        await syncService.fullSync(clerkToken, { ignoreCooldown: true });
      } catch (error) {
        console.error('[MainNavigator] Error en auto-sync:', error);
      }
    };

    // Sync inmediato al montar
    runSync();

    // Sync al volver del background (con cooldown de 10 min)
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        const lastSync = useSyncStore.getState().lastSyncTime;
        const elapsed = lastSync ? Date.now() - lastSync : Infinity;
        if (elapsed >= APP_RESUME_SYNC_COOLDOWN_MS) {
          runSync();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [subUserToken]);

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
      backBehavior="history"
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
          <Drawer.Screen name="TreasuryMenu" component={TreasuryStack} options={{ title: 'Tesorería' }} />
          <Drawer.Screen name="ARMenu" component={ARStack} options={{ title: 'Cuentas por cobrar' }} />
          <Drawer.Screen name="Reports" component={ReportsStack} options={{ title: 'Reportes' }} />
          <Drawer.Screen name="Settings" component={SettingsStack} options={{ title: 'Configuración' }} />
          <Drawer.Screen name="FeaturePlaceholder" component={PlaceholderScreenWithBoundary} options={{ title: 'Próximamente' }} />
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
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: 170,
    height: 62,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: { width: '96%', height: '86%' },
  drawerList: { marginTop: 8, paddingHorizontal: 10 },
  sellButton: {
    marginHorizontal: 12,
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...Platform.select({
      android: { elevation: 6 },
      ios: {
        shadowColor: '#16A34A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
    }),
  },
  sellButtonIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellButtonText: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
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
