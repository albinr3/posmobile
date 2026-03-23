# Revisión de `analysis_results.md` (validada contra código real)

Fecha de revisión: 23 de marzo de 2026

## Resumen ejecutivo

- El análisis original tiene varios hallazgos correctos y útiles.
- Los riesgos más importantes hoy son de **descarga incompleta** por límites/paginación en sync.
- El bug de duplicados por reentrada de `processQueue()` (incidencia previa) **ya está mitigado** en el estado actual.

## Clasificación punto por punto

### Correctos (alta prioridad)

- `#2` `downloadFromServer` sin paginación general: **Correcto**.
  - El móvil no pagina productos/ventas/cotizaciones y el backend sí tiene límites en varias rutas.
- `#3` pagos con `take: 500` hardcodeado: **Correcto**.
  - Si existen más de 500 pagos, no entran al móvil.
- `#4` no hay reconciliación general de borrados/inactivos: **Correcto**.
  - Se hace upsert, pero no limpieza global de entidades eliminadas en servidor.
- `#19` error por entidad aborta toda la descarga: **Correcto**.
  - Un fallo puntual puede cortar todo el ciclo de descarga.

### Parciales o de deuda técnica relevante

- `#8` retry/limpieza de `sync_queue`: **Parcial**.
  - Sí existe límite de retry general.
  - Pero para devoluciones en `error` se resetea a `pending` con `retry_count = 0` en cada ciclo.
  - No hay purga periódica de filas `synced`.
- `#10` `loadProducts()` en cada focus: **Correcto** como degradación de UX/performance.
- `#18` hard reset one-shot puede repetirse si falla el guardado del flag: **Correcto** (edge case real).
- `#6` expiración de JWT subusuario sin refresh: **Parcial**.
  - No hay refresh automático.
  - Sí hay manejo de bloqueo/errores de auth; no es completamente silencioso.
- `#9` reset de `syncing -> pending`: **Parcial**.
  - Es un mecanismo de recuperación válido, pero con riesgo residual en cierres abruptos.

- `#7` doble definición de `clear()` en cart store: **Correcto** como deuda de mantenibilidad.
- `#16` reportes offline potencialmente incompletos: **Correcto** en consecuencia de `#2/#3`.

- `#11` filtro excluye productos no sincronizados: **Más decisión de negocio que bug**.
  - Vender un producto sin `serverId` rompe flujos de sync de ventas/devoluciones.
- `#12` long press elimina por `productId`: **Comportamiento discutible**, pero coherente con la UI actual (cantidad agregada por producto).
- `#15` falta de `ErrorBoundary` por pantalla: **Deuda técnica**, no bug crítico inmediato.



