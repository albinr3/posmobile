import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { IconButton } from 'react-native-paper';

// Screens
import { DashboardScreen } from '../screens/reports/DashboardScreen';
import { POSScreen } from '../screens/sales/POSScreen';
import { CartScreen } from '../screens/sales/CartScreen';
import { ReceiptScreen } from '../screens/sales/ReceiptScreen';
import { BarcodeScannerScreen } from '../screens/sales/BarcodeScannerScreen';
import { SelectCustomerScreen } from '../screens/sales/SelectCustomerScreen';
import { ProductListScreen } from '../screens/inventory/ProductListScreen';
import { AddProductScreen } from '../screens/inventory/AddProductScreen';
import { ProductDetailScreen } from '../screens/inventory/ProductDetailScreen';
import { CustomerListScreen } from '../screens/customers/CustomerListScreen';
import { AddCustomerScreen } from '../screens/customers/AddCustomerScreen';
import { CustomerDetailScreen } from '../screens/customers/CustomerDetailScreen';
import { ARListScreen } from '../screens/ar/ARListScreen';
import { RegisterPaymentScreen } from '../screens/ar/RegisterPaymentScreen';
import { PrinterSettingsScreen } from '../screens/settings/PrinterSettingsScreen';

const Drawer = createDrawerNavigator();
const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Stack para POS/Ventas
function SalesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="POSMain" 
        component={POSScreen}
        options={{ title: 'Punto de Venta' }}
      />
      <Stack.Screen 
        name="Cart" 
        component={CartScreen}
        options={{ title: 'Carrito' }}
      />
      <Stack.Screen
        name="SelectCustomer"
        component={SelectCustomerScreen}
        options={{ title: 'Seleccionar Cliente' }}
      />
      <Stack.Screen 
        name="Receipt" 
        component={ReceiptScreen}
        options={{ title: 'Recibo', headerLeft: () => null }}
      />
      <Stack.Screen 
        name="BarcodeScanner" 
        component={BarcodeScannerScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

// Stack para Inventario
function InventoryStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="ProductList" 
        component={ProductListScreen}
        options={{ title: 'Inventario' }}
      />
      <Stack.Screen 
        name="AddProduct" 
        component={AddProductScreen}
        options={{ title: 'Nuevo Producto' }}
      />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetailScreen}
        options={{ title: 'Detalle de Producto' }}
      />
      <Stack.Screen 
        name="BarcodeScanner" 
        component={BarcodeScannerScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

// Stack para Clientes
function CustomersStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="CustomerList" 
        component={CustomerListScreen}
        options={{ title: 'Clientes' }}
      />
      <Stack.Screen 
        name="AddCustomer" 
        component={AddCustomerScreen}
        options={{ title: 'Nuevo Cliente' }}
      />
      <Stack.Screen
        name="CustomerDetail"
        component={CustomerDetailScreen}
        options={{ title: 'Detalle de Cliente' }}
      />
    </Stack.Navigator>
  );
}

// Stack para Cuentas por Cobrar
function ARStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="ARList" 
        component={ARListScreen}
        options={{ title: 'Cuentas por Cobrar' }}
      />
      <Stack.Screen 
        name="RegisterPayment" 
        component={RegisterPaymentScreen}
        options={{ title: 'Registrar Pago' }}
      />
    </Stack.Navigator>
  );
}

// Stack para Configuración
function SettingsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="PrinterSettings" 
        component={PrinterSettingsScreen}
        options={{ title: 'Configuración de Impresora' }}
      />
    </Stack.Navigator>
  );
}

// Bottom Tabs Principal
function BottomTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1a73e8',
      }}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => (
            <IconButton icon="home" iconColor={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="POS" 
        component={SalesStack}
        options={{
          title: 'Ventas',
          tabBarIcon: ({ color, size }) => (
            <IconButton icon="cash-register" iconColor={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="Inventory" 
        component={InventoryStack}
        options={{
          title: 'Inventario',
          tabBarIcon: ({ color, size }) => (
            <IconButton icon="package-variant" iconColor={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="CustomersTab"
        component={CustomersStack}
        options={{
          title: 'Clientes',
          tabBarIcon: ({ color, size }) => (
            <IconButton icon="account-group" iconColor={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="AR" 
        component={ARStack}
        options={{
          title: 'Cobrar',
          tabBarIcon: ({ color, size }) => (
            <IconButton icon="cash-plus" iconColor={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Drawer Navigation Principal
export function MainNavigator() {
  return (
    <Drawer.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Drawer.Screen 
        name="Home" 
        component={BottomTabs}
        options={{
          title: 'Inicio',
          drawerIcon: ({ color, size }) => (
            <IconButton icon="home" iconColor={color} size={size} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Customers" 
        component={CustomersStack}
        options={{
          title: 'Clientes',
          drawerIcon: ({ color, size }) => (
            <IconButton icon="account-group" iconColor={color} size={size} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Reports" 
        component={DashboardScreen}
        options={{
          title: 'Reportes',
          drawerIcon: ({ color, size }) => (
            <IconButton icon="chart-bar" iconColor={color} size={size} />
          ),
        }}
      />
      <Drawer.Screen 
        name="Settings" 
        component={SettingsStack}
        options={{
          title: 'Configuración',
          drawerIcon: ({ color, size }) => (
            <IconButton icon="cog" iconColor={color} size={size} />
          ),
        }}
      />
    </Drawer.Navigator>
  );
}
