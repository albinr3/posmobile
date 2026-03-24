## Plan Integral de Corrección de `ANALYSIS_REVISION` (Móvil + Backend, sin regresiones)

Vamos a devidirlo por fases:
Plan En Fases Cortas (Seguro y Progresivo)
Resumen
Implementar en 7 fases pequeñas, cada fase cerrada con pruebas de salida antes de pasar a la siguiente.

Fases
Fase	Duración	Entregable	Criterio de salida
0. Línea base ✅ LISTA	0.5 día	Snapshot de estado actual, métricas de sync, dataset grande de prueba	Se puede medir “antes/después” sin ambigüedad
1. Backend paginación ✅ LISTA	1 día	sales/quotes/purchases/payments/returns/operating-expenses/customers/categories/suppliers con paginación opcional y respuesta compatible	Cliente viejo sigue funcionando y cliente nuevo puede paginar todo
2. Descarga móvil robusta	1 día	downloadFromServer paginado + manejo de error por entidad (no abortar sync completo)	Si falla 1 entidad, el resto termina y queda registro de fallo
3. Reconciliación de inactivos	1 día	Marcar localmente como inactivos registros que ya no vienen del servidor (sin borrar histórico)	Productos/clientes/categorías/proveedores “fantasma” dejan de aparecer
4. Cola de sync endurecida	1 día	Quitar reset incondicional de errores, retry con backoff, recuperación solo de syncing stale, limpieza de synced antiguos	No hay loops infinitos ni reenvíos duplicados por recuperación agresiva
5. POS y carrito	1 día	Política acordada: permitir venta offline de producto no sincronizado; long press elimina solo una línea (no todas las variantes); menos recargas por focus	Venta offline fluye y long press no borra variantes por accidente
6. Auth + hardening final	1 día	Refresh automático de subusuario + guardas de hard reset one-shot + boundaries por pantalla	Expiración de token no rompe en silencio y fallos de pantalla no tumban toda la app
Pruebas mínimas por fase
Dataset grande: confirmar que no hay truncado.
Falla parcial de API: sync continúa en otras entidades.
Desactivación en backend: ocultación local correcta.
Reintentos y cierres abruptos: cola estable sin duplicados.
POS offline con productos sin serverId: venta y posterior sync correctos.
JWT expirado: refresh o bloqueo explícito con recuperación guiada.
Supuestos
Alcance confirmado: móvil + backend.
Política confirmada: permitir venta offline de no sincronizados.
Política confirmada: long press elimina solo la línea.
Orden de despliegue: backend primero, luego móvil.
OTA y builds nativos
Fases móviles propuestas son cambios JS/TS en src/: compatibles con OTA.
Fases backend son despliegue de servidor.
No hay cambios que requieran build nativo nuevo.

### Resumen
- Implementar en 2 despliegues: **1) backend compatible hacia atrás**, **2) móvil (OTA)**.
- Priorizar primero integridad de datos y sync (`#2 #3 #4 #8 #9 #16 #19`), luego UX/hardening (`#6 #7 #10 #12 #15 #18`).
- Aplicar cambios sin romper contratos actuales: nuevos parámetros/campos serán opcionales.

### Cambios Clave de Implementación
1. Backend (ruta local `tejada-pos`) para completar descargas sin truncado:
- Agregar paginación real en endpoints consumidos por móvil:
- `GET /api/customers`, `GET /api/categories`, `GET /api/suppliers`: `cursor` + `take`, retorno con `nextCursor`.
- `GET /api/sales`, `GET /api/quotes`, `GET /api/purchases`, `GET /api/payments`, `GET /api/operating-expenses`, `GET /api/returns`: `skip` + `take`, retorno con `nextSkip`.
- Mantener defaults actuales cuando no lleguen params (compatibilidad con clientes existentes).
- Agregar `POST /api/auth/subuser/refresh` (requiere Clerk + `X-SubUser-Token`) para renovar JWT de subusuario sin pedir contraseña otra vez.

2. Móvil: robustecer `downloadFromServer` y reconciliación de datos:
- Refactorizar descarga por “tareas por entidad” con manejo de error individual (si falla una entidad, continúan las demás), con lista de fallos acumulada.
- Implementar paginación por entidad según contrato backend nuevo.
- Reconciliar eliminados/inactivos para maestros (`products/customers/categories/suppliers`):
- Registrar IDs recibidos por sync.
- Marcar localmente como inactivos (`is_available_for_sale = 0`) registros `server_id` que ya no existen en servidor.
- No borrar físicamente para no romper histórico local.
- Guardar salud de sync en `sync_metadata` (`last_download_status`, `failed_entities`, `last_successful_download_at`) y usarla para advertir reportes potencialmente incompletos (`#16`).

3. Móvil: hardening de cola de sync (`#8 #9`):
- Extender `sync_queue` con `sync_started_at`, `next_attempt_at`, `last_error_code` (migración segura).
- Al iniciar envío: `status='syncing'` + `sync_started_at=now`.
- Recuperación de “syncing huérfano” solo si está vencido (stale), no reset masivo en caliente.
- Quitar reset incondicional de devoluciones en `error` a `pending`.
- Reintentos con límite y backoff; purga periódica de `synced` antiguos.

4. Móvil: POS/carrito y UX:
- Política elegida: **permitir venta offline de productos no sincronizados** (`#11`):
- Mostrar productos activos aunque no tengan `serverId`.
- En checkout, permitir encolado; la sync resolverá dependencia cuando el `product create` obtenga `server_id`.
- Priorizar en cola `product:create` antes de `sale:create/quote:create` para reducir bloqueos por dependencia.
- Política elegida para `#12`: long press en POS elimina solo **una línea** (por `lineId` base), no todas las variantes del producto.
- Optimizar `POSScreen` (`#10`) para no recargar catálogo completo en cada focus: recarga por versión/dirty-flag de catálogo.
- Corregir deuda `clear()` duplicado (`#7`) con un único `clear` compuesto (base + extra).
- Fortalecer hard reset one-shot (`#18`) con estado de ejecución (`started/done`) para impedir repetición destructiva.
- Agregar boundary por pantalla vía wrapper reutilizable en navegación (`#15`).

5. Sesión de subusuario (`#6`):
- Antes de sync, si JWT está próximo a expirar, intentar refresh automático.
- Si refresh falla, bloquear sync con motivo explícito y redirigir a reautenticación de subusuario (sin fallo silencioso).

### Cambios de API/Interfaces Públicas
- Nuevos query params opcionales en endpoints de listado: `cursor/take` o `skip/take`.
- Nuevos campos opcionales de respuesta: `nextCursor` o `nextSkip`.
- Nuevo endpoint: `POST /api/auth/subuser/refresh`.
- Nuevas claves en `sync_metadata`: estado y calidad de descarga.
- Nuevas columnas en `sync_queue`: `sync_started_at`, `next_attempt_at`, `last_error_code`.

### Plan de Pruebas y Criterios de Aceptación
1. Datos grandes:
- Productos > 1,000; ventas/cotizaciones > 300; pagos > 500; confirmar que móvil trae todas las páginas.
2. Resiliencia por entidad:
- Forzar 500 en una entidad (ej. categories) y validar que las demás sincronizan y queda warning registrado.
3. Reconciliación:
- Desactivar en backend un producto/cliente/proveedor/categoría y validar ocultación local sin perder histórico.
4. Cola:
- Simular errores repetidos y validar límite de reintento/backoff + purga de `synced`.
- Simular cierre abrupto y validar recuperación solo de `syncing` stale.
5. POS/carrito:
- Vender producto local sin `serverId`, sincronizar luego y verificar venta en backend.
- Long press en producto con variantes: eliminar solo línea objetivo.
6. Auth:
- Token de subusuario cercano a expiración: refresh exitoso.
- Refresh fallido: bloqueo claro + re-login requerido.
7. Hard reset:
- Fallo al marcar flag final: no repetir wipe destructivo en siguiente inicio.
8. ErrorBoundary:
- Error de render en una pantalla no tumba toda la app.

### Supuestos y Defaults
- Alcance confirmado: **Móvil + Backend**.
- Política confirmada: **permitir venta offline de productos no sincronizados**.
- Política confirmada: **long press elimina solo una línea**.
- Orden de despliegue: backend primero, móvil después.
- OTA: los cambios móviles propuestos son en JS/TS dentro de `src/` y **sí son compatibles con OTA**.
- No hay cambios nativos (`android/`, `ios/`, plugins Expo, libs nativas), por lo que **no se requiere build nativo nuevo** para estos cambios.
