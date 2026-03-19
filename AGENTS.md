RESPONDE EN ESPAÑOL SIEMPRE

## Backend Reference (Local)
Si necesitas validar endpoints, contratos o lógica del backend, consulta este path local:

`C:\Users\Albin Rodriguez\Documents\pos\src\app\api`

si esa ruta no existe buscala en:
`C:\Users\Albin Rodríguez\Videos\Nueva carpeta\tejada-pos\src\app\api`

## OTA Updates (EAS Update)
Siempre avisa explícitamente cuando un cambio NO sea compatible con OTA y requiera nuevo build nativo.

Compatibles con OTA:
- Cambios en JS/TS dentro de `src/` (lógica, UI, servicios, validaciones).
- Assets manejados por Metro (imágenes, fuentes, textos).

NO compatibles con OTA (requieren build nativo):
- Cambios en `app.json` / `app.config.*` que afecten configuración nativa.
- Agregar, quitar o actualizar librerías nativas.
- Cambios de permisos Android/iOS.
- Cambios en plugins de Expo.
- Cambios en `android/` o `ios/`.
- Upgrade de Expo SDK / React Native.
