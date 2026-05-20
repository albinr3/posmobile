# Plan de Implementación: Tesorería Web Parity en App Móvil (Offline + Sync)

## Resumen
- Objetivo: replicar en móvil la Tesorería actual de web con paridad funcional completa, incluyendo cuentas, movimientos, transferencias internas con reverso, permisos y reglas por método de pago.
- Enfoque elegido: `SQLite local + sincronización` (misma filosofía actual móvil), manteniendo operación offline.
- Resultado esperado: mismas reglas de negocio que web, adaptadas a UI móvil (listas/cards), sin perder trazabilidad operativa ni consistencia de saldos.

## Cambios de Implementación
- **Modelo local y migraciones (SQLite):**
  - Crear tablas `treasury_accounts`, `treasury_opening_balances`, `treasury_transfers`.
  - `treasury_transfers` incluirá: `id`, `accountId`, `fromTreasuryAccountId`, `toTreasuryAccountId`, `amountCents`, `transferredAt`, `note`, `createdByUserId`, `status`, `reversesTransferId`, `createdAt` y campos de auditoría de reverso (`reversedByUserId`, `reversedAt`, `reverseReason`).
  - Restricciones: `from != to`, `amountCents > 0`, `reversesTransferId` único (un solo reverso por transferencia original).
- **Cuenta por defecto y reglas de saldo inicial:**
  - Garantizar existencia de `Caja Efectivo` (tipo caja) por defecto en `0`.
  - Saldo inicial manual: habilitado solo para `Caja Efectivo`; para bancos no se captura saldo inicial manual.
- **Pantalla Tesorería móvil:**
  - Nueva entrada en navegación y pantalla `Tesorería`.
  - Secciones: resumen por cuenta, movimientos del período, formulario de transferencia interna, gestión de cuentas.
  - En movimientos: mostrar `Estado` y `Acciones`; no mostrar trazabilidad textual (equivalente a ocultar columna Trazabilidad en web).
- **Transferencias y reversos (inmutable):**
  - Crear transferencia con origen/destino/monto/fecha/nota.
  - Pre-cálculo de saldo proyectado del origen; si queda negativo, mostrar confirmación y permitir continuar.
  - Reverso: no editar/eliminar; crear transferencia inversa enlazada y marcar original como `REVERSED` con auditoría obligatoria.
- **Integración en formularios existentes (ventas/cobros/compras/gastos/devoluciones):**
  - Si método `EFECTIVO`: solo permitir `Caja Efectivo`.
  - Si método `TRANSFERENCIA`: solo permitir cuentas tipo banco.
  - En el selector, agregar opción final `+ Crear nueva cuenta`; navega a Tesorería y abre modal de alta automáticamente.
  - Al volver, preseleccionar la cuenta recién creada cuando aplique.
- **Permisos en móvil:**
  - Respetar permisos de tesorería del backend y aplicar fallback:
    - `owner`: permisos de tesorería activos por defecto.
    - otros usuarios: permisos desactivados por defecto.
  - Ocultar/bloquear acciones según permiso (`ver`, `gestionar cuentas`, `transferir`, `reversar`).
- **Sync subida/bajada:**
  - Extender payloads de entidades operativas para incluir `treasuryAccountId` donde aplique.
  - Sincronizar `treasury_accounts`, `treasury_opening_balances`, `treasury_transfers` con endpoints de web.
  - Orden de sync: cuentas/saldos -> movimientos operativos -> transferencias/reversos.
  - Idempotencia por `id` y resolución server-first para estados de reverso.

## APIs / Interfaces / Tipos
- **Tipos nuevos en móvil:**
  - `TreasuryAccount`, `TreasuryOpeningBalance`, `TreasuryTransfer`, `TreasuryMovement`.
- **Tipos existentes a extender (compatibles hacia atrás):**
  - `SalePaymentSplit`, `Payment`, `Purchase`, `OperatingExpense`, `Return` con `treasuryAccountId?: string`.
- **Contratos de sync:**
  - Añadir soporte a recursos/acciones de tesorería y nuevos campos `treasuryAccountId` en payloads ya existentes.
  - Mantener compatibilidad con registros históricos sin `treasuryAccountId` (backfill local).

## Pruebas y Escenarios
- **Migración y backfill:**
  - App con data previa: crear `Caja Efectivo` automáticamente y mapear históricos `EFECTIVO` a esa cuenta.
  - Históricos `TRANSFERENCIA`: mapear a banco por nombre; si falta banco, crear uno de fallback para no perder balance.
- **UI operativa:**
  - Ventas/cobros/gastos/devoluciones: validar filtro de cuentas por método de pago.
  - Opción `+ Crear nueva cuenta`: abre Tesorería con modal activo y retorno correcto al flujo origen.
- **Transferencias:**
  - Transferencia válida impacta saldo (débito/crédito).
  - Transferencia que deja negativo muestra alerta y permite confirmar.
  - Reverso crea movimiento inverso, bloquea doble reverso y actualiza estado.
- **Movimientos del período:**
  - Lista mixta (ventas/cobros/gastos/devoluciones/transferencias) con estado y acciones correctas.
  - Sin movimientos: render vacío alineado correctamente.
- **Permisos:**
  - Owner ve y opera todo por defecto.
  - Usuario no-owner inicia sin permisos de tesorería y no puede ejecutar acciones restringidas.
- **Sync extremo:**
  - Offline create/update -> sync posterior sin duplicados.
  - Reverso hecho offline y luego sincronizado mantiene consistencia de estado.

## Supuestos y Defaults
- Se reutilizan los mismos endpoints/reglas de negocio de la versión web para garantizar paridad.
- `TARJETA`/`CHEQUE` no se fuerzan a cuenta de tesorería en esta fase, salvo que web actualmente lo haga de forma explícita.
- Si una transferencia histórica no tiene contrapartida clara en datos legados, se preserva integridad contable con cuenta fallback controlada.
- La implementación móvil respetará nombres finales definidos: `Caja Efectivo` y lista de bancos de República Dominicana para cuentas tipo banco.
