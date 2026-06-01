# GRVT-Binance Grid Bots

**Self-hostable multi-exchange grid trading bot for GRVT perpetuals and Binance Spot.**

Run grid trading strategies on both GRVT (USDT perps) and Binance Spot (USDC pairs) from a single dashboard. Same engine, same features, unified UI.

---

## Features

- **Dual Exchange**: GRVT perps + Binance Spot from one dashboard
- **Grid Trading**: Configurable price range, number of grids, investment
- **Per-Bot Capital Isolation**: Binance bots track USDC/token independently (no wallet-wide overspend)
- **Virtual Grids**: Only active levels on exchange, rest virtual (reduced gas/maker fees)
- **Compound Rebalance**: Automatically reinvest grid profits
- **Stop-Loss / Take-Profit**: Per-bot safety thresholds
- **Dynamic Auto-Shift**: Grid follows price when volatility exceeds threshold
- **DCA Mode**: Time-based dollar-cost averaging
- **Multi-Sub-accounts**: Route bots through different GRVT sub-accounts
- **Real-Time Dashboard**: Candlestick charts, equity curve, fill heatmap
- **Telegram Alerts**: Fills, drawdown warnings, liquidation proximity
- **Backtesting**: Validate grid params before deploying

---

## Supported Exchanges

| Exchange | Type | Quote | Testnet | Production |
|----------|------|-------|---------|------------|
| GRVT | Perpetuals | USDT | ✅ | ✅ |
| Binance | Spot | USDC | ✅ | ✅ |

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/Mimo13/grvt-binance-bots.git
cd grvt-binance-bots
cp .env.example .env
```

### 2. Add API keys to `.env`

```env
# GRVT (get from https://testnet.grvt.io or mainnet.grvt.io)
GRVT_ENV=testnet
GRVT_PRIVATE_KEY=0x...
GRVT_API_KEY=...

# Binance Testnet (get from https://testnet.binance.vision)
BINANCE_ENV=testnet
BINANCE_TESTNET_API_KEY=...
BINANCE_TESTNET_SECRET_KEY=...

# Dashboard
DASHBOARD_API_KEY=your-secret-key
```

### 3. Start

```bash
docker compose up -d
open http://95.111.244.212:3848/dashboard/
```

The dashboard opens with **All Bots** tab. Use the **GRVT** and **Binance** tabs to filter by exchange.

### 4. Quick Start: Binance Spot Bot

```bash
# 1. Get testnet keys at https://testnet.binance.vision
# 2. Fund with testnet USDC via the faucet
# 3. Add to .env:
#    BINANCE_ENV=testnet
#    BINANCE_TESTNET_API_KEY=your_key
#    BINANCE_TESTNET_SECRET_KEY=your_secret

# 4. Create a SOLUSDC bot via dashboard or API:
#    Exchange: Binance, Pair: SOLUSDC
#    Range: $75-$90, Grids: 5, Investment: $50

# 5. Verify on exchange:
npx tsx packages/bot/tests/binance-smoke-test.ts
```

---

## Creating a Bot

1. Click **+ New Bot**
2. **Step 1 — Exchange & Pair**: Select exchange (GRVT/Binance), then select pair
   - GRVT pairs are USDT-margined (`BTC_USDT_Perp`)
   - Binance pairs are USDC-margined (`BTCUSDC`)
3. **Step 2 — Range**: Set lower/upper price and number of grids
4. **Step 3 — Config**: Set leverage, investment, and optional features
5. **Step 4 — Review**: Validate on exchange, confirm to create

Bots start in **paused** state. Navigate to the bot detail page and click **Start** to begin trading.

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the exchange-agnostic design and [docs/EXCHANGES.md](docs/EXCHANGES.md) for API differences between GRVT and Binance.

**Key design principle**: The grid engine is exchange-agnostic. All exchange-specific logic lives in `IExchangeClient` implementations (`GRVTClient`, `BinanceClient`). Adding a new exchange = implementing the interface, no engine changes needed.

---

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm run test

# Dev mode (hot reload)
npm run dev:bot     # backend
npm run dev:dashboard  # frontend
```

---

## Project Structure

```
grvt-binance-bots/
├── packages/
│   ├── bot/                 # Trading engine + REST + WebSocket
│   │   └── src/
│   │       ├── api/         # Exchange client abstraction
│   │       │   ├── exchange-client.interface.ts
│   │       │   ├── client.ts         # GRVT implementation
│   │       │   ├── binance-client.ts # Binance implementation
│   │       │   └── exchange-client-factory.ts
│   │       ├── bot/
│   │       │   └── grid-engine.ts    # Exchange-agnostic grid logic
│   │       ├── database/
│   │       │   └── db.ts            # SQLite (exchange column)
│   │       └── server/
│   │           ├── v2-router.ts    # REST API
│   │           └── ws-dispatcher.ts # Real-time updates
│   │
│   ├── dashboard/          # React SPA
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── overview.tsx      # Exchange tabs
│   │       │   ├── bots-list.tsx     # Exchange filter
│   │       │   └── bot-detail.tsx    # Exchange badge
│   │       └── components/
│   │           └── create-bot-wizard.tsx  # Exchange + pair selector
│   │
│   └── notifier/           # Telegram sidecar
│
├── docs/
│   ├── ARCHITECTURE.md      # Exchange-agnostic design
│   ├── EXCHANGES.md         # GRVT vs Binance API differences
│   └── SECURITY.md          # Security notes
│
├── docker-compose.yml
└── package.json
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GRVT_ENV` | `testnet` or `mainnet` | `testnet` |
| `GRVT_PRIVATE_KEY` | Ethereum private key | `0xabc...` |
| `GRVT_API_KEY` | GRVT API key | |
| `BINANCE_ENV` | `testnet` or `mainnet` | `testnet` |
| `BINANCE_API_KEY` | Binance API key (production) | |
| `BINANCE_API_SECRET` | Binance API secret | |
| `BINANCE_TESTNET_API_KEY` | Binance testnet key | |
| `BINANCE_TESTNET_SECRET_KEY` | Binance testnet secret | |
| `DASHBOARD_API_KEY` | Dashboard auth key | |
| `TRADING_MODE` | `paper`, `testnet`, or `live` | `testnet` |

> **Note**: Binance testnet keys are generated at https://testnet.binance.vision. Testnet USDC is available via the faucet on the same site. The variable name is `BINANCE_TESTNET_SECRET_KEY` (not `BINANCE_TESTNET_API_SECRET`).

---

## Forked From

This project is a fork of [GRVTBot](https://github.com/Mimo13/GRVTBot) with dual exchange support added. The original GRVT-only implementation remains compatible.

---

## License

AGPL-3.0-or-later