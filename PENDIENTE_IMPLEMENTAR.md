# 📋 MOVOPos Mobile - Pendiente por Implementar

Este documento lista las funcionalidades y tareas pendientes del plan original que aún no han sido completamente implementadas.

---

## ✅ Lo que YA está implementado

### FASE 1: Setup Inicial
- [x] Proyecto Expo con TypeScript
- [x] Estructura de carpetas completa
- [x] Dependencias core instaladas
- [x] Variables de entorno (.env)
- [x] Navegación (Auth + Main con Drawer + Bottom Tabs)

### FASE 2-3: Base de Datos y Sincronización
- [x] SQLite configurado con todas las tablas
- [x] Sistema de cola de sincronización (estructura)
- [x] Service de sincronización básico

### FASE 4: Autenticación
- [x] Pantallas de Login, OTP, Biométrico (UI)
- [x] Store de autenticación

### FASE 5-6: Ventas/POS
- [x] Pantalla POS con búsqueda de productos
- [x] Carrito de compras
- [x] Pantalla de recibo
- [x] Escáner de código de barras

### FASE 7-9: Inventario, Clientes, AR, Reportes
- [x] Lista y agregar productos
- [x] Lista y agregar clientes
- [x] Lista de cuentas por cobrar
- [x] Registrar pagos
- [x] Dashboard con métricas

### FASE 10-11: Bluetooth y Notificaciones
- [x] Pantalla de configuración de impresora (UI)
- [x] Servicio de notificaciones (estructura)

---

## ❌ Lo que FALTA implementar

### 🔐 FASE 4: Autenticación - Integración Real

```typescript
// TODO en: src/screens/auth/LoginScreen.tsx
// Implementar envío real de OTP via Clerk/WhatsApp

// Pasos:
1. Integrar @clerk/clerk-expo completamente en App.tsx
2. Usar signIn.create() de Clerk para iniciar sesión con teléfono
3. Enviar código OTP real via WhatsApp usando la API existente
4. Verificar código con Clerk
5. Guardar sesión en SecureStore
```

**Archivos a modificar:**
- `App.tsx` - Envolver con ClerkProvider
- `src/screens/auth/LoginScreen.tsx` - Lógica real de envío OTP
- `src/screens/auth/OTPVerificationScreen.tsx` - Verificación real
- `src/screens/auth/BiometricSetupScreen.tsx` - Guardar preferencia en SecureStore

**Código pendiente para App.tsx:**
```typescript
import { ClerkProvider } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
};

// Envolver app con:
<ClerkProvider 
  publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY}
  tokenCache={tokenCache}
>
  {/* resto de la app */}
</ClerkProvider>
```

---

### 🔄 FASE 2-3: Sincronización - Integración con API Real

```typescript
// TODO en: src/services/sync/SyncService.ts

// Pendiente:
1. Obtener token de autenticación de Clerk
2. Configurar endpoints reales de la API web
3. Implementar descarga completa de datos al iniciar
4. Implementar resolución de conflictos (last-write-wins)
5. Implementar compresión de payloads grandes
6. Agregar reintentos con backoff exponencial
```

**Endpoints a integrar con la API web:**
```typescript
// Productos
GET  /api/products
POST /api/products
PUT  /api/products/:id

// Clientes
GET  /api/customers
POST /api/customers
PUT  /api/customers/:id

// Ventas
POST /api/sales

// Pagos
POST /api/payments

// Cuentas por Cobrar
GET  /api/accounts-receivable
```

---

### 🖨️ FASE 10: Impresión Bluetooth - Implementación Real

```bash
# Instalar dependencia de BLE
npm install react-native-ble-plx --legacy-peer-deps
```

**Archivos a crear/modificar:**

1. **src/services/bluetooth/BluetoothService.ts**
```typescript
// TODO: Implementar
- Escaneo de dispositivos BLE
- Conexión a impresora
- Mantener conexión persistente
- Reconexión automática
```

2. **src/services/bluetooth/PrinterService.ts**
```typescript
// TODO: Implementar
- Generar comandos ESC/POS
- Formatear recibos de venta
- Formatear recibos de pago
- Imprimir logo de empresa
- Manejar diferentes anchos de papel (58mm, 80mm)
```

**Ejemplo de comandos ESC/POS pendientes:**
```typescript
class PrinterService {
  generateReceipt(sale: Sale): string {
    let commands = '';
    commands += '\x1B\x40';           // Initialize
    commands += '\x1B\x61\x01';       // Center align
    commands += '\x1D\x21\x11';       // Double size
    commands += 'MOVOPos\n';
    commands += '\x1D\x21\x00';       // Normal size
    commands += '\n';
    commands += `Factura: ${sale.invoiceCode}\n`;
    commands += `Fecha: ${formatDate(sale.createdAt)}\n`;
    // ... resto del recibo
    commands += '\x1D\x56\x00';       // Cut paper
    return commands;
  }
}
```

---

### 📍 FASE 11: GPS y Geolocalización

```typescript
// TODO en: src/services/location/LocationService.ts

import * as Location from 'expo-location';

class LocationService {
  async getCurrentLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    
    const location = await Location.getCurrentPositionAsync({});
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  }
  
  // Registrar ubicación en cada venta
  async recordSaleLocation(saleId: string) {
    const location = await this.getCurrentLocation();
    if (location) {
      // Guardar en la venta
    }
  }
}
```

---

### 📊 FASE 9: Reportes Completos

**Pantallas pendientes de crear:**

1. **src/screens/reports/SalesReportScreen.tsx**
   - Filtro por rango de fechas
   - Gráfica de ventas por día/semana/mes
   - Exportar a CSV/PDF

2. **src/screens/reports/ARReportScreen.tsx**
   - Facturas pendientes
   - Facturas vencidas
   - Aging report (30/60/90 días)

3. **src/screens/reports/InventoryReportScreen.tsx**
   - Stock actual
   - Productos más vendidos
   - Productos sin movimiento

**Implementar exportación:**
```typescript
// src/utils/export.ts
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { printToFileAsync } from 'expo-print';

export async function exportToCSV(data: any[], filename: string) {
  const csv = convertToCSV(data);
  const fileUri = FileSystem.documentDirectory + filename;
  await FileSystem.writeAsStringAsync(fileUri, csv);
  await Sharing.shareAsync(fileUri);
}

export async function exportToPDF(html: string, filename: string) {
  const { uri } = await printToFileAsync({ html });
  await Sharing.shareAsync(uri);
}
```

---

### 🔔 FASE 11: Notificaciones Push - Backend

**Pendiente en el backend (web):**
```typescript
// Crear endpoint para registrar push tokens
POST /api/push-tokens
{
  "token": "ExponentPushToken[xxx]",
  "userId": "user_id",
  "platform": "android" | "ios"
}

// Crear servicio para enviar notificaciones
// Cuando hay facturas vencidas
// Cuando hay stock bajo
// Cuando se recibe un pago
```

**En la app móvil:**
```typescript
// TODO: Enviar token al servidor después de obtenerlo
const token = await Notifications.getExpoPushTokenAsync();
await api.post('/api/push-tokens', {
  token: token.data,
  userId: user.id,
  platform: Platform.OS,
});
```

---

### 🧪 FASE 12: Testing

**Configurar Jest:**
```bash
npm install --save-dev jest @testing-library/react-native @types/jest
```

**Tests pendientes de crear:**

1. **__tests__/database/Database.test.ts**
   - Test de creación de tablas
   - Test de CRUD básico
   - Test de queries

2. **__tests__/services/SyncService.test.ts**
   - Test de cola de sincronización
   - Test de manejo de errores
   - Test de reintentos

3. **__tests__/store/cartStore.test.ts**
   - Test de agregar/quitar items
   - Test de cálculos de total

4. **__tests__/screens/** (E2E con Detox)
   - Flujo completo de venta
   - Flujo de registro de pago
   - Flujo de agregar producto

---

### 📱 FASE 13: Build y Deployment Android

**Pasos pendientes:**

1. **Crear cuenta de desarrollador en Google Play Console** ($25 USD una vez)

2. **Generar keystore para firmar la app:**
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore movopos.keystore -alias movopos -keyalg RSA -keysize 2048 -validity 10000
```

3. **Configurar credenciales en EAS:**
```bash
eas credentials
```

4. **Actualizar app.json con información completa:**
```json
{
  "expo": {
    "version": "1.0.0",
    "android": {
      "versionCode": 1
    }
  }
}
```

5. **Crear assets de la tienda:**
   - Icono 512x512 (sin transparencia)
   - Feature graphic 1024x500
   - Screenshots (mínimo 2, máximo 8)
   - Descripción corta (80 caracteres)
   - Descripción larga (4000 caracteres)

6. **Build de producción:**
```bash
eas build --platform android --profile production
```

7. **Subir a Play Console:**
```bash
eas submit --platform android
```

---

### 🍎 FASE 14-15: iOS (Futuro)

**Pendiente:**
1. Cuenta de desarrollador Apple ($99 USD/año)
2. Certificados y provisioning profiles
3. Ajustes específicos de iOS en código
4. TestFlight para beta testing
5. Revisión de App Store

---

## 📁 Archivos Pendientes de Crear

```
src/
├── services/
│   ├── bluetooth/
│   │   ├── BluetoothService.ts      ❌
│   │   └── PrinterService.ts        ❌
│   ├── location/
│   │   └── LocationService.ts       ❌
│   └── api/
│       └── ApiService.ts            ❌ (cliente HTTP configurado)
├── screens/
│   ├── reports/
│   │   ├── SalesReportScreen.tsx    ❌
│   │   ├── ARReportScreen.tsx       ❌
│   │   └── InventoryReportScreen.tsx ❌
│   ├── inventory/
│   │   └── ProductDetailScreen.tsx  ❌
│   ├── customers/
│   │   └── CustomerDetailScreen.tsx ❌
│   └── ar/
│       └── ARDetailScreen.tsx       ❌
├── components/
│   ├── common/
│   │   ├── LoadingScreen.tsx        ❌
│   │   ├── ErrorBoundary.tsx        ❌
│   │   └── OfflineIndicator.tsx     ❌
│   └── charts/
│       └── SalesChart.tsx           ❌
└── utils/
    └── export.ts                    ❌
```

---

## ⏱️ Estimación de Tiempo Restante

| Tarea | Tiempo Estimado |
|-------|-----------------|
| Integración Clerk completa | 2-3 días |
| Sincronización con API real | 3-4 días |
| Impresión Bluetooth real | 3-4 días |
| Reportes completos | 2-3 días |
| Geolocalización | 1 día |
| Testing | 3-4 días |
| Build Android + Play Store | 2-3 días |
| **TOTAL** | **16-22 días** |

---

## 🚀 Próximos Pasos Recomendados

1. **Primero**: Integrar Clerk completamente para tener autenticación real
2. **Segundo**: Conectar sincronización con la API web existente
3. **Tercero**: Implementar impresión Bluetooth
4. **Cuarto**: Completar pantallas de reportes
5. **Quinto**: Testing básico
6. **Sexto**: Build y deployment a Google Play

---

## 📝 Notas

- La estructura base está completa y funcional
- TypeScript compila sin errores
- La navegación está configurada correctamente
- Solo falta conectar con servicios reales (API, Clerk, Bluetooth)
- El código está preparado para expansión fácil
