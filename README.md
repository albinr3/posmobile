# MOVOPos Mobile

App móvil de punto de venta (POS) construida con React Native + Expo, con arquitectura offline-first y sincronización con backend MOVOPos.

## Estado actual

- Proyecto activo en Expo SDK 55 (preview).
- Autenticación principal con Clerk (correo/código y Google OAuth).
- Flujo de subusuarios obligatorio para operar la app.
- Datos locales en SQLite por cuenta (`account scope`) + cola de sincronización.

## Módulos implementados

- Ventas POS (`sales`)
- Cotizaciones (`sales/Quote*`)
- Facturas (`billing`)
- Devoluciones (`returns`)
- Cuentas por cobrar y cobros (`ar`)
- Recibos de pago (`ar/PaymentReceiptsScreen`)
- Inventario, categorías, proveedores y compras (`inventory`, `categories`, `suppliers`, `purchases`)
- Clientes (`customers`)
- Gastos operativos (`operating-expenses`)
- Dashboard, cuadre diario y reportes (`reports`)
- Ajustes (impresora + reset local) (`settings`)

## Requisitos

- Node.js 20+ recomendado
- npm
- Android Studio (emulador) o dispositivo físico con Expo Go / dev build
- EAS CLI (solo para builds remotos)

## Instalación

```bash
npm install
```

## Variables de entorno

Crear `.env` en la raíz:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
EXPO_PUBLIC_API_URL=https://movopos.com
```

Notas:
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` es obligatoria (si falta, la app no inicia).
- `EXPO_PUBLIC_API_URL` es recomendada; si no existe, se usa fallback `https://movopos.com`.
- `API_URL` también es aceptada como fallback por compatibilidad.

## Scripts

```bash
npm run start
npm run start:clear
npm run android
npm run ios
npm run web
```

## Estructura (resumen)

```text
src/
  components/
  database/               # SQLite + migraciones simples
  hooks/
  navigation/             # AuthNavigator, AppNavigator, MainNavigator
  screens/
    ar/ auth/ billing/ categories/ customers/
    inventory/ operating-expenses/ purchases/
    reports/ returns/ sales/ settings/ suppliers/
  services/
    sync/                 # SyncService + módulos (download, payloads, shared)
  store/                  # Zustand (auth/cart/quoteCart/sync)
  theme/
  types/
  utils/
```

## Base local (SQLite)

Tablas principales:
- `sync_queue`
- `sync_metadata`
- `sales`
- `quotes`
- `products`
- `customers`
- `suppliers`
- `categories`
- `payments`
- `operating_expenses`
- `accounts_receivable`
- `purchases`
- `returns`
- `return_items`

## Sincronización offline

- Operaciones locales se encolan en `sync_queue`.
- `SyncService` procesa la cola cuando hay conexión.
- También ejecuta descargas completas periódicas y bajo demanda.
- Requiere token de Clerk + token de subusuario.
- Endpoints principales: `sales`, `quotes`, `products`, `customers`, `suppliers`, `categories`, `returns`, `payments`, `purchases`, `operating-expenses`, `accounts-receivable`.
- En descargas se aplican `timeouts` por petición y se evita pedir detalle por cada venta/cotización cuando ya hay datos locales suficientes.

## Configuración técnica relevante

- Se removió `expo-location` de dependencias y permisos nativos.
- Android mantiene permisos Bluetooth para impresoras (`BLUETOOTH_*`) sin permisos de ubicación.
- `tsconfig.json` usa alias `@/* -> src/*`.
- La app envuelve navegación con `ErrorBoundary` para fallback visual ante errores de render.

## Navegación

- `AuthNavigator`: `Login` -> `EmailVerification`/OAuth -> `BiometricSetup` -> `SelectUser` -> `SubUserLogin`.
- `MainNavigator`: Drawer + Bottom Tabs (Inicio, Ventas, Cobros) + stacks por módulo.

## Build con EAS

Perfiles en `eas.json`:
- `development`: dev client
- `preview`: APK Android / simulador iOS
- `production`: AAB Android / release iOS

Comandos:

```bash
eas build --platform android --profile preview
eas build --platform android --profile production
eas submit --platform android
```

## Pendientes técnicos relevantes

- Impresión Bluetooth en `PrinterSettingsScreen` está en modo simulado (scan/conexión/print real aún pendiente).
- Persistencia de preferencia biométrica tiene `TODO`.
- `OTPVerificationScreen` existe pero el flujo principal actual usa verificación por correo.

## Pruebas recomendadas (post-cambios)

1. Autenticación subusuario:
   - Login normal (token válido) y restauración de sesión al reabrir app.
   - Token de subusuario expirado/inválido en `SecureStore`: debe limpiar sesión local y pedir reselección de usuario.
2. Sincronización:
   - `fullSync` con internet y con cola pendiente.
   - Descarga con API lenta/no disponible: verificar timeouts y que no quede bloqueada indefinidamente.
   - Verificar que ventas/cotizaciones cargan ítems correctamente en `ReceiptScreen`, `CreateReturnScreen`, `QuoteScreen`.
3. AR y recibos:
   - Pull-to-refresh en `ARListScreen` y `PaymentReceiptsScreen` con y sin internet.
   - Cancelación de recibo y posterior re-sync.
4. Carritos (`cartStore` / `quoteCartStore`):
   - `addItem`, `updateQuantity`, `removeItem`, `clear`, edición de factura/cotización.
   - Confirmar totales y conteo tras cambios de cantidad.
5. ErrorBoundary:
   - Forzar un error de render en una pantalla y validar que aparece fallback y botón `Reintentar`.
6. Ajustes de impresora:
   - Escaneo de impresoras en Android y solicitud de permisos Bluetooth sin pedir ubicación.

## Referencia backend local

Si necesitas validar contratos/endpoints del backend:

- `C:\Users\Albin Rodriguez\Documents\pos\src\app\api`
- fallback: `C:\Users\Albin Rodríguez\Videos\Nueva carpeta\tejada-pos\src\app\api`

## Licencia

Privado - MOVOPos
