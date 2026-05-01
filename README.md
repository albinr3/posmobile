# MOVOPos Mobile

App móvil de punto de venta (POS) construida con React Native + Expo, con arquitectura offline-first y sincronización con backend MOVOPos.

## Estado actual

- Proyecto activo en Expo SDK 55 (preview).
- Autenticación principal con Clerk (correo/código y Google OAuth).
- Flujo de subusuarios obligatorio para operar la app.
- Datos locales en SQLite por cuenta (`account scope`) + cola de sincronización.

## Billing y avisos (marzo 2026)

- Banner superior con paridad visual web/móvil para facturación:
  - Trial: mensajes de días de prueba restantes.
  - `ACTIVE` + proveedor `MANUAL` (transferencia): aviso en 2, 1 y 0 días.
- Texto de aviso en activo manual:
  - `Recuerda: el pago de tu suscripción vence hoy.`
  - `Recuerda: el pago de tu suscripción vence mañana.`
  - `Recuerda: el pago de tu suscripción vence en X días.`
- Para `LEMON` (tarjeta), no se muestra aviso previo de vencimiento en banner; la notificación principal llega por correo al confirmarse el cargo mensual desde backend.

## Cambio fiscal ITBIS (marzo 2026)

- Se soporta la preferencia por cuenta `salePricesIncludeItbis` sincronizada con backend.
- Modo incluido (`true`): el precio de venta ya contiene ITBIS.
- Modo no incluido (`false`): el precio es base y el total se calcula sumando ITBIS.
- La app móvil conserva historial por documento usando snapshot de modo en ventas/cotizaciones/devoluciones.
- Los ítems usan snapshot `itbisRateBp` para mantener consistencia en cálculo, devoluciones y reportes.
- Se ajustaron desglose y etiquetas en carrito, recibos/PDF e impresión según el modo del documento.
- Offline/sync: las ventas pendientes guardan `salePricesIncludeItbis` y lo envían al sincronizar para no cambiar cálculos por toggles posteriores.
- Compras: el precio de venta sugerido/guardado respeta el modo activo de la cuenta (incluido o no incluido).

## Normalización de Cliente general (abril 2026)

- Se centralizó en utilidades la regla de cliente genérico para mostrar siempre `Cliente general` (sin variantes como `(General)`, `(Genérico)` o fallback `Cliente` cuando aplica genérico).
- Se agregó resolución robusta del cliente general en SQLite (prioriza el cliente real con visualId `1` cuando existe).
- Al confirmar ventas y cotizaciones sin cliente explícito, la app móvil ahora asigna el cliente general real y evita crear nuevos documentos con cliente vacío.
- Ventas a crédito: se bloquea el uso de cliente general y se exige un cliente específico.
- Devoluciones: al buscar con cliente general, se mantiene compatibilidad con ventas históricas legacy que no tenían `customer_id`.
- Recibos/listados/sync: se normalizaron fallbacks de nombre para mantener consistencia con la web en impresión y pantallas de facturas/cobros/devoluciones.
- Alcance técnico: cambio solo en `src/` (compatible con OTA, sin requerir build nativo nuevo).

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
- Ajustes (incluye preferencia fiscal de ITBIS, impresora + reset local) (settings)

## Requisitos

- Node.js 20+ recomendado
- npm
- Android Studio (emulador) o dispositivo físico con Expo Go / dev build
- EAS CLI (solo para builds remotos)

## Android local estable (guia anti-errores)

### 1) Versiones que deben quedar fijas

- Java: JDK 17 (`java -version` debe mostrar 17.x).
- Gradle Wrapper: `8.13`.
- NDK Android: `27.1.12297006`.
- CMake: `3.22.1`.

### 2) Variables y archivos clave

- `JAVA_HOME` debe apuntar al JDK 17 (ejemplo: `C:\Program Files\Java\jdk-17`).
- `node` y `npx` deben existir en `PATH`.
- En `android/local.properties` dejar `sdk.dir=...`.
- No usar `ndk.dir` ni `cmake.dir` en `local.properties` (evita conflictos de versionado).

### 3) Comandos recomendados para build limpio

Ejecutar en **PowerShell** (no en cmd) porque usa `Remove-Item`:

```powershell
cd "C:\Users\Albin Rodriguez\Documents\movopos-mobile"
Remove-Item -Recurse -Force .\android\app\.cxx, .\android\.cxx -ErrorAction SilentlyContinue
cd .\android
.\gradlew --stop
.\gradlew app:assembleDebug -x lint -x test --stacktrace --info --no-build-cache > "..\build-error.txt" 2>&1
```

### 4) Si vuelve a fallar

- Regenerar siempre `build-error.txt` con el comando anterior.
- Revisar primero el bloque `What went wrong` y `Execution failed for task`.
- Si el error es de linker C++ (`undefined symbol: __cxa_*`, `std::*`), validar que `patch-package` aplico parches en `node_modules`.

### 5) Parches nativos que no deben perderse

El proyecto usa `patch-package` (`postinstall`) para fixes de CMake en librerias nativas. Los parches viven en `patches/`.
Si se borra `node_modules`, volver a ejecutar `npm install` para reaplicar.

### 6) Errores comunes y causa real

- `npx: ... no se reconoce`: Node/NPM no esta en `PATH`.
- `JAVA_HOME is not set`: variable de entorno faltante o terminal no reiniciada.
- `A problem occurred starting process 'command 'node''`: Gradle no encuentra Node en `PATH`.
- `SDK location not found`: falta `sdk.dir` en `android/local.properties`.
- `NDK ... disagrees with android.ndkVersion`: version de NDK distinta entre config y SDK instalado.
- `undefined symbol ...` en tareas `buildCMakeDebug`: problema de link STL C++ en modulos nativos.

### 7) OTA vs build nativo

- Cambios en `src/` (JS/TS) suelen ser compatibles con OTA.
- Cambios en `android/`, permisos, plugins de Expo o librerias nativas requieren nuevo build nativo.

## Bitacora de errores resueltos (Windows/Expo SDK 55)

Esta seccion resume los incidentes reales ya resueltos en este proyecto, con causa y solucion aplicada.

1) `npx: The term 'npx' is not recognized`
- Causa: Node/npm no estaba en `PATH` de la sesion.
- Solucion: reinstalar/reparar Node y abrir una terminal nueva; validar con `node -v`, `npm -v`, `npx --version`.

2) `JAVA_HOME is not set and no 'java' command could be found`
- Causa: JDK instalado pero variables no configuradas.
- Solucion: apuntar `JAVA_HOME` a JDK 17 y agregar `%JAVA_HOME%\bin` al `PATH`.

3) Gradle con JDK 21 y errores raros de compatibilidad (`JvmVendorSpec ... IBM_SEMERU`)
- Causa: combinacion de versiones no estable para este stack.
- Solucion: estandarizar en JDK 17 para builds Android locales.

4) `Minimum supported Gradle version is 8.13. Current version is 8.10.2`
- Causa: wrapper viejo frente a AGP/Expo SDK 55.
- Solucion: actualizar `android/gradle/wrapper/gradle-wrapper.properties` a Gradle 8.13.

5) `A problem occurred starting process 'command 'node''`
- Causa: Gradle no encontraba `node` en su entorno.
- Solucion: asegurar Node en `PATH` global y abrir terminal nueva antes de correr `gradlew`.

6) `SDK location not found`
- Causa: Android SDK no definido para Gradle.
- Solucion: definir `sdk.dir=...` en `android/local.properties` (ruta valida al SDK).

7) Error de PowerShell al hacer `cd` con espacios (`A positional parameter cannot be found`)
- Causa: ruta sin comillas.
- Solucion: usar comillas: `cd "C:\Users\Albin Rodriguez\Documents\movopos-mobile\android"`.

8) Error al borrar carpetas con comando estilo cmd (`rmdir /s /q`) ejecutado en PowerShell
- Causa: mezcla de sintaxis shell.
- Solucion: en PowerShell usar `Remove-Item -Recurse -Force ...`.

9) Conflicto de NDK (`[CXX1104] ndk.dir ... disagrees with android.ndkVersion`)
- Causa: coexistian versiones distintas (27.0 vs 27.1) entre configuracion y SDK.
- Solucion: unificar en `27.1.12297006` y eliminar `ndk.dir` de `local.properties`.

10) Warning repetido `[CXX5106] NDK was located by using ndk.dir property`
- Causa: uso de `ndk.dir` (metodo deprecado).
- Solucion: quitar `ndk.dir` y manejar version via `android.ndkVersion`/`ext.ndkVersion`.

11) Linker C++ en modulos nativos (`undefined symbol: std::..., __cxa_*`)
- Causa: targets CMake de varios modulos sin link explicito a STL compartida.
- Solucion: agregar `c++_shared` en `target_link_libraries(...)` y persistir con `patch-package`.

12) Fallos sucesivos por modulo (worklets, screens, expo-updates, expo-modules-core, reanimated, gesture-handler, safe-area-context, svg)
- Causa: mismo patron de link C++ en distintos CMake.
- Solucion: parches dedicados en `patches/` para cada paquete afectado.

13) `patch-package` fallando por falta de `git` (`spawnSync git ENOENT`)
- Causa: Git no instalado/no disponible en PATH.
- Solucion: instalar Git o crear patch manual; en este repo quedaron parches persistidos en `patches/`.

14) No aparecia permiso Bluetooth en Expo Go (Android 13+)
- Causa: flujo dependiente de permisos runtime + limitaciones del contenedor Expo Go para librerias nativas BT.
- Solucion: usar dev build nativo para probar Bluetooth real y asegurar solicitud de permisos Android 13+ en la app.

15) Build fallaba sin detalle util al correr `expo run:android`
- Causa: salida resumida de Expo ocultaba causa raiz.
- Solucion: compilar con `gradlew ... --stacktrace --info` y redirigir a `build-error.txt`.

16) `expoDebugOverrideMaxSdkConflicts` confundia como posible error
- Causa: mensaje informativo del plugin, no falla.
- Solucion: ignorar ese bloque y buscar la primera tarea `FAILED` real.

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

### Guardrails EAS (evitar reincidencias)

1. No subir artefactos locales Android al worker:
   - Mantener excluidos `android/build/` y `android/local.properties` (ver `.easignore`).
2. Si aparece `No matching variant ... No variants exist` en muchas librerias a la vez:
   - Relanzar con cache limpio: `eas build --platform android --profile preview --clear-cache`.
3. Antes de subir cambios de parches nativos, validar localmente:
   - `npx patch-package --reverse --error-on-fail`
   - `npx patch-package --error-on-fail`
4. Si falla `mergeDebugNativeLibs` en `react-native-worklets`:
   - Verificar que el patch de `expo-modules-core` siga aplicando (usa fallback a `merge*JniLibFolders`).
5. Cualquier cambio en `patches/`, `android/`, `app.json` o plugins Expo requiere build nativo nuevo (no OTA).

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



