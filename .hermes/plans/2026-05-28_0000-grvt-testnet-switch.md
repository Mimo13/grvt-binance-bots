# Plan: soporte testnet/mainnet limpio para GRVT Grid

## Objetivo

Añadir soporte testnet en GRVT Grid sin hardcodes, con cambio fácil desde el frontend para operar contra mainnet o testnet, manteniendo trazabilidad y evitando que una mala configuración mezcle credenciales/órdenes de ambos entornos.

## Revisión documental/web completada

### Código actual

El código apunta principalmente a producción:

- `packages/bot/src/api/client.ts`
  - `MARKET_DATA_URL = https://market-data.grvt.io/full/v1`
  - `TRADING_URL = https://trades.grvt.io/full/v1`
- `packages/bot/src/api/auth.ts`
  - login hardcodeado a `https://edge.grvt.io/auth/api_key/login`
- `packages/bot/src/api/order-signer.ts`
  - EIP-712 domain hardcodeado: `name = GRVT Exchange`, `version = 0`, `chainId = 325`
- `packages/bot/src/dashboard/server.ts`
  - hay usos mixtos: algunos con `process.env.GRVT_TRADING_URL`, otros hardcodeados a `https://trades.grvt.io/full/v1`, y algunos con `sub_account_id` hardcodeado.
- `packages/bot/src/api/grvt-real-test.ts` y `packages/bot/src/api/grvt-auth.ts`
  - utilidades/legacy con endpoints hardcodeados de producción.

No existe todavía una capa única de config GRVT ni un `GRVT_ENV=mainnet|testnet`.

### Documentación local revisada

- `README.md`
- `docs/INSTALL.md`
- `docker-compose.yml`
- `.env.example`

La documentación local explica self-host y credenciales GRVT, pero no documenta testnet. `.env.example` solo define credenciales generales:

- `GRVT_API_KEY`
- `GRVT_API_SECRET`
- `GRVT_TRADING_ACCOUNT_ID`
- `GRVT_TRADING_ADDRESS`

No hay variables separadas por entorno ni endpoints overrideables.

### GRVT web/documentación externa

`api-docs.grvt.io` bloquea por Cloudflare desde este host, pero se pudo consultar `testnet.grvt.io` y el help center.

Endpoints de testnet extraídos de `https://testnet.grvt.io/api/env`:

- Auth/backend: `https://edge.testnet.grvt.io`
- Trading API: `https://trades.testnet.grvt.io`
- Trading WS: `wss://trades.testnet.grvt.io/ws`
- Market Data API: `https://market-data.testnet.grvt.io`
- Market Data WS: `wss://market-data.testnet.grvt.io/ws`
- GRVT testnet RPC: `https://rpc.testnet.grvt.io`

Pruebas read-only realizadas:

- `POST https://market-data.grvt.io/full/v1/instruments` devuelve 200.
- `POST https://market-data.testnet.grvt.io/full/v1/instruments` devuelve 200.
- `POST https://edge.grvt.io/auth/api_key/login` con API key dummy devuelve error funcional `api_key not found`.
- `POST https://edge.testnet.grvt.io/auth/api_key/login` con API key dummy devuelve error funcional `api_key not found`.
- `POST https://trades.grvt.io/full/v1/account_summary` sin auth devuelve 401 esperado.
- `POST https://trades.testnet.grvt.io/full/v1/account_summary` sin auth devuelve 401 esperado.

Help center GRVT:

- API keys se generan desde Account icon > Overview > API Keys > Create, seleccionando Trading Account.
- La API key se puede vincular a wallet existente o generar wallet-key pair.
- La API key se muestra una sola vez; si se elige Generate, también se muestra una Secret Private Key una sola vez.
- Para autorizar transacciones con API key hay que usar la private key del Ethereum public address taggeado para firmar.
- Permisos a nivel Trading Account: Transfer, Trade, View.
- IP whitelist opcional: hasta 10 IPs.

En el bundle de testnet aparece `TestnetOnlyMintTokenMutation` y `NotifyBarMintTestnetTokens`, por lo que el fondeo testnet parece estar soportado por la UI de testnet, probablemente en flujo de Deposit/faucet interno.

## Propuesta técnica

### 1. Crear una capa única de configuración GRVT

Nuevo módulo propuesto:

- `packages/bot/src/api/grvt-config.ts`

Responsabilidades:

- Leer `GRVT_ENV=mainnet|testnet`.
- Resolver endpoints por defecto según entorno.
- Permitir overrides por `.env`:
  - `GRVT_EDGE_URL`
  - `GRVT_TRADING_URL`
  - `GRVT_MARKET_DATA_URL`
  - `GRVT_TRADING_WS_URL`
  - `GRVT_MARKET_DATA_WS_URL`
  - `GRVT_EIP712_NAME`
  - `GRVT_EIP712_VERSION`
  - `GRVT_EIP712_CHAIN_ID`
- Exponer helpers typed:
  - `getGrvtConfig()`
  - `getGrvtEnvironment()`
  - `assertValidGrvtEnv()`

Defaults propuestos:

Mainnet:

- edge: `https://edge.grvt.io`
- trading: `https://trades.grvt.io/full/v1`
- market data: `https://market-data.grvt.io/full/v1`
- trading WS: `wss://trades.grvt.io/ws`
- market data WS: `wss://market-data.grvt.io/ws`
- EIP-712 chainId: `325` (actual hardcode)

Testnet:

- edge: `https://edge.testnet.grvt.io`
- trading: `https://trades.testnet.grvt.io/full/v1`
- market data: `https://market-data.testnet.grvt.io/full/v1`
- trading WS: `wss://trades.testnet.grvt.io/ws`
- market data WS: `wss://market-data.testnet.grvt.io/ws`
- EIP-712 chainId: pendiente de validar. Inicialmente configurable por `.env`; no hardcodearlo sin prueba real.

### 2. Sustituir hardcodes en backend

Cambiar consumidores para usar `getGrvtConfig()`:

- `packages/bot/src/api/client.ts`
- `packages/bot/src/api/auth.ts`
- `packages/bot/src/api/order-signer.ts`
- `packages/bot/src/dashboard/server.ts`
- `packages/bot/src/api/grvt-real-test.ts`
- `packages/bot/src/api/grvt-auth.ts` si sigue siendo usado; si no, marcar legacy/no-op o migrarlo también.

Objetivo: ningún `https://*.grvt.io` directo en lógica de runtime, salvo defaults centralizados en `grvt-config.ts`.

### 3. Separar credenciales por entorno

Para evitar mezclar mainnet/testnet, añadir variables opcionales específicas:

- `GRVT_MAINNET_API_KEY`
- `GRVT_MAINNET_API_SECRET`
- `GRVT_MAINNET_TRADING_ACCOUNT_ID`
- `GRVT_MAINNET_TRADING_ADDRESS`
- `GRVT_TESTNET_API_KEY`
- `GRVT_TESTNET_API_SECRET`
- `GRVT_TESTNET_TRADING_ACCOUNT_ID`
- `GRVT_TESTNET_TRADING_ADDRESS`

Compatibilidad:

- Si `GRVT_ENV=mainnet`, usar primero `GRVT_MAINNET_*`; fallback a las variables legacy `GRVT_API_KEY`, etc.
- Si `GRVT_ENV=testnet`, usar primero `GRVT_TESTNET_*`; fallback opcional a legacy solo si `GRVT_ALLOW_LEGACY_CREDENTIAL_FALLBACK=true` para evitar accidentes.

### 4. Frontend: switch visible y seguro

Añadir UI de entorno:

- Mostrar badge global: `MAINNET` o `TESTNET`.
- Switch en Settings / GRVT Credentials para elegir entorno.
- El switch no debe cambiar endpoints solo en frontend: debe llamar backend para persistir/actualizar configuración o, si el despliegue es single-env, mostrar instrucciones y bloquear el cambio.

Decisión pendiente antes de codificar:

A) Switch runtime real multi-entorno en una misma instancia.
- Más potente.
- Requiere persistir entorno por usuario/subcuenta/bot y separar credenciales y bots por entorno.
- Requiere asegurar que bots mainnet no arranquen tras cambiar a testnet.

B) Switch de instancia/despliegue.
- `GRVT_ENV` vive en `.env`; frontend muestra entorno y ofrece botón/documentación para cambiar, pero el cambio real requiere restart.
- Más seguro y rápido.

Recomendación inicial: implementar B primero para seguridad; preparar estructura para A después si Mimo lo quiere.

### 5. API de estado/config para frontend

Añadir endpoint backend:

- `GET /api/v2/grvt/environment` o integrado en `/api/v2/me/settings`

Respuesta:

```json
{
  "environment": "testnet",
  "endpoints": {
    "trading": "https://trades.testnet.grvt.io/full/v1",
    "marketData": "https://market-data.testnet.grvt.io/full/v1"
  },
  "credentialMode": "testnet-specific",
  "isMainnet": false,
  "isTestnet": true
}
```

No devolver secretos.

### 6. Documentación

Actualizar:

- `.env.example`
- `docs/INSTALL.md`
- crear `docs/GRVT-TESTNET.md`

Contenido de `docs/GRVT-TESTNET.md`:

- Cómo entrar en `https://testnet.grvt.io`.
- Cómo crear/fondear cuenta testnet desde UI.
- Cómo generar API key testnet.
- Qué permisos necesita: Trading Account + Trade/View.
- Cómo configurar `.env`.
- Cómo verificar conexión sin colocar órdenes.
- Cómo volver a mainnet.

## Validación propuesta

Read-only:

- Unit tests de `grvt-config.ts` para mainnet/testnet/overrides/env inválido.
- Test de auth URL construida sin llamar con credenciales reales.
- Test de order-signer usando chainId configurable.
- Search gate: no deben quedar endpoints runtime hardcodeados fuera de `grvt-config.ts` y docs/tests.
- `npm test`.
- `npm run build`.

Manual sin órdenes:

- `GRVT_ENV=testnet` + credenciales testnet.
- Health endpoint OK.
- `getInstruments()` testnet OK.
- `getBalance()`/`account_summary` testnet OK.
- Dashboard muestra TESTNET claramente.
- Crear bot en estado pausado y comprobar que no coloca órdenes.

Con órdenes testnet, solo tras autorización explícita:

- Orden mínima post-only en par testnet con saldo faucet.
- Cancelación inmediata.
- Verificación en UI de GRVT testnet.

## Riesgos / puntos abiertos

1. `GRVT_EIP712_CHAIN_ID` para testnet no está confirmado por docs públicas accesibles desde este host. Debe ser configurable y verificarse con una orden testnet mínima o documentación oficial.
2. Switch runtime real puede ser peligroso si comparte DB/bots entre entornos. Hay que separar entorno en credenciales, subcuentas, bots y órdenes si se implementa A.
3. Testnet puede compartir instrumentos/hash con mainnet, pero no asumirlo; siempre cargar `instruments` del entorno activo.
4. Algunos endpoints de dashboard/server tienen sub_account_id hardcodeado; deben eliminarse antes de declarar soporte limpio.
5. API docs oficial está detrás de Cloudflare; se debe conservar evidencia de endpoints desde `testnet.grvt.io/api/env` y pruebas HTTP.

## Tareas Kanban propuestas

1. Research/spec: cerrar especificación testnet y EIP-712.
2. Config backend: centralizar endpoints/env/credenciales.
3. Refactor backend: reemplazar hardcodes y eliminar IDs fijos.
4. Frontend UX: badge/switch seguro mainnet/testnet.
5. Docs: `.env.example`, install y guía testnet.
6. Validation: tests/build/probes read-only y checklist de orden testnet bloqueada hasta aprobación.

## No comenzar codificación todavía

Este plan deja las tareas creadas/bloqueadas en Kanban. La codificación debe empezar solo cuando Mimo autorice explícitamente el bloque de implementación.
