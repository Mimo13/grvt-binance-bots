# ADR-001: Arquitectura Binance + GRVT — Dashboard Compartido, Operación Separada

**Estado:** Aprobado
**Fecha:** 2026-06-02
**Contexto:** Soportar Binance Spot y GRVT desde un mismo proyecto sin forzar que compartan motor interno.

---

## Decisión

**Opción C — Dashboard compartido con páginas operativas separadas y componentes UI reutilizables.**

Binance Spot y GRVT comparten:
- Shell del dashboard (layout, sidebar, header, auth)
- Listado de bots (con filtro por exchange)
- BotDetail (con badge de exchange y datos normalizados)
- Componentes primitivos (bot-card, stat-card, data-table, charts)
- API REST (v2-router) como fachada normalizada
- DB models (grid_bots con columna `exchange`)
- Notificador (Telegram/webhook, exchange-agnostic)

Cada exchange tiene su propio:
- Exchange client (`BinanceClient` / `GRVTClient` con sus respectivos auth)
- Engine runtime (el grid engine compartido, pero con ramas `if exchange === 'binance'` para comportamientos exchange-específicos)
- WebSocket lógica (diferentes streams, formatos, reconexión)
- Instrument/pair naming (BTCUSDC vs BTC_USDT_Perp)
- Capital tracking (Binance: per-bot capital isolation; GRVT: per-user sub-account margin)

## Alternativas Evaluadas

### A) Engine común exchange-agnostic completo
FORZARÍAMOS que todo exchange calce exactamente en el mismo modelo de órdenes, positions, fills, funding. Riesgo: abstracciones filtradas (leaky), condicionales por exchange creciendo sin control, dificultad para añadir exchanges con paradigma distinto (ej: DEX, CEX sin perps).

### B) Engines separados + API normalizada
Ideal si los exchanges divergen mucho. Pero hoy GRVT y Binance Spot comparten suficiente lógica de grid (spacing, qty calc, range update, compound rebalance) como para que duplicar el engine duplique bugs.

### C) Dashboard compartido + páginas separadas (elegida)
Punto dulce: el engine compartido maneja la lógica de grid universal, los exchange clients encapsulan auth/API differences, y la UI se mantiene unificada con filtros. Si un exchange requiere páginas operativas completamente diferentes (ej: DCA manual, order book), se agregan sin tocar el resto.

## Tradeoffs

| Criterio | Peso | Puntaje | Notas |
|----------|------|---------|-------|
| Riesgo operativo | Alto | ★★★★☆ | El engine compartido puede propagar bugs entre exchanges si no se testea cada rama |
| Velocidad entrega | Alto | ★★★★★ | Ya está implementado así; solo mantener dirección |
| Mantenibilidad | Medio | ★★★★☆ | Los `if (bot as any).exchange === 'binance'` son un code smell; refactorizar a strategy pattern o método virtual |
| Testabilidad | Medio | ★★★★☆ | Tests por exchange client + tests de engine con mock IExchangeClient |
| Live/Testnet | Medio | ★★★★★ | Ya resuelto: `BINANCE_ENV=testnet\|mainnet`, `grvt_network` por bot |
| Auto-balanceo futuro | Bajo | ★★★★★ | Fácil: el nuevo módulo usa IExchangeClient igual que el grid engine |

## Contrato Mínimo Compartido (Frontend)

El frontend asume que todo bot expone estos campos vía API:

```typescript
interface BotSummary {
  id: number;
  exchange: 'grvt' | 'binance';
  pair: string;
  status: 'running' | 'paused' | 'stopped' | 'error';
  investment_usdt: number;
  grid_profit_usdt: number;
  trend_pnl_usdt: number;
  total_pnl_usdt: number;
  position_size: number;
  avg_entry_price: number;
  liquidation_price: number | null;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  leverage: number;
  direction: 'long' | 'short';
  created_at: string;
  updated_at: string;
}

interface BotDetail extends BotSummary {
  // + level info, orders, fills, trades, funding
}

// Actions: Start, Stop, Pause, Close, UpdateRange
// Endpoints: POST /bots/:id/start, /pause, /close
//            POST /bots/:id/range/preview, /range/apply
```

## Páginas Separadas (Futuro)

Hoy **no hay páginas separadas** — compartimos todo el routing. Cuando la complejidad lo justifique:

- **Binance Operation Page**: dashboard específico para Spot (balance USDC, LOT_SIZE warnings, capital isolation por bot)
- **GRVT Operation Page**: funding rates, liquidation proximity, sub-account selector, leverage display

Ambas comparten AppShell, sidebar, auth, y el listado de bots (con filtro exchange=tabs).

## Migración por Fases

| Fase | Qué | Status |
|------|-----|--------|
| Fase 1 | IExchangeClient interface + BinanceClient implementation | ✅ Hecho |
| Fase 2 | DB migration: columna `exchange`, capital tracking | ✅ Hecho |
| Fase 3 | Grid engine: getClientForBot(), ramas exchange | ✅ Hecho |
| Fase 4 | V2 Router: exchange-aware /instruments, /candles, /grid-state | ✅ Hecho |
| Fase 5 | Frontend: exchange filter en Overview, selector en CreateWizard | ✅ Hecho |
| Fase 6 | Refactor: eliminar `(bot as any).exchange` casts → método virtual en IExchangeClient | 🔲 Pendiente |
| Fase 7 | Separar páginas operativas si la UI por exchange diverge | 🔲 Pendiente (monitor) |
| Fase 8 | Balance endpoint exchange-aware | 🔲 Pendiente (hoy solo GRVT) |

## Código Compartido vs No Compartido

### Compartido (single source of truth)
- `exchange-client.interface.ts` — contrato
- `exchange-client-factory.ts` — registro + cache
- `grid-engine.ts` — lógica de grid (con ramas internas)
- `v2-router.ts` — API REST normalizada
- Dashboard: AppShell, auth, bot-card, stat-card, charts, data-table
- DB: `grid_bots`, `grid_levels`, `fills_archive`, `trades`
- `notifier/` — Telegram + webhook (exchange-agnostic)

### No compartido (cada exchange)
- `binance-client.ts` vs `client.ts` (GRVT) — implementaciones IExchangeClient
- `grvt-auth.ts` (EIP-712) vs HMAC-SHA256 en binance-client.ts
- WebSocket streams (diferentes URLs, formatos, reconexión)
- Capital tracking (Binance: per-bot USDC isolation; GRVT: per-sub-account margin)
- Pair naming (normalizado en API response, nativo en client)

## Referencias

- ARCHITECTURE.md — diagrama de arquitectura actual
- EXCHANGES.md — diferencias detalladas GRVT vs Binance
- packages/bot/src/api/exchange-client.interface.ts — contrato
- packages/bot/src/api/binance-client.ts — impl Binance
- packages/bot/src/bot/grid-engine.ts — engine con ramas exchange
