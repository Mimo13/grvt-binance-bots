# Diseño Frontend: Dashboard Compartido + Páginas Operativas Separadas Binance/GRVT

> **Estado:** Aprobado para implementación  
> **Fecha:** 2026-06-02  
> **Contexto:** ADR-001 (Opción C) + Inventario de Contratos (API-DB-UI-CONTRACT-INVENTORY.md)  
> **Padres:** t_4a3e70a1 (inventario), t_cc98c1dd (ADR-001)  
> **Esta tarea:** t_17820b09

---

## 1. Diagnóstico Actual

### 1.1 Tamaño y Acoplamiento

| Archivo | Líneas | Problema |
|---------|--------|----------|
| `bot-detail.tsx` | **1,713** | Monolito: page + hooks + 12 sub-componentes inline. Todo exchange comparte el mismo render. |
| `create-bot-wizard.tsx` | **1,069** | Ya tiene branching exchange-aware (StepPair con selector), pero todo en un archivo. |
| `App.tsx` | 180 | Un solo route `/bots/:id` → BotDetailPage. No hay bifurcación por exchange. |

### 1.2 Exchange-Specific Fields en BotSummary

**GRVT-only** (aparecen en `bot-detail.tsx` render pero no aplican a Binance):
- `direction: 'long' | 'short'` — Binance Spot no tiene dirección
- `leverage: number` — Binance Spot es 1x fijo
- `trend_pnl_usdt` — unrealized PnL de futuros
- `liquidation_price` — no existe en Spot
- `grvt_sub_account_id` / `grvt_network` — solo GRVT

**Binance-only** (existen en DB pero NO expuestos al frontend):
- `capital_usdc`, `capital_token`, `total_base_bought`, `total_base_sold`, `realized_pnl`

**GRVT-only endpoints consumidos por bot-detail:**
- `/api/v2/bots/:id/funding` — funding history (Binance Spot no tiene)
- `/api/v2/bots/:id/rebate-summary` — rebates (GRVT fills)
- `/api/v2/bots/:id/realized-summary` — grid profit from fills archive

### 1.3 Secciones Exchange-Sensitive en bot-detail.tsx

| Sección | Líneas | Comportamiento Actual | Problema Binance |
|---------|--------|----------------------|------------------|
| Header | 390-405 | Muestra `direction`, `leverage`, `grvt_sub_account_id` badge | direction/leverage sin sentido, sub-account badge no aplica |
| Stat strip | 456-512 | Equity, totalPnl, realized, unrealized, position, liq price | trend_pnl/liq price no aplican |
| LiqGauge | 515-521 | Render condicional de gauge de liquidación | liquidation_price=null → no render (correcto) |
| StatsPanel | 575-583 | Sidebar con grid profit, round trips, rebates, funding | Funding siempre $0 en Spot |
| CompoundSettings | 601-604 | Compuesto reinvestment (compartido) | OK — aplica a ambos |
| RiskSettings | 609-611 | SL/TP (compartido) | OK — aplica a ambos |
| AutoShiftStatus | 615-617 | Auto-shift (compartido) | OK — aplica a ambos |
| BotDetailTabs | 619-1034 | Tabs: roundtrips, fills, orders, **funding**, snapshots | Funding tab no aplica |
| FundingTable | 1499-1599 | Tabla de pagos funding rate | GRVT-only |

---

## 2. Mapa de Rutas Propuesto

### 2.1 Rutas Compartidas (sin cambios estructurales)

```
/                               → OverviewPage         (shared)
/bots                           → BotsListPage         (shared)
/bots/:id                       → BotDetailPage        (thin router delegator)
/backtest                       → BacktestPage         (shared, actualmente GRVT-only)
/settings                       → SettingsPage         (shared)
```

### 2.2 BotDetailPage como Router Interno

```typescript
// packages/dashboard/src/pages/bot-detail.tsx (REFACTORED)
// Se convierte en un thin router que delega según bot.exchange

function BotDetailPage() {
  const { id } = useParams();
  const botId = Number(id);
  const botQuery = useQuery({ queryKey: ['bot', botId], queryFn: () => api.getBot(botId) });

  if (botQuery.isPending) return <PageSkeleton />;
  if (botQuery.isError) return <ErrorCard error={botQuery.error} />;

  const exchange = botQuery.data.bot.exchange ?? 'grvt';

  // Render condicional — cada página importa sus propios hooks
  return exchange === 'binance'
    ? <BinanceBotDetailPage botId={botId} bot={botQuery.data.bot} />
    : <GrvtBotDetailPage botId={botId} bot={botQuery.data.bot} />;
}
```

### 2.3 Estructura de Archivos Propuesta

```
packages/dashboard/src/
├── pages/
│   ├── bot-detail.tsx               ← REFACTORED: thin router (delega por exchange)
│   ├── bot-detail/
│   │   ├── binance-bot-detail.tsx    ← NUEVO: página detalle Binance
│   │   ├── grvt-bot-detail.tsx       ← NUEVO: página detalle GRVT (hereda lógica actual)
│   │   └── index.ts                  ← re-export
│   └── ... (overview, bots-list, settings, etc.)
│
├── components/
│   ├── bot-detail/                   ← NUEVO: sub-componentes extraídos
│   │   ├── bot-detail-header.tsx      ← Header (exchange-adaptive)
│   │   ├── bot-detail-stats.tsx       ← Stat strip (exchange-adaptive)
│   │   ├── compound-settings.tsx      ← Extraído de bot-detail.tsx
│   │   ├── risk-settings.tsx          ← Extraído de bot-detail.tsx
│   │   ├── auto-shift-status.tsx      ← Extraído de bot-detail.tsx
│   │   ├── tabs/
│   │   │   ├── grvt-bot-tabs.tsx      ← Tabs GRVT (incluye Funding)
│   │   │   ├── binance-bot-tabs.tsx   ← Tabs Binance (sin Funding)
│   │   │   ├── roundtrips-table.tsx   ← Extraído
│   │   │   ├── fills-table.tsx        ← Extraído
│   │   │   ├── orders-table.tsx       ← Extraído
│   │   │   ├── funding-table.tsx      ← Extraído (GRVT-only)
│   │   │   └── snapshots-table.tsx    ← Extraído
│   │   ├── equity-curve.tsx           ← Extraído (BotDetailEquityCurve)
│   │   └── update-range-section.tsx   ← Extraído
│   │
│   ├── stats/
│   │   ├── binance-stats-panel.tsx    ← NUEVO: stats Binance (capital isolation)
│   │   └── grvt-stats-panel.tsx       ← NUEVO: stats GRVT (funding, rebates)
│   │
│   └── ... (existing: create-bot-wizard, update-range-dialog, etc.)
│
└── lib/
    └── api-types.ts                  ← ACTUALIZAR: añadir tipos separados
```

---

## 3. Split de Componentes por Exchange

### 3.1 Componentes Puramente Visuales (compartidos, sin cambios)

| Componente | Archivo | Uso |
|-----------|---------|-----|
| GridChart | charts/grid-chart.tsx | Ambos exchanges |
| EquityCurve | charts/equity-curve.tsx | Ambos |
| FillHeatmap | charts/fill-heatmap.tsx | Ambos |
| LiqGauge | charts/liq-gauge.tsx | Solo GRVT (render condicional) |
| StatCard | primitives/stat-card.tsx | Ambos |
| StatusPill | primitives/status-pill.tsx | Ambos |
| DataTable | primitives/data-table.tsx | Ambos |
| BotCard | bot-card.tsx | Ambos (ya tiene exchange badge) |

### 3.2 Componentes con Reglas de Negocio por Exchange

| Componente | Binance | GRVT |
|-----------|---------|------|
| **BotDetailHeader** | Exchange badge "Binance" + par + status. NO muestra direction/leverage. Muestra `capital_usdc` si disponible. | Exchange badge "GRVT" + par + status + direction + leverage + sub-account badge |
| **BotDetailStats** | Equity, Position (en tokens), Grid Profit, Realized PnL (USDC), Capital USDC, Capital Token | Equity, Total PnL, Realized Grid Profit, Unrealized, Position, Avg Entry, Liquidation Price |
| **StatsPanel** | Capital isolation stats + simple grid profit. Sin funding, sin rebates. | Grid profit net/gross, round trips, avg per pair, maker rebate, funding |
| **Tabs** | Roundtrips, Fills, Orders, Snapshots (sin Funding) | Roundtrips, Fills, Orders, **Funding**, Snapshots |
| **LiqGauge** | No render (liquidation_price es null) | Render condicional si liquidation_price > 0 |

### 3.3 Componentes Compartidos (lógica de negocio exchange-agnostic)

| Componente | Notas |
|-----------|-------|
| CompoundSettings | Funciona igual en ambos exchanges |
| RiskSettings (SL/TP) | Funciona igual — son porcentajes de inversión |
| AutoShiftStatus | Funciona igual — read-only del estado |
| UpdateRangeDialog | Funciona igual — exchange-agnostic |
| RoundtripsTable | Datos compartidos |
| FillsTable | Datos compartidos |
| OrdersTable | Datos compartidos |
| SnapshotsTable | Datos compartidos |

---

## 4. Datos y Acciones por Página

### 4.1 BinanceBotDetailPage

**Datos que consume:**
- `GET /api/v2/bots/:id` → BotSummary con `capital_usdc`, `capital_token`, `total_base_bought`, `total_base_sold`, `realized_pnl` (campos que actualmente NO están en SELECT — **requiere cambio backend**)
- `GET /api/v2/bots/:id/grid-state` → GridState (compartido)
- `GET /api/v2/bots/:id/candles` → con `?exchange=binance`
- `GET /api/v2/bots/:id/roundtrips` → Roundtrip[] (compartido)
- `GET /api/v2/bots/:id/fills` → FillRow[] (compartido)
- `GET /api/v2/bots/:id/orders` → OrderRow[] (compartido)
- `GET /api/v2/bots/:id/snapshots` → DailySnapshot[] (compartido)

**Acciones:**
- Start/Pause/Close bot (compartido vía engine)
- Update range (compartido)
- Update compound, SL/TP, auto-shift (compartido)

### 4.2 GrvtBotDetailPage (≈ bot-detail.tsx actual)

**Datos que consume (todo lo actual + funding):**
- `GET /api/v2/bots/:id` → BotSummary completo con campos GRVT
- `GET /api/v2/bots/:id/grid-state` → GridState
- `GET /api/v2/bots/:id/candles` → (sin exchange param = GRVT default)
- `GET /api/v2/bots/:id/roundtrips` → Roundtrip[]
- `GET /api/v2/bots/:id/fills` → FillRow[]
- `GET /api/v2/bots/:id/orders` → OrderRow[]
- `GET /api/v2/bots/:id/funding` → FundingRow[]
- `GET /api/v2/bots/:id/rebate-summary` → RebateSummary
- `GET /api/v2/bots/:id/realized-summary` → RealizedSummary
- `GET /api/v2/bots/:id/snapshots` → DailySnapshot[]

**Acciones:**
- Start/Pause/Close bot (compartido)
- Update range (compartido)
- Update compound, SL/TP, auto-shift (compartido)

### 4.3 CreateBotWizard (ya exchange-aware)

Sin cambios estructurales. El wizard ya:
- Tiene selector de exchange (GRVT/Binance) en StepPair
- Filtra instruments según exchange
- Muestra network selector GRVT vs label "Red Binance"
- Oculta sub-account picker para Binance
- Envía `exchange` field en POST /bots

**Mejora opcional:** Extraer los steps a archivos separados (`wizard/step-pair.tsx`, `wizard/step-range.tsx`, etc.) para reducir tamaño, pero no es bloqueante.

---

## 5. UX para Listado Compartido

### 5.1 Estado Actual (Overview + BotsList)

El Overview ya tiene filtro por exchange (tabs All / GRVT / Binance) — implementado en [OverviewPage.tsx](https://github.com/Mimo13/grvt-binance-bots/blob/main/packages/dashboard/src/pages/overview.tsx).

El BotsListPage muestra todos los bots. BotCard ya muestra exchange badge.

### 5.2 Propuesta

**No hay cambios urgentes en el listado.** La UX actual es correcta:
1. **Overview:** Stat strip global + BotCard grid + filtro All/GRVT/Binance + equity curve
2. **BotsList:** Flat grid con BotCards + create CTA
3. **Cada BotCard** ya muestra exchange badge (GRVT badge o Binance badge)
4. **Click en BotCard** → navega a `/bots/:id` → BotDetailPage decide qué render

**Mejora futura (post-Fase 6):**
- BotCard podría mostrar estadísticas exchange-adaptativas:
  - Binance: capital_usdc + grid profit
  - GRVT: leverage + direction + total PnL

---

## 6. Estrategia de Migración — 4 Fases

### Fase 1: Extracción de sub-componentes (sin cambios de lógica)
**Riesgo:** Bajo — puro refactor mecánico

1. Crear directorio `components/bot-detail/`
2. Extraer de `bot-detail.tsx` a archivos separados:
   - `compound-settings.tsx` (CompoundSettings, ~150 líneas)
   - `risk-settings.tsx` (RiskSettings, ~95 líneas)
   - `auto-shift-status.tsx` (AutoShiftStatus, ~25 líneas)
   - `tabs/roundtrips-table.tsx`
   - `tabs/fills-table.tsx`
   - `tabs/orders-table.tsx`
   - `tabs/funding-table.tsx`
   - `tabs/snapshots-table.tsx`
   - `equity-curve-section.tsx` (BotDetailEquityCurve)
   - `fill-heatmap-section.tsx`
   - `page-skeleton.tsx`
3. bot-detail.tsx pasa de 1,713 → ~400 líneas (solo BotDetailPage + BotDetailTabs)

### Fase 2: Router por Exchange
**Riesgo:** Medio — requiere coordinar data fetching

1. Crear `pages/bot-detail/binance-bot-detail.tsx` y `pages/bot-detail/grvt-bot-detail.tsx`
2. bot-detail.tsx se convierte en delegator:
   - Lee `botQuery.data.bot.exchange`
   - Renderiza `BinanceBotDetailPage` o `GrvtBotDetailPage`
3. Cada página importa los sub-componentes compartidos y añade secciones exchange-specific
4. **GrvtBotDetailPage** = bot-detail.tsx actual con imports externos
5. **BinanceBotDetailPage** = misma estructura pero:
   - Sin LiqGauge
   - Sin Funding tab
   - Header sin direction/leverage
   - Stats sin trend_pnl
   - Con sección de "Capital" (capital_usdc, capital_token)

### Fase 3: Tipos Separados
**Riesgo:** Bajo — solo api-types.ts + data fetching

1. Añadir tipos en api-types.ts:
   ```typescript
   interface BinanceBotDetail extends BotSummary {
     exchange: 'binance';
     capital_usdc?: number;
     capital_token?: number;
     total_base_bought?: number;
     total_base_sold?: number;
     realized_pnl?: number;
   }
   interface GrvtBotDetail extends BotSummary {
     exchange: 'grvt';
     direction: 'long' | 'short';
     leverage: number;
     trend_pnl_usdt: number;
     liquidation_price: number | null;
     grvt_sub_account_id?: number | null;
     grvt_network?: 'testnet' | 'mainnet';
   }
   ```
2. Actualizar `api.getBot()` para retornar tipo unión
3. Ajustar queries en BinanceBotDetailPage para no pedir funding/rebate/realized

### Fase 4: StatsPanel Separado
**Riesgo:** Medio — requiere entender si realized-summary funciona para Binance

1. Crear `components/stats/binance-stats-panel.tsx`:
   - Muestra capital_usdc disponible, capital_token, base bought/sold
   - Grid profit simple (sin rebates)
   - Sin funding
2. Crear `components/stats/grvt-stats-panel.tsx`:
   - Igual a StatsPanel actual (funding, rebates, realized, round trips)
3. BotDetailTabs → GrvtBotTabs y BinanceBotTabs

---

## 7. Dependencias y Bloqueantes

| # | Bloqueante | Dueño | Para Fase |
|---|-----------|-------|-----------|
| 1 | Backend: incluir `capital_usdc`, `capital_token`, `total_base_bought`, `total_base_sold`, `realized_pnl` en SELECT de GET /bots/:id | Backend | Fase 3 |
| 2 | Backend: expone `exchange` en GridState response (ya existe? revisar) | Backend | Fase 2 |
| 3 | Confirmar que realized-summary funciona para Binance (fills_archive tiene datos) | Frontend+Backend | Fase 4 |
| 4 | Backtest para Binance (postergado — no es blocker para este split) | Backend | Futuro |

---

## 8. Árbol de Componentes Final

```
App.tsx
├── ProtectedRoute (auth)
│   └── AppShell
│       ├── Header (compartido)
│       ├── Sidebar (compartido)
│       └── Outlet
│           ├── OverviewPage
│           │   ├── StatCard x6
│           │   ├── ExchangeFilter (All/GRVT/Binance)
│           │   ├── BotCard x N
│           │   └── EquityCurve
│           │
│           ├── BotsListPage
│           │   ├── BotCard x N
│           │   └── CreateBotWizard (lazy)
│           │
│           ├── BotDetailPage (delegator)
│           │   ├── BinanceBotDetailPage       ← exchange === 'binance'
│           │   │   ├── BotDetailHeader (sin direction/leverage)
│           │   │   ├── BotDetailStats (sin trend_pnl/liq)
│           │   │   ├── GridChart (compartido)
│           │   │   ├── BinanceStatsPanel (capital + grid profit)
│           │   │   ├── BinanceBotTabs (sin funding)
│           │   │   ├── CompoundSettings (compartido)
│           │   │   ├── RiskSettings (compartido)
│           │   │   └── UpdateRangeDialog (compartido)
│           │   │
│           │   └── GrvtBotDetailPage          ← exchange === 'grvt' (default)
│           │       ├── BotDetailHeader (con direction/leverage/sub-account)
│           │       ├── BotDetailStats (con trend_pnl/liq)
│           │       ├── LiqGauge (condicional)
│           │       ├── GridChart (compartido)
│           │       ├── GrvtStatsPanel (funding + rebates + realized)
│           │       ├── GrvtBotTabs (con funding)
│           │       ├── CompoundSettings (compartido)
│           │       ├── RiskSettings (compartido)
│           │       ├── AutoShiftStatus (compartido)
│           │       └── UpdateRangeDialog (compartido)
│           │
│           ├── BacktestPage (lazy)
│           └── SettingsPage
```

---

## 9. Resumen de Cambios por Archivo

| Archivo | Acción | Líneas aprox |
|---------|--------|-------------|
| `pages/bot-detail.tsx` | REFACTOR → thin delegator | 1,713 → ~120 |
| `pages/bot-detail/binance-bot-detail.tsx` | CREATE | ~300 |
| `pages/bot-detail/grvt-bot-detail.tsx` | CREATE (hereda lógica actual) | ~500 |
| `components/bot-detail/compound-settings.tsx` | CREATE (extraído) | ~150 |
| `components/bot-detail/risk-settings.tsx` | CREATE (extraído) | ~95 |
| `components/bot-detail/auto-shift-status.tsx` | CREATE (extraído) | ~25 |
| `components/bot-detail/tabs/roundtrips-table.tsx` | CREATE (extraído) | ~100 |
| `components/bot-detail/tabs/fills-table.tsx` | CREATE (extraído) | ~140 |
| `components/bot-detail/tabs/orders-table.tsx` | CREATE (extraído) | ~120 |
| `components/bot-detail/tabs/funding-table.tsx` | CREATE (extraído) | ~100 |
| `components/bot-detail/tabs/snapshots-table.tsx` | CREATE (extraído) | ~80 |
| `components/bot-detail/tabs/binance-bot-tabs.tsx` | CREATE | ~80 |
| `components/bot-detail/tabs/grvt-bot-tabs.tsx` | CREATE | ~100 |
| `components/bot-detail/equity-curve-section.tsx` | CREATE (extraído) | ~30 |
| `components/bot-detail/update-range-section.tsx` | CREATE (extraído) | ~30 |
| `components/bot-detail/page-skeleton.tsx` | CREATE (extraído) | ~30 |
| `components/stats/binance-stats-panel.tsx` | CREATE | ~80 |
| `components/stats/grvt-stats-panel.tsx` | CREATE (≈ StatsPanel actual) | ~150 |
| `components/stats-panel.tsx` | DELETE (replaced by grvt-stats-panel) | — |
| `lib/api-types.ts` | UPDATE: añadir BinanceBotDetail, GrvtBotDetail | +40 |

**Total líneas nuevas:** ~1,100 (incluyendo extracciones)  
**Total líneas eliminadas:** ~1,713 (bot-detail.tsx antiguo) + 146 (stats-panel.tsx)  
**Neto:** ~+300 líneas (por los wrappers y tipos)
