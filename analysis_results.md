# 🔍 Análisis Exhaustivo de Bugs — MOVOPos Mobile

> Análisis realizado sobre 87 archivos fuente de la aplicación Expo/React Native.  
> Fecha: 23 de Marzo, 2026

---

## 🔴 Bugs Críticos (pueden causar pérdida de datos o comportamiento incorrecto)

### 1. Race condition en [processQueue](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#167-203) + [fullSync](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#62-100)

> [!CAUTION]
> **Archivo:** [SyncService.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#L62-L99)

[fullSync()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#62-100) toma el lock `isSyncing = true` en la línea 71, pero luego llama a [uploadPendingChanges()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#1205-1208) → [processQueueInternal()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#204-262) directamente. Mientras tanto, [processQueue()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#167-203) verifica `isSyncing` en la línea 168 y retorna temprano. **El problema:** si [fullSync()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#62-100) está ejecutándose y simultáneamente un [handleConnectivityChange()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#53-61) dispara [processQueue()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#167-203), este simplemente sale porque `isSyncing = true`. Pero si [fullSync()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#62-100) termina (`isSyncing = false` en línea 95) justo cuando [processQueueInternal()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#204-262) estaba a mitad, y luego [processQueue()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#167-203) corre de nuevo, podrían solaparse operaciones.

**Riesgo:** Duplicación de operaciones en casos de timing específico durante sync + cambio de conectividad.

---

### 2. [downloadFromServer](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#1197-1204) no pagina ventas, productos ni cotizaciones

> [!WARNING]
> **Archivo:** [downloadFromServer.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/downloadFromServer.ts#L146-L184)

Las cuentas por cobrar (AR) se descargan con paginación (`skip/take`), pero **productos, ventas, clientes, cotizaciones, devoluciones y pagos NO**. Si un negocio tiene +500 productos o +1000 ventas, la respuesta del servidor puede:
- Truncarse si el backend impone un límite por defecto.
- Causar timeout (el timeout es 30 segundos).
- Consumir mucha memoria en el dispositivo.

**Riesgo futuro:** Datos incompletos en la app y OOM crashes en dispositivos con poca RAM.

---

### 3. Pagos: `take: 500` hardcodeado sin paginación

> [!WARNING]
> **Archivo:** [downloadFromServer.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/downloadFromServer.ts#L1042-L1046)

```typescript
const paymentsResponse = await axios.get(`${API_URL}/api/payments`, {
  params: { take: 500 },
  ...
});
```

Si el negocio tiene más de 500 pagos, los más antiguos nunca se descargarán. A futuro, la data de reportes será incorrecta.

---

### 4. [download](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#1197-1204) no elimina registros borrados del servidor

> [!IMPORTANT]
> **Archivo:** [downloadFromServer.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/downloadFromServer.ts)

La función [downloadFromServer](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#1197-1204) solo hace **upsert** (insert o update). Si un producto, cliente o factura se **elimina en el servidor**, el registro permanece en la DB local **indefinidamente**. Solo las AR tienen lógica para cerrar registros que desaparecieron del servidor.

**Riesgo:** Fantasmas de datos eliminados apareciendo en la app móvil.

---

### 5. SQL Injection potencial en [Database.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/database/Database.ts)

> [!CAUTION]
> **Archivo:** [Database.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/database/Database.ts#L490-L505)

```typescript
async insert(table: string, data: Record<string, any>): Promise<void> {
  const keys = Object.keys(data);
  // ...
  this.db!.runAsync(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
    values
  );
}
```

Los nombres de tabla y columnas se interpolan directamente en el SQL sin sanitización. Si algún flujo permite que `table` o `keys` contengan valores controlados por el usuario (ej: via datos del servidor), podría haber inyección SQL. Aplica también a [update](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/database/Database.ts#524-561) y [delete](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/database/Database.ts#562-586).

**Mitigación existente:** En la práctica, los table names son constantes literales. Pero es un vector si los datos del servidor contienen keys inesperadas.

---

## 🟠 Bugs Moderados (pueden causar UX degradada o inconsistencias)

### 6. Token JWT del subusuario puede expirar durante operación larga

> [!WARNING]
> **Archivo:** [authStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/authStore.ts#L158-L195)

[loadSubUserToken()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/authStore.ts#158-229) verifica la expiración del JWT al restaurar la sesión, pero **no hay un mecanismo de refresh automático**. Si el token expira mientras el usuario está usando la app activamente, la sincronización fallará con errores de autenticación sin previo aviso. El cooldown de 60 segundos (`backendAuthCooldownUntil`) mitiga parcialmente, pero el usuario queda en un estado bloqueado sin saber por qué.

---

### 7. `cartStore.clear()` se define dos veces (override silencioso)

> [!IMPORTANT]  
> **Archivo:** [cartStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/cartStore.ts#L69-L81) + [createCartStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts#L157-L164)

[createCartStore](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts#174-186) combina [createBaseCartSlice](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts#32-171) + `createExtraSlice`. Ambos definen [clear()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts#157-165). El spread en la línea 182 de [createCartStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts) hace que el [clear](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts#157-165) del [cartStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/cartStore.ts) (extra slice) **oculte** el del base. Funciona ahora porque [cartStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/cartStore.ts) resetea los mismos campos + los extras. Pero si se agregan campos al base sin actualizar [cartStore.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/cartStore.ts), el [clear()](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/createCartStore.ts#157-165) no los reseteará.

---

### 8. `sync_queue` no tiene límite de retry ni limpieza automática

> [!WARNING]
> **Archivo:** [SyncService.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#L208-L221)

[processQueueInternal](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#204-262) reinicia **todas** las devoluciones con error a `pending` incondicionalmente:

```typescript
await db.runAsync(
  `UPDATE sync_queue
   SET status = 'pending', retry_count = 0
   WHERE status = 'error' AND entity_type = 'return' AND action = 'create'`
);
```

Esto crea un **loop infinito** para devoluciones que el backend siempre rechaza. También resetea `retry_count = 0`, perdiendo el historial de intentos.

Además, los items marcados como `synced` **nunca se limpian**. La tabla `sync_queue` crecerá indefinidamente, degradando performance con el tiempo.

---

### 9. [processQueueInternal](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#204-262) resetea TODOS los items 'syncing' a 'pending'

> [!WARNING]
> **Archivo:** [SyncService.ts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#L217-L221)

```typescript
await db.runAsync(
  `UPDATE sync_queue SET status = 'pending' WHERE status = 'syncing'`
);
```

Si la app se cierra brutalmente durante un sync, esto está bien. Pero si hay **concurrencia** (improbable por el lock, pero posible), podría resetear items que ya fueron enviados exitosamente al backend pero aún no marcados como `synced` localmente, causando **envíos duplicados**.

---

### 10. POSScreen: [loadProducts](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/screens/sales/POSScreen.tsx#262-298) se ejecuta en cada focus sin debounce

> [!IMPORTANT]
> **Archivo:** [POSScreen.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/screens/sales/POSScreen.tsx#L120-L125)

```typescript
useFocusEffect(
  useCallback(() => {
    setLoading(true);
    loadProducts();
  }, [])
);
```

Cada vez que la pantalla obtiene foco (ej: regresar de seleccionar cliente, de escanear barcode, etc.), **recarga todos los productos de la base de datos**, lo cual incluye parsear JSON de cada producto. Para catálogos grandes (500+ productos), esto causa un freeze visible.

---

### 11. El filtro de productos excluye los no sincronizados

> [!IMPORTANT]
> **Archivo:** [POSScreen.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/screens/sales/POSScreen.tsx#L306)

```typescript
const activeProducts = products.filter(
  (product) => product.synced && !!product.serverId && product.isActive
);
```

Los productos creados localmente que **aún no se han sincronizado** (no tienen `serverId`) son invisibles en el POS. El usuario crea un producto offline y no lo puede vender hasta que se sincronice.

---

### 12. `long press` para remover del carrito usa `productId` en lugar de `lineId`

> [!WARNING]
> **Archivo:** [POSScreen.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/screens/sales/POSScreen.tsx#L401-L406)

```typescript
onLongPress={() => {
  if (selectedQty > 0) {
    useCartStore.setState({
      items: useCartStore.getState().items.filter(i => i.productId !== item.localId),
    });
  }
}}
```

Se filtra por `productId`, pero con modificadores de receta, un producto puede tener **múltiples `lineId`** en el carrito (ej: Hamburguesa normal + Hamburguesa sin queso). El long press eliminaría **todas las variantes** del producto, no solo las sin modificador.

---

## 🟡 Problemas Menores / Deuda Técnica


---

### 15. No hay `ErrorBoundary` por pantalla individual

> **Archivo:** [App.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/App.tsx#L391-L393)

Solo hay un `ErrorBoundary` global. Si una pantalla específica lanza un error de render (ej: JSON.parse fallido en datos corruptos), **toda la app** muestra la pantalla de error en vez de solo la pantalla afectada.

---

### 16. `inventoryReportScreen` y otros reportes probablemente calculan offline con datos potencialmente incompletos

Los reportes se basan en la data local de SQLite, que como se mencionó en el bug #2, puede estar **incompleta** si el backend tiene más registros de los que se descargan.

---

### 17. `useEffect` con dependencias potencialmente inestables en [App.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/App.tsx)

> **Archivo:** [App.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/App.tsx#L265)

```typescript
}, [isReady, isLoaded, isSignedIn, user?.id, isAuthenticated, setUser, loadSubUserToken, logout, authRefreshTick]);
```

Funciones como [setUser](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/authStore.ts#82-99), [loadSubUserToken](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/authStore.ts#158-229) y [logout](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/store/authStore.ts#230-251) se pasan como dependencias. Si Zustand recrea estas funciones en cada render (no lo hace típicamente), causaría loops. Zustand mantiene las references estables, así que funciona, pero es frágil ante refactores.

---

### 18. El `hard reset one-shot` en [initializeApp](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/App.tsx#292-369) puede correr múltiples veces

> **Archivo:** [App.tsx](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/App.tsx#L296-L345)

Si `SecureStore.setItemAsync(LOCAL_HARD_RESET_ONCE_KEY, '1')` falla (crash, falta espacio), el hard reset corre de nuevo al próximo inicio, **borrando todo otra vez**.

---

### 19. [downloadFromServer](file:///c:/Users/Albin%20Rodr%C3%ADguez/Videos/posmobile/src/services/sync/SyncService.ts#1197-1204) no maneja errores individuales por entidad

Si la descarga de `categories` falla con un 500 del servidor, el `catch` general en la línea 1193 **aborta toda la sincronización**, incluyendo las entidades pendientes que sí podrían haber descargado (ej: pagos, gastos operativos).

---

