# Roadmap de mejora y complementación — grvt-binance-bots

## Objetivo

Convertir el fork actual en un producto dual-exchange real, verificable y mantenible: GRVT estable sin regresiones + Binance testnet operativo + arquitectura preparada para más exchanges.

## Principio rector

No avanzar a testnet real hasta que el backend compile, el exchange se persista correctamente, el engine no ejecute rutas GRVT para bots Binance, y haya tests mínimos de routing/órdenes/filtros.

## Estado base detectado

- Frontend: bastante avanzado, build OK.
- Backend: no compila actualmente.
- Tests backend: con `MOCK_MODE=true` pasan 121 y fallan 3; sin mock fallan por credenciales GRVT.
- Binance: cliente escrito, pero no integrado de forma segura.
- Motor: sigue siendo GRVT-céntrico en varias rutas.
- Docs: buenas, pero mezclan Binance Spot Testnet y Futures.
- Kanban: tiene buena estructura, pero algunos estados están optimistas.

---

# ROADMAP EJECUTIVO

## Fase 0 — Congelar alcance técnico Binance

Duración estimada: 0.5 día  
Prioridad: crítica

### Decisión técnica

Decidir y fijar antes de tocar más código:

- Opción A: Binance Spot Testnet / Spot USDC.
- Opción B: Binance USD-M Futures Testnet / Futures USDC/USDT.

Recomendación: para este proyecto y por el contexto de “bots del dashboard con USDC”, elegir Binance Spot Testnet primero. Es más simple, evita liquidación/leverage, encaja con grid USDC y reduce superficie de riesgo. Después se puede añadir Futures como segundo adapter.

### Tareas

1. Definir oficialmente `BINANCE_MARKET_TYPE=spot`.
2. Cambiar documentación para no decir “perpetual futures” si se elige Spot.
3. Normalizar endpoints:
   - Spot testnet REST: `https://testnet.binance.vision/api/v3`
   - Spot testnet WS: `wss://testnet.binance.vision/ws`
   - Spot mainnet REST: `https://api.binance.com/api/v3`
   - Spot mainnet WS: `wss://stream.binance.com:9443/ws`
4. Quitar o aparcar `/fapi/*` hasta que haya adapter futures separado.

### Criterios de aceptación

- README, `docs/EXCHANGES.md` y `.env.example` dicen lo mismo.
- El código no mezcla `/api/v3` y `/fapi/v*`.
- Variables de entorno dejan claro si son Spot o Futures.
- Kanban 5.2 queda bloqueado hasta completar Fase 1 y Fase 2.

---

## Fase 1 — Estabilización mínima: backend compila

Duración estimada: 1 día  
Prioridad: crítica

### Objetivo

Que `npm run typecheck` quede verde antes de cualquier testnet.

### Tareas

1. Arreglar `packages/bot/src/api/binance-client.ts`:
   - `URLSearchParams` mal tipado.
   - `undici` import incorrecto.
   - `signedRequest` no acepta `PUT`.
   - `data` queda como `unknown`.
   - tipos Binance incompletos.
   - casts WS inseguros.
   - `unsubscribeOrders()` tiene bug.
   - `postOnly` mal representado.
   - `tickSize/lotSize` deben venir de filtros reales, no de precision.
2. Arreglar `packages/bot/src/api/exchange-client-factory.ts`:
   - `GRVTClient` no implementa `IExchangeClient`.
   - constructor GRVT usado incorrectamente.
   - `cacheKey()` devuelve string pero el Map espera `ExchangeId`.
3. Arreglar `packages/bot/src/server/v2-router.ts`:
   - import dinámico debe usar extensión `.js`: `await import('../api/binance-client.js')`.
4. Arreglar `packages/bot/src/bot/grid-engine.ts`:
   - `getClientForBot()` devuelve `unknown`, luego se llama a métodos sin tipo.

### Criterios de aceptación

- `npm run typecheck` pasa completo.
- `npm run build --workspace=@grvt-binance/bot` pasa.
- No se añade `any` masivo para esconder errores.
- Se conserva build frontend verde.

### Comandos de validación

```bash
npm run typecheck
npm run build --workspace=@grvt-binance/bot
npm run build --workspace=@grvt-binance/dashboard
```

---

## Fase 2 — Persistencia y routing real por exchange

Duración estimada: 0.5-1 día  
Prioridad: crítica

### Objetivo

Que un bot creado como Binance sea realmente Binance desde DB hasta engine/status/frontend.

### Tareas

1. Corregir `grid-engine.ts createBot()`.
   - Añadir `exchange: config.exchange ?? 'grvt'` en el objeto que va a `db.createBot()`.
2. Añadir test de persistencia:
   - crear bot con `exchange: 'binance'`.
   - comprobar que `grid_bots.exchange = 'binance'`.
3. Revisar `GET /api/v2/bots`.
   - Debe devolver `exchange`.
4. Revisar `GET /api/v2/bots/:id/status`.
   - Ahora usa `grvtClient` hardcodeado.
   - Debe resolver cliente por bot.
5. Revisar endpoints:
   - `/bots/:id/start`
   - `/bots/:id/pause`
   - `/bots/:id/close`
   - `/bots/:id/range/preview`
   - `/candles`
   - `/balance`
   - `/instruments`

Cada endpoint debe quedar clasificado como:
- exchange-agnostic
- GRVT-only
- Binance-ready
- pendiente de adaptar

### Criterios de aceptación

- Bot Binance no llama `grvtClient.getTicker`.
- Bot Binance no guarda `exchange='grvt'` por default accidental.
- Dashboard muestra badge BIN desde dato real de DB.
- Test unitario cubre persistencia y routing.

---

## Fase 3 — Adapter pattern real

Duración estimada: 1.5-2 días  
Prioridad: crítica

### Objetivo

Dejar de fingir que `GRVTClient` y `BinanceClient` son compatibles si no lo son. Crear adapters que implementen el mismo contrato.

### Estructura propuesta

- `packages/bot/src/api/exchange-client.interface.ts`
- `packages/bot/src/api/grvt-exchange-adapter.ts`
- `packages/bot/src/api/binance-spot-adapter.ts`
- `packages/bot/src/api/exchange-client-factory.ts`

### Contrato mínimo

- `getInstruments()`
- `getTicker(symbol)`
- `getKlines(symbol, interval, limit)`
- `getBalance()`
- `getPosition(symbol)`
- `createOrder(params)`
- `cancelOrder(orderId, symbol)`
- `getOpenOrders(symbol?)`
- `getFillHistory(symbol?, limit?)`
- `normalizeSymbol(displayPair)`
- `displaySymbol(nativeSymbol)`
- `disconnect()`

### Contratos opcionales

`ILeverageExchangeClient` para Futures/GRVT si aplica:
- `setLeverage(symbol, leverage)`
- `getLiquidationEstimate(...)`

`IStreamingExchangeClient` para WS real:
- `subscribeTicker`
- `subscribeOrders`

### Tareas

1. Crear `GrvtExchangeAdapter`.
2. Crear `BinanceSpotAdapter`.
3. Ajustar factory para devolver adapter, no cliente raw.
4. Reescribir código que consume exchange para usar solo métodos de interfaz.
5. Guardar `raw` opcional en objetos normalizados para debugging, pero no usarlo en engine.

### Criterios de aceptación

- `GRVTClient` raw no se pasa al engine.
- `BinanceClient` raw no se pasa al engine.
- El engine consume `IExchangeClient`.
- TypeScript impide llamar `client.setLeverage()` si el adapter no lo soporta.
- Tests de adapters pasan.

---

## Fase 4 — Normalización de órdenes y fills

Duración estimada: 1 día  
Prioridad: alta

### Objetivo

Que el engine no lea estructuras específicas como `legs[0].limit_price` de GRVT ni `orderId` de Binance directamente.

### Tipos internos a crear

- `NormalizedOrder`
- `NormalizedFill`
- `NormalizedTicker`
- `NormalizedInstrument`
- `ExchangeFilters`

### Campos esenciales

- `exchange`
- `orderId`
- `clientOrderId`
- `symbol`
- `side`
- `type`
- `price`
- `quantity`
- `filledQuantity`
- `status`
- `createdTime`
- `updatedTime`
- `raw`

### Tareas

1. Adaptar GRVT order → `NormalizedOrder`.
2. Adaptar Binance order → `NormalizedOrder`.
3. Adaptar GRVT fill → `NormalizedFill`.
4. Adaptar Binance trade → `NormalizedFill`.
5. Cambiar `grid-engine.ts` para usar normalized types.
6. Añadir tests de mapping con fixtures.

### Criterios de aceptación

- `grid-engine.ts` no contiene `legs[0]`.
- `grid-engine.ts` no depende de campos raw Binance/GRVT.
- Los tests prueban al menos:
  - order open
  - order filled
  - order cancelled
  - buy fill
  - sell fill
  - partial fill

---

## Fase 5 — Filtros Binance y validación real de órdenes

Duración estimada: 1 día  
Prioridad: alta

### Objetivo

Evitar rechazos de órdenes por tickSize, stepSize, minNotional o símbolo inválido.

### Tareas

1. Parsear `exchangeInfo`.
   Para cada símbolo:
   - `PRICE_FILTER.tickSize`
   - `LOT_SIZE.stepSize`
   - `LOT_SIZE.minQty`
   - `LOT_SIZE.maxQty`
   - `MIN_NOTIONAL` o `NOTIONAL`
   - status TRADING
   - baseAsset
   - quoteAsset
2. Crear helpers:
   - `roundPriceDown(price, tickSize)`
   - `roundQtyDown(qty, stepSize)`
   - `validateMinNotional(price, qty, minNotional)`
3. Modificar `/bots/validate`.
   Para Binance:
   - validar símbolo real.
   - usar quote USDC.
   - calcular qty respetando minNotional.
   - devolver warnings específicos.
4. Corregir frontend:
   - el wizard filtra Binance con `i.quoteAsset`, pero backend devuelve `quoteCurrency`.
   - cambiar a `i.quoteCurrency === 'USDC'` o estandarizar API a `quoteAsset`.

### Criterios de aceptación

- Selector Binance muestra pares reales.
- Preview calcula qty compatible con Binance.
- Test cubre XLMUSDC/XRPUSDC/BTCUSDC con filtros simulados.
- Ninguna orden se crea sin pasar por redondeo.

---

## Fase 6 — Grid engine Binance MVP

Duración estimada: 2-3 días  
Prioridad: alta

### Objetivo

Crear y arrancar un bot Binance Spot Testnet pequeño, con órdenes reales en testnet, sin romper GRVT.

### Alcance MVP

- Spot grid long-only.
- Sin leverage.
- Sin liquidation.
- Capital USDC aislado.
- Opcional `capital_token`.
- BUY debajo del precio.
- SELL encima si hay inventario.
- Rebalance por tick.
- Estado persistido.
- Fills vía `myTrades` + dedupe.

### Tareas

1. Definir comportamiento Binance Spot:
   - `direction='long'` únicamente para MVP.
   - `leverage=1` forzado.
   - liquidation disabled.
   - funding disabled.
2. Crear path de start específico para Spot:
   - si `exchange='binance'` y `marketType='spot'`, no llamar `setLeverage`.
   - no buscar position futures.
   - validar balance USDC/base asset.
   - crear órdenes Spot.
3. Reconciliación:
   - consultar openOrders.
   - consultar myTrades desde `bot.created_at` o desde `last_fill_time`.
   - dedupe con `processed_fill_ids`.
   - no procesar trades históricos manuales previos al bot.
4. Estado:
   - guardar `bot_id`, `symbol`, `base_asset`, `quote_asset`.
   - guardar `capital_usdc`, `capital_token`.
   - guardar `open_order_ids`.
   - guardar `processed_fill_ids`.
   - guardar `total_base_bought`, `total_base_sold`.
   - guardar `avg_buy_price`.
   - guardar `realized_pnl_usdc`.
5. Cancelación:
   - nunca cancelar órdenes cercanas si no hace falta.
   - si hay que liberar capacidad, cancelar siempre las más lejanas primero.
   - registrar cancelaciones con razón.
6. Actividad:
   - JSONL por tick/fill/cancel/rebuild/error.
   - mínimo: timestamp, bot_id, exchange, symbol, event, price, order counts, realized pnl, notes.

### Criterios de aceptación

- Bot Binance Spot testnet arranca sin llamar métodos GRVT.
- Crea órdenes válidas en Binance testnet.
- No añade órdenes fallidas al estado.
- Rebalance no crashea si una orden falla.
- Estado sobrevive restart de backend.
- Actividad JSONL permite diagnosticar.

---

## Fase 7 — Tests automatizados y suite de regresión

Duración estimada: 1.5 días  
Prioridad: alta

### Objetivo

Que el proyecto no vuelva a quedar en “parece hecho pero no compila”.

### Tareas

1. Tests `binance-client.test.ts`:
   - signature HMAC.
   - URL query order.
   - public request.
   - signed request error mapping.
   - order mapping.
   - fill mapping.
   - filters mapping.
2. Tests `exchange-routing.test.ts`:
   - GRVT bot usa GRVT adapter.
   - Binance bot usa Binance adapter.
   - status usa adapter correcto.
   - create persists exchange.
3. Tests `wizard-binance.test.tsx`:
   - selector de exchange.
   - instrumentos Binance aparecen.
   - payload validate/create incluye exchange.
   - tabs filtran correctamente.
4. Tests de engine Spot:
   - no leverage.
   - no liquidation.
   - minNotional enforcement.
   - capital cap.
   - sell cap = min(bot inventory, wallet balance).
   - cancel farthest first.
5. Arreglar tests existentes:
   - signup/admin gate que falla con 500.
   - tests que requieren GRVT creds deben usar mock correctamente.

### Criterios de aceptación

- `npm run typecheck` verde.
- `MOCK_MODE=true npm test --workspace=@grvt-binance/bot` verde.
- `npm run test --workspace=@grvt-binance/dashboard` verde.
- `npm run build` verde.
- CI documentado o script local `npm run verify`.

---

## Fase 8 — Testnet real controlado

Duración estimada: 0.5-1 día inicial + observación  
Prioridad: alta, después de Fase 7

### Objetivo

Ejecutar un bot Binance testnet con capital mínimo y comprobar el flujo completo.

### Precondiciones

- Typecheck verde.
- Tests verdes.
- Credenciales testnet válidas.
- Endpoints Spot/Futures coherentes.
- Bot Binance persiste `exchange='binance'`.

### Plan

1. Verificar credenciales directamente:
   - account endpoint.
   - exchangeInfo.
   - openOrders.
2. Crear bot con $10-$20.
3. Usar símbolo líquido testnet con minNotional cómodo.
4. Crear rango cercano al precio actual.
5. Usar pocos grids iniciales.
6. Activar bot.
7. Verificar:
   - open orders en Binance.
   - open orders en DB/estado.
   - dashboard refleja lo mismo.
   - activity log registra tick.
8. Forzar/esperar fill:
   - en Spot testnet, si limits no cruzan, validar con market micro-order controlada o ajustar rango.
9. Verificar:
   - fill detectado.
   - PnL no se contamina con historial.
   - orden opuesta se crea.
   - no excede capital.

### Criterios de aceptación

- Bot creado desde dashboard.
- Órdenes aparecen en Binance testnet.
- Estado local coincide con exchange.
- Al menos 1 fill procesado correctamente.
- No hay errores 401/signature/minNotional.
- No hay llamadas GRVT para ese bot.
- Logs suficientes para auditoría.

---

## Fase 9 — Telegram y notificaciones

Duración estimada: 0.5-1 día  
Prioridad: media-alta

### Objetivo

Que Binance y GRVT emitan alertas consistentes, pero con exchange explícito.

### Eventos

- bot created
- bot started
- bot paused/stopped
- order placed
- fill buy/sell
- rebalance
- cancel farthest
- credential/auth error
- insufficient balance
- stoploss/take profit

### Tareas

1. Añadir `exchange` y `symbol` en payload de eventos.
2. Ajustar notifier para no asumir GRVT.
3. Añadir formato:
   - `[BINANCE TESTNET] XRPUSDC fill SELL ...`
   - `[GRVT TESTNET] ETH_USDT_Perp fill ...`
4. Añadir test/fake notifier.
5. Verificar envío real Telegram.

### Criterios de aceptación

- Fill Binance envía alerta correcta.
- Error Binance auth envía alerta crítica.
- No se mezclan símbolos ni exchange.
- Telegram no muestra balances wallet-wide como bot balance.

---

## Fase 10 — Documentación verificada

Duración estimada: 0.5-1 día  
Prioridad: media

### Objetivo

Que README/docs reflejen la realidad probada, no la arquitectura deseada.

### Documentos

1. `README.md`
   - QuickStart real.
   - Puertos 3848/3849 aclarados.
   - Binance Spot/Futures definido.
   - Estado de soporte por exchange.
   - Comandos de verify.
2. `docs/EXCHANGES.md`
   - tabla endpoints correcta.
   - auth correcta.
   - diferencias Spot/Futures.
   - symbol formats.
3. `docs/ARCHITECTURE.md`
   - factory real.
   - adapters reales.
   - diagrama actualizado.
4. `docs/QUICKSTART-BINANCE.md`
   - obtener API key testnet.
   - configurar `.env`.
   - crear bot.
   - validar órdenes.
   - troubleshooting 401/minNotional/signature.
5. `docs/SECURITY.md`
   - Binance API permissions.
   - withdrawals disabled.
   - IP whitelist.
   - testnet vs mainnet.
   - rotación.
   - no logs de secretos.

### Criterios de aceptación

- Un usuario puede levantar Binance testnet desde cero.
- No hay referencias contradictorias `fapi` vs Spot.
- Docs incluyen comandos reales verificados.
- Docs indican claramente “MVP Spot” o “MVP Futures”.

---

## Fase 11 — Seguridad y mantenimiento

Duración estimada: 1 día  
Prioridad: media

### Objetivo

Reducir deuda de seguridad y preparar producción.

### Tareas

1. Quitar `node-binance-api` si no se usa.
2. Resolver `npm audit --omit=dev`.
3. Revisar secretos:
   - `.env` ignorado.
   - no logs de API key.
   - no dumps de signature con secret.
4. Añadir health check:
   - GRVT creds status.
   - Binance creds status.
   - testnet/mainnet warning.
5. Añadir “safe mode”:
   - `TRADING_MODE=paper|testnet|live`.
   - live requiere env explícito extra tipo `ALLOW_LIVE_TRADING=true`.
6. Añadir rate limits a endpoints de trading sensibles si faltan.
7. Añadir backups DB/state.

### Criterios de aceptación

- `npm audit --omit=dev` sin críticas.
- Live trading imposible por accidente.
- Health endpoint detecta credenciales Binance inválidas.
- Logs no exponen secretos.

---

## Fase 12 — Refactor estructural profundo

Duración estimada: 3-5 días  
Prioridad: media, después del MVP

### Objetivo

Bajar deuda del engine/router y hacer el proyecto mantenible.

### Problemas actuales

- `grid-engine.ts`: 3.640 líneas.
- `v2-router.ts`: 2.626 líneas.
- Mucha lógica GRVT mezclada con negocio.
- Validación, ejecución, reconciliación y API viven demasiado juntas.

### Extracciones propuestas

1. `src/bot/grid-calculator.ts`
   - spacing
   - levels
   - qty
   - profit estimates
2. `src/bot/order-reconciler.ts`
   - open orders vs grid levels
   - orphan detection
   - matching by clientOrderId/price
3. `src/bot/fill-processor.ts`
   - myTrades/fillHistory
   - dedupe
   - PnL
   - pending fills
4. `src/bot/capital-manager.ts`
   - available capital
   - sell cap
   - wallet vs bot balances
   - fee-aware profitability
5. `src/bot/cancellation-policy.ts`
   - farthest first
   - never cancel near
   - max cancel per tick
6. `src/server/routes/`
   - `auth.routes.ts`
   - `bots.routes.ts`
   - `market.routes.ts`
   - `admin.routes.ts`
   - `metrics.routes.ts`
7. `src/exchanges/`
   - `base.ts`
   - `grvt/adapter.ts`
   - `binance/spot-adapter.ts`
   - `binance/futures-adapter.ts` futuro

### Criterios de aceptación

- Ningún archivo crítico supera ~800-1000 líneas salvo casos justificados.
- Cada módulo tiene tests.
- El engine principal se lee como orquestación, no como bloque monolítico.
- Añadir otro exchange no requiere tocar 20 sitios.

---

## Fase 13 — Producto avanzado

Duración estimada: incremental  
Prioridad: posterior al MVP estable

### Ideas complementarias

1. Paper trading unificado.
2. Backtesting por exchange.
3. Config visual avanzada:
   - dual capital USDC + token.
   - sliders de wallet.
   - preview de órdenes.
   - estimación fee-aware de PnL por grid.
   - advanced toggle para opciones complejas.
4. Modo operación supervisada:
   - dry-run create orders.
   - botón confirm place.
5. Multi-exchange comparison:
   - spreads, fees, liquidez.
   - recomendación exchange/par.
6. Strategy profiles:
   - conservative
   - neutral
   - aggressive
   - lateral market
   - trend-follow grid
7. Observabilidad:
   - dashboard de eventos JSONL.
   - errores por bot.
   - últimas decisiones de rebalance.
   - diff estado local vs exchange.
8. Recovery tools:
   - cancelar solo órdenes del bot.
   - reconstruir estado desde exchange.
   - reconciliar fills.
   - exportar auditoría.

---

# Plan Kanban recomendado

## Mover/marcar

1. Marcar done:
   - `1.1 - Fork/copy project structure from grvt-bot`, porque está verificado.
2. Replantear:
   - `5.8 - Push all to GitHub` dividir en:
     - `5.8a - Initial push completed` done.
     - `5.8b - Push stable Binance MVP after verification` todo.
3. Mantener ready:
   - `3.8 - Run full test suite` pero actualizar aceptación con resultados reales.
4. Bloquear:
   - `5.2 - Create Binance testnet bot` hasta Fases 1-7.

## Nuevas tareas Kanban sugeridas

- `0.1 - Decide Binance Spot vs Futures scope`
- `1.1 - Fix backend TypeScript compilation`
- `1.2 - Fix BinanceClient request/types`
- `1.3 - Fix exchange factory with real adapters`
- `2.1 - Persist exchange from GridEngine createBot`
- `2.2 - Route bot status through exchange adapter`
- `3.1 - Create GrvtExchangeAdapter`
- `3.2 - Create BinanceSpotAdapter`
- `4.1 - Normalize Order/Fill/Ticker types`
- `5.1 - Parse Binance exchange filters`
- `5.2 - Fix Binance pair selector quoteCurrency`
- `6.1 - Implement Binance Spot start path`
- `6.2 - Implement Binance Spot fill processor`
- `6.3 - Implement Binance Spot capital manager`
- `7.1 - Add Binance unit tests`
- `7.2 - Add exchange routing tests`
- `8.1 - Run Binance testnet smoke bot`
- `9.1 - Verify Telegram alerts for Binance`
- `10.1 - Rewrite Binance docs with verified commands`
- `11.1 - Remove vulnerable unused deps`
- `12.1 - Split grid-engine modules`

---

# Orden operativo exacto para la próxima sesión

1. Crear/actualizar tareas Kanban para Fases 0-2.
2. Decidir Spot vs Futures. Recomendación: Spot.
3. Arreglar typecheck backend.
4. Añadir test que demuestre el bug actual:
   - crear bot Binance → DB debe guardar `exchange='binance'`.
5. Arreglar persistencia exchange.
6. Crear adapters mínimos.
7. Cambiar `/bots/:id/status` para no usar `grvtClient` hardcodeado.
8. Arreglar wizard Binance `quoteCurrency`.
9. Ejecutar:
   - `npm run typecheck`
   - `MOCK_MODE=true npm test --workspace=@grvt-binance/bot`
   - `npm run test --workspace=@grvt-binance/dashboard`
   - `npm run build`
10. Solo entonces pasar a testnet.

---

# Definición de “MVP Binance terminado”

No considerar Binance terminado hasta cumplir todo esto:

- Backend compila.
- Tests pasan.
- Bot Binance se guarda como Binance.
- Status Binance usa Binance.
- Start Binance no llama `setLeverage` ni métodos GRVT.
- Instrumentos Binance vienen de exchangeInfo real.
- Orden Binance respeta tickSize, stepSize, minNotional.
- Estado local no registra órdenes fallidas.
- Fills se detectan por trade history con dedupe.
- Dashboard muestra bot-specific USDC/TOKEN, no wallet-wide.
- Telegram incluye exchange y símbolo.
- README/QuickStart están verificados con comandos reales.
- Hay al menos un bot testnet con:
  - órdenes creadas,
  - tick funcionando,
  - fill o prueba controlada procesada,
  - logs JSONL auditables.

---

# Resumen final

La estrategia correcta no es seguir añadiendo features. Primero hay que cerrar la brecha entre arquitectura declarada y código ejecutable. El roadmap debe ir de estabilización → adapters reales → Binance MVP testnet → documentación verificada → refactor profundo.

Si se hace así, el proyecto puede quedar sólido. Si se salta directo a 5.2/testnet ahora, se diagnosticarán errores de integración que TypeScript ya está avisando.

---

## 2026-06-01 — Estado real tras decidir Binance Spot/Testnet (no Futures)

### Respuesta operativa guardada

No. Está guardado y empujado, pero el proyecto no está listo para operar Binance todavía.

Lo que sí está listo:
- Repo GitHub actualizado.
- roadmap.md creado y pusheado.
- Dashboard compila.
- Tests dashboard pasan: 45/45.
- npm audit actual: 0 vulnerabilidades.
- Decisión guardada en Engram: Binance Spot/Testnet, no Futures.
- Review guardada en Engram.

Lo que NO está listo:
- Backend no compila: `npm run typecheck` falla con 50+ errores.
- BinanceClient todavía mezcla Futures con Spot: usa `/fapi/*` pero apunta a `testnet.binance.vision`, que es Spot Testnet.
- GridEngine sigue siendo GRVT-céntrico: usa `setLeverage`, `order_id` y `legs[0].limit_price`.
- `exchange=binance` no se persiste todavía desde `GridEngine.createBot`.
- El selector Binance del frontend probablemente queda vacío: frontend busca `quoteAsset` y `PERPETUAL`, backend/interface devuelve `quoteCurrency` y contractType normalizado.
- No hay tests Binance específicos.
- No se debe crear bot testnet aún.

Con la confirmación de Mimo: “No quiero futures por ahora”, el camino queda claro.

Primera tarea real:
- Convertir BinanceClient y docs a Binance Spot Testnet puro.

Después:
1. Hacer que typecheck pase.
2. Persistir `exchange=binance`.
3. Crear adapters reales GRVT/Binance.
4. Quitar lógica GRVT del engine común.
5. Parsear filtros reales Binance:
   - `PRICE_FILTER.tickSize`
   - `LOT_SIZE.stepSize`
   - `MIN_NOTIONAL` / `NOTIONAL`
6. Añadir tests Binance.
7. Solo entonces crear bot testnet.

Respuesta corta:
- No está todo listo para ejecutar bots, pero sí está listo el diagnóstico y la decisión clave. El siguiente bloque de trabajo debe ser estabilización backend + Spot Testnet, no testnet execution todavía.

### Instrucción actual de Mimo

> Guarda la respuesta anterior y esta en el fichero roadmap.md del proyecto y comienza con lo que falta hasta terminar o tener algún problema bloqueante.

### Decisión de ejecución

- Scope Binance: Spot/Testnet solamente. Futures queda fuera del MVP actual.
- No usar endpoints `/fapi/*`, `positionRisk`, `setLeverage` ni streams futures para Binance en esta etapa.
- Prioridad inmediata: hacer verde el backend typecheck y separar la ruta Binance Spot de los supuestos GRVT/Futures.

### Decisión posterior de producto: Telegram-only

Mimo aclaró: “No vamos a usar email, solo Telegram”.

Implicaciones:
- El flujo de email/password/ADMIN_EMAIL no debe bloquear la estabilización Binance Spot.
- Las pruebas ADMIN_EMAIL pasan a considerarse legacy/históricas hasta eliminar o sustituir el auth email por identidad Telegram.
- El flujo operativo futuro debe basarse en Telegram para identidad/control/notificaciones.
- Antes del smoke bot real, definir cómo se asocia `telegram_user_id` con el operador y cómo se autorizan comandos/control del bot.

