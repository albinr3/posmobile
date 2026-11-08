# Tutorial móvil y finalización compartida

El recorrido móvil usa progreso local por cuenta, dueño y versión. El único estado
compartido con la web es `AccountOnboarding.completedAt`. Posponer no completa el
tutorial. La práctica usa un navegador y un catálogo propios: nunca debe importar
el carrito operativo, SQLite, caja, impresión ni handlers de venta.

El dueño recibe apertura automática una vez únicamente si
`mobileAutoStartEligible=true`. Las cuentas existentes quedan en `false`, sin
backfill. Pueden abrir manualmente el tutorial pendiente desde Inicio o Ajustes.
Una primera configuración terminada después del despliegue se considera alta nueva.

## Despliegue

1. En el repositorio web `pos`, aplicar mediante el procedimiento habitual la
   migración `20261107130000_mobile_onboarding` y generar el cliente Prisma.
2. Desplegar el backend y la web juntos. Verificar `GET /api/onboarding`,
   `POST /api/onboarding/complete` y el campo `isOnboardingDemo` de productos.
3. Publicar la actualización móvil por el canal EAS correspondiente.

No se han aplicado migraciones a bases de datos ni publicado actualizaciones desde
este cambio. Es compatible con OTA: no agrega librerías, permisos ni configuración nativa.

## Casos a comprobar

- Alta nueva y dueño: bienvenida, Vender, Café Americano, carrito, práctica,
  formulario normal, guardar y celebración. Confirmar que la web deja de guiar.
- Completar en web mientras está abierto el formulario móvil: desaparece el coach,
  se conservan todos los campos, no se envía una finalización móvil nueva.
- Sin red: práctica y borrador disponibles tras haber consultado el estado; el
  producto se guarda normalmente y la finalización espera su `server_id` sincronizado.
- Reanudar, cambiar de cuenta, posponer, botón Atrás, texto grande, teclado y
  movimiento reducido. Un carrito real en curso debe impedir la entrada a práctica.

Validación local (sin conectarse a producción):

```powershell
node scripts/onboarding-regression.test.cjs
node scripts/product-create-regression.test.cjs
node scripts/product-update-regression.test.cjs
node scripts/registration-regression.test.cjs
node scripts/stock-regression.test.cjs
node scripts/sale-notes.test.cjs
.\node_modules\.bin\tsc.cmd --noEmit
```

El backend incluye `scripts/onboarding-regression.test.cjs`: prueba finalización
cruzada, idempotencia concurrente, permisos, productos ajenos/demo y conservación
de historial con Prisma simulado. Las comprobaciones visuales requieren un móvil
o emulador Android/iOS; los tests Node no sustituyen esa revisión.

## Recuperación y concurrencia

Precio y costo deben convertirse a centavos enteros positivos. Un borrador con costo
0 vuelve a ese campo. Si ya se guardó localmente, la guía ofrece **Corregir producto**:
se edita el mismo `localId` y la misma operación de creación pendiente. La edición
espera al worker, relee el ID del servidor y confirma producto y cola juntos.

Un 422 (`ONBOARDING_PRODUCT_INVALID`) no se trata como un fallo de red. Se consulta
otra vez el estado global y se usa otro producto válido si existe. Sin candidato,
la práctica se conserva; solo se permite retomar el paso de producto cuando no hay
un envío pendiente del original. Un producto válido offline espera su ID del servidor.

Todas las transacciones de finalización y guardado web de productos toman primero
el bloqueo PostgreSQL `onboarding:<accountId>`. Mantener ese orden antes de escribir
productos u onboarding evita interbloqueos entre plataformas y conserva el primer timestamp.

Para integración del backend, definir explícitamente `TEST_DATABASE_URL` con una base
nueva local llamada `pos_onboarding_test` o `pos_onboarding_test_<sufijo numérico>`:

```powershell
node scripts/setup-onboarding-test-db.mjs
node scripts/onboarding.integration.test.mjs
```

El setup rechaza bases existentes, hosts remotos y parámetros en la URL. Las pruebas
usan conexiones independientes; no utilizan `DATABASE_URL` como alternativa.
