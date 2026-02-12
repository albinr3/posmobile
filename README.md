# 📱 MOVOPos Mobile

Aplicación móvil de punto de venta para MOVOPos, construida con React Native y Expo. Funcionalidad offline-first con sincronización automática.

## 🚀 Características

- **Punto de Venta (POS)** - Ventas rápidas con escaneo de código de barras
- **Inventario** - Gestión de productos con fotos y códigos
- **Clientes** - Base de datos de clientes con historial
- **Cuentas por Cobrar** - Seguimiento de créditos y pagos
- **Dashboard** - Métricas y reportes en tiempo real
- **Offline-First** - Funciona sin internet, sincroniza cuando hay conexión
- **Autenticación** - Login con WhatsApp OTP + Biométrico (huella/Face ID)
- **Impresión** - Soporte para impresoras térmicas Bluetooth

## 📋 Requisitos

- Node.js 18+
- npm o yarn
- Expo CLI
- Android Studio (para emulador) o dispositivo físico con Expo Go

## 🛠️ Instalación

```bash
# Clonar o navegar al proyecto
cd movopos-mobile

# Instalar dependencias
npm install

# Iniciar la aplicación
npx expo start
```

## 📱 Ejecutar la App

### Opción 1: Expo Go (Recomendado para desarrollo)
```bash
npx expo start
```
Escanea el código QR con la app **Expo Go** en tu teléfono.

### Opción 2: Emulador Android
```bash
npm run android
```
Requiere Android Studio con emulador configurado.

### Opción 3: Development Build
```bash
npx expo run:android
```

## 📁 Estructura del Proyecto

```
src/
├── components/        # Componentes reutilizables
├── database/          # SQLite y manejo de datos locales
│   └── Database.ts
├── hooks/             # Custom hooks
├── navigation/        # Configuración de navegación
│   ├── AppNavigator.tsx
│   ├── AuthNavigator.tsx
│   └── MainNavigator.tsx
├── screens/           # Pantallas de la app
│   ├── ar/            # Cuentas por cobrar
│   ├── auth/          # Login, OTP, Biométrico
│   ├── customers/     # Clientes
│   ├── inventory/     # Productos
│   ├── reports/       # Dashboard y reportes
│   ├── sales/         # POS, carrito, recibos
│   └── settings/      # Configuración
├── services/          # Servicios (sync, notifications, etc.)
│   ├── notifications/
│   └── sync/
├── store/             # Estado global (Zustand)
│   ├── authStore.ts
│   ├── cartStore.ts
│   └── syncStore.ts
├── types/             # TypeScript types
└── utils/             # Utilidades y helpers
```

## 🔧 Configuración

### Variables de Entorno

Crea un archivo `.env` en la raíz:

```env
# API URL del backend
API_URL=https://movopos.com

# Clerk Authentication
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx

# UploadThing
EXPO_PUBLIC_UPLOADTHING_APP_ID=xxx
```

### Base de Datos Local

La app usa SQLite para almacenamiento local con las siguientes tablas:
- `products` - Productos del inventario
- `customers` - Clientes
- `sales` - Ventas realizadas
- `payments` - Pagos recibidos
- `accounts_receivable` - Cuentas por cobrar
- `sync_queue` - Cola de sincronización

## 📲 Pantallas Principales

| Pantalla | Descripción |
|----------|-------------|
| **Login** | Ingreso con número de WhatsApp |
| **OTP** | Verificación de código |
| **Dashboard** | Resumen de ventas y métricas |
| **POS** | Punto de venta con búsqueda y escaneo |
| **Carrito** | Revisión y completar venta |
| **Inventario** | Lista y gestión de productos |
| **Clientes** | Lista y gestión de clientes |
| **Cuentas por Cobrar** | Facturas pendientes y pagos |
| **Configuración** | Impresora Bluetooth y preferencias |

## 🔄 Sincronización Offline

La app funciona completamente offline:

1. Los datos se guardan localmente en SQLite
2. Las operaciones se agregan a una cola de sincronización
3. Cuando hay internet, se sincronizan automáticamente
4. Conflictos se resuelven con "last-write-wins"

## 🖨️ Impresión Bluetooth

Soporta impresoras térmicas ESC/POS de 58mm y 80mm:

1. Ve a Configuración > Impresora
2. Busca dispositivos Bluetooth
3. Conecta tu impresora
4. Imprime recibos de venta y pagos

## 📦 Build de Producción

### Android APK (Testing)
```bash
eas build --platform android --profile preview
```

### Android AAB (Play Store)
```bash
eas build --platform android --profile production
```

### Subir a Play Store
```bash
eas submit --platform android
```

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# TypeScript check
npx tsc --noEmit
```

## 📚 Tecnologías

- **React Native** + **Expo** - Framework móvil
- **TypeScript** - Tipado estático
- **React Navigation** - Navegación (Drawer + Tabs + Stack)
- **Zustand** - Estado global
- **Expo SQLite** - Base de datos local
- **React Native Paper** - Componentes UI
- **Clerk** - Autenticación
- **Expo Camera** - Escaneo de códigos de barras

## 🔗 Relacionado

- [MOVOPos Web](../pos) - Aplicación web principal
- [Documentación API](https://movopos.com/api/docs)

## 📄 Licencia

Privado - MOVOPos © 2024
# posmobile
