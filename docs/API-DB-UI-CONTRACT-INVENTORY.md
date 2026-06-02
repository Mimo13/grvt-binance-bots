# Inventario de Contratos: API / DB / UI — Shared vs Exchange-Specific

> Documento de diagnóstico. NO implementar cambios — solo mapeo de contratos actuales.
> Fecha: 2026-06-02 | Proyecto: grvt-binance-bots | Exchange: GRVT + Binance Spot

---

## 1. Catálogo de Endpoints REST (v2-router.ts)

### 1.1 Endpoints compartidos (funcionan para ambos exchanges)

| Endpoint | Método | Shape Response | Exchange-Aware? | Notas |
|---|---|---|---|---|
| `/api/v2/bots` | GET | `{ bots: Row[] }` — SELECT con campos fijos | Sí — filtra por `COALESCE(user_id,1)` | Devuelve solo campos listados en SELECT (no incluye `capital_usdc` ni campos Binance) |
| `/api/v2/bots/:id` | GET | `{ bot: Row }` — `SELECT * FROM grid_bots` | Sí — devuelve `exchange` column | Expone TODAS las columnas DB al frontend |
| `/api/v2/bots/:id/grid-state` | GET | `{ botId, pair, exchange, status, levels, ticker, position, openOrders, ts }` | Sí — usa `getExchangeClient()` según `bot.exchange` | El exchange client ya abstrae diferencias |
| `/api/v2/bots/:id/trades` | GET | `{ trades: Trade[] }` | No necesario — DB local | Query contra tabla `trades` |
| `/api/v2/bots/:id/snapshots` | GET | `{ snapshots: DailySnapshot[] }` | No necesario — DB local | Query contra `daily_snapshots` |
| `/api/v2/bots/:id/roundtrips` | GET | `{ roundtrips, count, totalProfit }` | No necesario — DB local | Query contra `paired_roundtrips` |
| `/api/v2/bots/:id/fills` | GET | `{ fills: FillRow[] }` | No necesario — DB local | Query contra `fills_archive` |
| `/api/v2/bots/:id/rebate-summary` | GET | `RebateSummary` | No necesario — DB local | Stats sobre `fills_archive` |
| `/api/v2/bots/:id/realized-summary` | GET | `RealizedSummary` | No necesario — DB local | FIFO sobre `paired_roundtrips` + `fills_archive` |
| `/api/v2/bots/:id/orders` | GET | `{ orders: OrderRow[] }` | No necesario — DB local | Query contra `orders` |
| `/api/v2/bots/:id/funding` | GET | `{ funding, count, totalPaymentUsdt }` | **LEGACY** — solo GRVT tiene funding rate | Query contra `funding_history` |
| `/api/v2/bots/validate` | POST | `ValidateBotResult` | Sí — acepta `exchange` field | Validación params + computed grid params |
| `/api/v2/bots` | POST | `{ id, status, grvt_network }` | Sí — acepta `exchange` field | Crea bot con exchange asignado |
| `/api/v2/bots/:id/start` | POST | `{ id, status }` | Sí — engine despacha por exchange | Delega a engineOps.startBot() |
| `/api/v2/bots/:id/pause` | POST | `{ id, status }` | Sí — engine despacha por exchange | |
| `/api/v2/bots/:id/close` | POST | `{ id, status }` | Sí — engine despacha por exchange | |
| `/api/v2/bots/:id/compound` | PATCH | `{ id, compound_pct }` | No necesario — solo DB | Update settings en DB |
| `/api/v2/bots/:id/risk` | PATCH | `{ id, sl_pct?, tp_pct? }` | No necesario — solo DB | Update SL/TP en DB |
| `/api/v2/bots/:id/range/preview` | POST | `{ plan: RangeUpdatePlan }` | Sí — engine despacha | RangeUpdatePlan genérico |
| `/api/v2/bots/:id/range` | POST | `{ id, lowerPrice, upperPrice, numGrids }` | Sí — engine despacha | |
| `/api/v2/portfolio-summary` | GET | `PortfolioSummary` | Parcial — usa columnas DB genéricas | Usa `grid_profit_usdt + trend_pnl_usdt` (futures) |
| `/api/v2/portfolio-equity-curve` | GET | `{ points: PortfolioEquityPoint[] }` | No necesario — DB local | Suma `daily_snapshots.equity` |
| `/api/v2/candles` | GET | `{ pair, interval, candles: Candle[] }` | Sí — accepta query param `exchange` | Proxy a GRVT o Binance según exchange |
| `/api/v2/instruments` | GET | `{ instruments, grvt_network? }` | Sí — accepta `?network=binance` | |
| `/api/v2/alerts` | GET | `{ alerts }` | No necesario — archivo de notifier | |
| `/api/v2/health` | GET | `HealthV2` | Parcial — chequea GRVT ticker | Solo checkea GRVT, no Binance |

### 1.2 Endpoints GRVT-specific (NO funcionan para Binance)

| Endpoint | Motivo | Impacto |
|---|---|---|
| `GET /api/v2/balance` | Hardcodeado a `grvtClient.getBalance()` | Binance nunca verá su balance |
| `POST /api/v2/backtest` | Hardcodeado a `grvtClient.getKlines()` | Backtest solo para GRVT |
| `POST /api/v2/admin/manual-trade` | Hardcodeado a GRVT `createOrder()` | Admin no puede tradear en Binance |
| `POST /api/v2/admin/backfill-fills` | Hardcodeado a `grvtClient.getFillHistory()` | Solo GRVT fills |
| `POST /api/v2/auth/grvt-credentials` | Solo GRVT tiene este auth flow | |
| `DELETE /api/v2/auth/grvt-credentials` | Solo GRVT | |
| `GET /api/v2/auth/grvt-sub-accounts` | Solo GRVT | |
| `POST /api/v2/auth/grvt-sub-accounts` | Solo GRVT | |
| `PATCH /api/v2/auth/grvt-sub-accounts/:id` | Solo GRVT | |
| `DELETE /api/v2/auth/grvt-sub-accounts/:id` | Solo GRVT | |
| `POST /api/v2/auth/login` | Solo GRVT credentials check | Login asume GRVT |
| `POST /api/v2/auth/signup` | Solo GRVT credentials check | Signup asume GRVT |
| `GET /api/v2/metrics` | Campos hardcodeados "grvt_" prefix | Labels dicen "grvt_" |

### 1.3 Endpoints auth (compartidos pero GRVT-centric)

| Endpoint | Problema |
|---|---|
| `GET /api/v2/auth/me` | `hasGrvtCreds` booleano — no hay `hasBinanceCreds` |
| `POST /api/v2/auth/signup` | Response incluye `hasGrvtCreds: false` |
| `POST /api/v2/auth/login` | Response incluye `hasGrvtCreds` |

---

## 2. Tipos Frontend (api-types.ts) — Mapeo de Campos

### 2.1 SharedBotSummary (`BotSummary`)

**Campos compartidos reales** (funcionan para GRVT y Binance):

| Campo | Tipo | Origen DB | Exchange |
|---|---|---|---|
| `id` | `number` | `grid_bots.id` | SHARED |
| `pair` | `string` | `grid_bots.pair` | SHARED |
| `status` | `BotStatus` | `grid_bots.status` | SHARED |
| `lower_price` | `number` | `grid_bots.lower_price` | SHARED |
| `upper_price` | `number` | `grid_bots.upper_price` | SHARED |
| `num_grids` | `number` | `grid_bots.num_grids` | SHARED |
| `investment_usdt` | `number` | `grid_bots.investment_usdt` | SHARED |
| `grid_profit_usdt` | `number` | `grid_bots.grid_profit_usdt` | SHARED |
| `total_pnl_usdt` | `number` | `grid_bots.total_pnl_usdt` | SHARED |
| `position_size` | `number` | `grid_bots.position_size` | SHARED |
| `created_at` / `updated_at` | `string` | `grid_bots.*` | SHARED |
| `quantity_per_level` | `number?` | `grid_bots.quantity_per_level` | SHARED |
| `compound_pct` / `compound_threshold_usdt` / `compound_interval_hours` | `number?` | DB | SHARED |
| `last_compound_at` | `string?` | DB | SHARED |
| `total_reinvested` | `number?` | DB | SHARED |
| `original_investment_usdt` | `number?` | DB | SHARED |
| `auto_shift_enabled` / `auto_shift_pct` / `last_auto_shift_at` | varios | DB | SHARED |
| `sl_pct` / `tp_pct` | `number?` | DB | SHARED |
| `virtual_enabled` / `active_window_size` | varios | DB | SHARED |
| `exchange` | `Exchange?` | `grid_bots.exchange` | SHARED |

**Campos GRVT-only** (no existen conceptualmente en Binance Spot):

| Campo | Justificación |
|---|---|
| `direction: 'long' | 'short'` | Binance Spot no tiene direction — solo compra/venta |
| `leverage: number` | Binance Spot no tiene leverage (es 1x siempre) |
| `trend_pnl_usdt: number` | Unrealized PnL de futuros — no aplica en Spot |
| `avg_entry_price: number` | Futures concept — en Spot es precio de compra promedio |
| `liquidation_price: number | null` | No existe en Spot |
| `grvt_sub_account_id: number | null` | Solo GRVT |
| `grvt_network: GrvtNetwork` | Solo GRVT |

**Campos ausentes en BotSummary** (Binance-specific, existen en DB pero NO en SELECT de /bots):

| Campo DB | Incluido en GET /bots? | En BotSummary? |
|---|---|---|
| `capital_usdc` | ❌ No en SELECT | ❌ No |
| `capital_token` | ❌ No en SELECT | ❌ No |
| `total_base_bought` | ❌ No en SELECT | ❌ No |
| `total_base_sold` | ❌ No en SELECT | ❌ No |
| `realized_pnl` | ❌ No en SELECT | ❌ No |

### 2.2 GridLevel (api-types.ts)

| Campo | Exchange |
|---|---|
| `id`, `level_index`, `price`, `side`, `quantity`, `is_filled`, `pending_replace`, `order_id`, `state` | SHARED |

### 2.3 RangeUpdatePlan

| Campo | Exchange |
|---|---|
| `botId`, `currentRange`, `newRange` | SHARED |
| `currentPrice`, `currentPosition` | SHARED |
| `newSellLevels`, `newBuyLevels`, `newTotalLevels` | SHARED |
| `newSpacing`, `canonicalQty` | SHARED |
| `ethNeeded`, `ethDeficit`, `ethExcess` | **LEGACY** — nombrado "ETH" (hardcodeado) |
| `autoBuy` | GRVT-only (market buy logic) |
| `ordersToCancel`, `ordersToCancelSample` | SHARED |
| `levelsToCreate`, `warnings`, `safetyViolations`, `noop` | SHARED |

### 2.4 PortfolioSummary

| Campo | Exchange |
|---|---|
| `botCount`, `runningCount` | SHARED |
| `totalInvested` | SHARED |
| `totalEquity` = `investment + grid_profit + trend_pnl` | **GRVT-centric** — trend_pnl no existe en Spot |
| `totalRealized` = sum `grid_profit_usdt` | SHARED (concepto) |
| `totalUnrealized` = sum `trend_pnl_usdt` | GRVT-only |
| `totalPositionUsdt` = `position_size * avg_entry_price` | GRVT-centric |
| `avgLeverage` | GRVT-only |
| `pairExposure` | SHARED |

### 2.5 Types ausentes (no existen en frontend)

- **BinanceBotDetail** — no existe tipo separado
- **GRVT credentials type** — existe como `GrvtSubAccount` pero no como auth shape
- **Balance response** — tipado como `{ balance: unknown }` (genérico)

---

## 3. Shape Real de DB (grid_bots)

### 3.1 Todas las columnas de grid_bots

| Columna | Tipo | Exchange | Propósito |
|---|---|---|---|
| `id` | INTEGER | SHARED | PK |
| `user_id` | INTEGER? | SHARED | Multi-tenant FK |
| `pair` | TEXT | SHARED | e.g. "ETH_USDT_Perp" o "XLMUSDC" |
| `direction` | TEXT | **GRVT** | 'long'/'short' — no aplica Spot |
| `leverage` | INTEGER | **GRVT** | 1-50x — Spot siempre 1x |
| `lower_price` | REAL | SHARED | |
| `upper_price` | REAL | SHARED | |
| `num_grids` | INTEGER | SHARED | |
| `investment_usdt` | REAL | SHARED | |
| `grid_profit_usdt` | REAL | SHARED | |
| `trend_pnl_usdt` | REAL | **GRVT** | Unrealized PnL |
| `total_pnl_usdt` | REAL | SHARED | grid + trend |
| `status` | TEXT | SHARED | paused/running/stopped |
| `position_size` | REAL | SHARED | En Spot: cantidad token |
| `avg_entry_price` | REAL | SHARED | En Spot: precio promedio compra |
| `liquidation_price` | REAL | **GRVT** | No existe en Spot |
| `params_json` | TEXT | SHARED | JSON blob legacy |
| `quantity_per_level` | REAL? | SHARED | |
| `compound_pct` | REAL? | SHARED | |
| `compound_threshold_usdt` | REAL? | SHARED | |
| `compound_interval_hours` | REAL? | SHARED | |
| `last_compound_at` | TEXT? | SHARED | |
| `total_reinvested` | REAL? | SHARED | |
| `original_investment_usdt` | REAL? | SHARED | |
| `safeguard_enabled` | INTEGER? | SHARED | |
| `safeguard_threshold_pct` | REAL? | SHARED | |
| `safeguard_action` | TEXT? | SHARED | |
| `alert_drawdown_pct` | REAL? | SHARED | |
| `alert_fill_batch` | INTEGER? | SHARED | |
| `alert_liq_proximity_pct` | REAL? | SHARED | |
| `sl_pct` | REAL? | SHARED | |
| `tp_pct` | REAL? | SHARED | |
| `auto_shift_enabled` | INTEGER? | SHARED | |
| `auto_shift_pct` | REAL? | SHARED | |
| `last_auto_shift_at` | INTEGER? | SHARED | |
| `bot_type` | TEXT? | SHARED | 'grid'/'dca' |
| `dca_amount_usdt` | REAL? | SHARED | |
| `dca_interval_hours` | REAL? | SHARED | |
| `last_dca_at` | TEXT? | SHARED | |
| `virtual_enabled` | INTEGER? | SHARED | |
| `active_window_size` | INTEGER? | SHARED | |
| `grvt_sub_account_id` | INTEGER? | **GRVT** | FK a sub-accounts |
| `grvt_network` | TEXT? | **GRVT** | 'testnet'/'mainnet' |
| `exchange` | TEXT? | SHARED | 'grvt'/'binance' |
| **`capital_usdc`** | REAL? | **Binance** | USDC aislado para este bot |
| **`capital_token`** | REAL? | **Binance** | Token holdings aislados |
| **`total_base_bought`** | REAL? | **Binance** | Compras acumuladas |
| **`total_base_sold`** | REAL? | **Binance** | Ventas acumuladas |
| **`realized_pnl`** | REAL? | **Binance** | PnL realizado en USDC |

### 3.2 Tablas auxiliares

| Tabla | Exchange | Notas |
|---|---|---|
| `grid_levels` | SHARED | Misma estructura para ambos exchanges |
| `orders` | SHARED | Misma estructura |
| `trades` | SHARED | Misma estructura |
| `funding_history` | **GRVT** | Binance Spot no tiene funding |
| `daily_snapshots` | SHARED | Equity, PnL diario |
| `fills_archive` | SHARED | Fills históricos |
| `paired_roundtrips` | SHARED | Round trips |
| `bot_cash_movements` | SHARED | Ledger de movimientos |
| `grvt_credentials` | **GRVT** | Credenciales cifradas GRVT |
| `grvt_sub_accounts` | **GRVT** | Sub-cuentas GRVT |
| `users` | SHARED | Auth |
| `terms_acceptances` | SHARED | TOS audit trail |
| `password_reset_tokens` | SHARED | Password reset |

---

## 4. IExchangeClient Interface — El Contrato Compartido Real

El único contrato compartido real entre exchanges es `IExchangeClient` (exchange-client.interface.ts).

**Métodos del contrato:**

```
getInstruments()     → Instrument[]
getTicker(symbol)    → Ticker
getKlines(symbol, interval, limit?) → Kline[]
getBalance()         → Balance
getPosition(symbol)  → Position | null
createOrder(params)  → Order
cancelOrder(id, sym) → void
getOpenOrders(symbol?) → Order[]
getFillHistory(symbol?, limit?) → Fill[]
subscribeTicker(symbol, cb) → void
subscribeOrders(symbol, cb) → void
unsubscribeTicker(symbol) → void
unsubscribeOrders(symbol) → void
disconnect()         → void
normalizeSymbol(pair)  → string
displaySymbol(symbol)  → string
```

**Problemas conocidos:**
- GRVT no implementa `IExchangeClient` — el factory usa `grvtClient as unknown as IExchangeClient`
- El cast burdo (`as unknown as`) se menciona en la factory como tracked en Kanban
- `Balance` y `Position` están diseñados para futuros (margin, leverage, liquidation) — Spot devuelve valores default/1

---

## 5. Read-Models Normalizados Propuestos

### SharedBotSummary
```typescript
interface SharedBotSummary {
  // Shared — ambos exchanges
  id: number;
  pair: string;
  exchange: 'grvt' | 'binance';
  status: BotStatus;
  lowerPrice: number;
  upperPrice: number;
  numGrids: number;
  investmentUsdt: number;
  gridProfitUsdt: number;
  totalPnlUsdt: number;
  positionSize: number;
  avgEntryPrice: number;
  quantityPerLevel?: number;
  createdAt: string;
  updatedAt: string;
  compoundPct?: number;
  slPct?: number | null;
  tpPct?: number | null;
  virtualEnabled?: 0 | 1;
  activeWindowSize?: number | null;
}
```

### BinanceBotDetail (extends SharedBotSummary)
```typescript
interface BinanceBotDetail extends SharedBotSummary {
  exchange: 'binance';
  // Spot-specific capital isolation
  capitalUsdc?: number;
  capitalToken?: number;
  totalBaseBought?: number;
  totalBaseSold?: number;
  realizedPnl?: number;
}
```

### GrvtBotDetail (extends SharedBotSummary)
```typescript
interface GrvtBotDetail extends SharedBotSummary {
  exchange: 'grvt';
  // Perpetual futures specific
  direction: 'long' | 'short';
  leverage: number;
  trendPnlUsdt: number;
  liquidationPrice: number | null;
  grvtSubAccountId?: number | null;
  grvtNetwork?: 'testnet' | 'mainnet';
  lastCompoundAt?: string | null;
  totalReinvested?: number;
  originalInvestmentUsdt?: number;
  autoShiftEnabled?: 0 | 1;
  autoShiftPct?: number | null;
  lastAutoShiftAt?: number | null;
  dcaAmountUsdt?: number | null;
  dcaIntervalHours?: number | null;
  lastDcaAt?: string | null;
}
```

### SharedOrderView
```typescript
interface SharedOrderView {
  id: number;
  orderId: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  quantity: number;
  price: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  gridLevelId: number | null;
  createdAt: string;
  updatedAt: string;
}
```
→ Ya existe como `OrderRow` en api-types.ts. No necesita cambios.

### SharedFillView
```typescript
interface SharedFillView {
  id: number;
  fillId: string;
  eventTime: string;
  isBuyer: 0 | 1;
  price: number;
  size: number;
  fee: number;
  createdAt: string;
}
```
→ Ya existe como `FillRow` en api-types.ts. No necesita cambios.

### ExchangeCapabilities
```typescript
interface ExchangeCapabilities {
  id: 'grvt' | 'binance';
  supportsLeverage: boolean;
  supportsDirection: boolean;
  supportsLiquidation: boolean;
  supportsFunding: boolean;
  supportsSubAccounts: boolean;
  supportSSpotIsolatedCapital: boolean;
  defaultCurrency: 'USDT' | 'USDC';
  maxOpenOrders: number;
  maxGridsVirtual: number;
  maxGridsStandard: number;
}
```

---

## 6. Endpoints: Compartidos vs Separables

### Endpoints que PUEDEN seguir compartidos (solo cambiar forma de response)

| Endpoint | Cambio necesario |
|---|---|
| `GET /api/v2/bots` | Response debe ser `SharedBotSummary[]` — filtrar fields GRVT cuando exchange='binance' |
| `GET /api/v2/bots/:id` | Response debe ser `BinanceBotDetail | GrvtBotDetail` según exchange |
| `GET /api/v2/portfolio-summary` | Calcular equity diferente para Spot (sin trend_pnl, sin avgLeverage) |
| `GET /api/v2/bots/:id/funding` | Para Binance: devolver array vacío si exchange='binance' (no aplica) |
| `POST /api/v2/bots/validate` | Validación debe ser exchange-aware (sin leverage para Binance) |
| `POST /api/v2/bots` | Creation params deben variar según exchange |
| `POST /api/v2/backtest` | Proxy a Binance klines cuando exchange='binance' |
| `GET /api/v2/metrics` | Labels: cambiar "grvt_" a "grid_bot_" genérico |

### Endpoints que DEBEN separarse por exchange

| Endpoint | Razón |
|---|---|
| `GET /api/v2/balance` | Balance GRVT devuelve futuros margin; Binance devuelve Spot balances. Response shapes completamente diferentes |
| `POST /api/v2/admin/manual-trade` | Lógica de orden completamente diferente (HMAC vs EIP-712) |
| GRVT credentials endpoints | Binance usa API key/secret en env vars, no en DB cifrada |
| Login/Signup auth | El `hasGrvtCreds` debería ser `hasExchangeCredentials` genérico |

### Endpoints auth que pueden unificarse (con cambios)

| Endpoint | Cambio |
|---|---|
| `GET /api/v2/auth/me` | Reemplazar `hasGrvtCreds` por `exchangeCredentials: ('grvt' | 'binance')[]` |
| `POST /api/v2/auth/login` | Response cambiar `hasGrvtCreds` por lista genérica |
| `POST /api/v2/auth/signup` | Idem |

---

## 7. Lista de Cambios Mínimos

### Prioridad Alta (bloqueante para frontend compartido)

1. **Normalizar GET /api/v2/bots** — el SELECT debe incluir explícitamente campos compartidos SOLO. No usar SELECT * en el detail (riesgo de filtrar capital fields GRVT a bot Binance)
2. **Agregar `capital_usdc`, `capital_token`, `total_base_bought`, `total_base_sold`, `realized_pnl` al SELECT de /bots** (o a un /bots/:id separado) para Binance
3. **`direction` y `leverage` deben ser optional/null en BotSummary** — Binance Spot no los usa
4. **Portfolio-summary sin trend_pnl para bots Binance** — equity = investment + grid_profit (excluir trend_pnl)
5. **`trend_pnl_usdt` debe ser `0` en BotSummary para Binance** (no exponer campo que no aplica)

### Prioridad Media (UX correcto)

6. **Crear ExchangeCapabilities y exponerlo en /instruments o endpoint nuevo**
7. **Bot detail endpoint** — devolver `BinanceBotDetail` o `GrvtBotDetail` según `exchange`
8. **RangeUpdatePlan.ethNeeded → assetNeeded** — renombrar campo (ETH hardcodeado)
9. **Funding endpoint** — devolver vacío para Binance (sin error)
10. **Backtest endpoint** — aceptar `?exchange=binance` para proxy a Binance klines

### Prioridad Baja (limpieza)

11. **Renombrar métricas Prometheus** de `grvt_*` a `grid_bot_*` (genérico)
12. **Crear tipo `ExchangeId` compartido** entre backend y frontend
13. **Balance endpoint** — hacer exchange-aware con `?exchange=binance`
14. **IExchangeClient para GRVT** — implementarlo formalmente en vez del `as unknown as` cast

---

## 8. Legacy Fields Detectados

| Campo / Endpoint | Problema | Propuesta |
|---|---|---|
| `params_json` en grid_bots | Legacy blob — nunca usado por código nuevo | Deprecar, migrar a columnas explícitas |
| `trades` table | Congelada desde 2026-03-10 — reemplazada por `fills_archive` | Deprecar |
| `GRVT` hardcodeado en `/admin/manual-trade` | Solo GRVT | Exchange-agnostic o mover a admin GRVT |
| `grvt_` prefix en endpoints auth | `grvt-credentials`, `grvt-sub-accounts` | Genérico o namespace por exchange |
| `ethNeeded`/`ethDeficit`/`ethExcess` | ETH hardcodeado en RangeUpdatePlan | Renombrar a baseAssetNeeded |
| `total_pnl_usdt` en DB | Stale — no refresh por engine tick | Usar `grid_profit + trend_pnl` en runtime |
