# GRVT-Binance Grid Bots

**Multi-exchange grid trading bot for GRVT and Binance perpetual futures.**

A fork of [GRVTBot](https://github.com/Mimo13/GRVTBot) extended to run both GRVT and Binance grids from a single dashboard. Same engine, same features, same API — just with exchange-aware routing.

---

## Quick Start

```bash
# Clone
git clone https://github.com/Mimo13/grvt-binance-bots.git
cd grvt-binance-bots

# Configure environment
cp .env.example .env
# Edit .env with your GRVT + Binance API keys

# Start stack
docker compose up -d

# Open dashboard
open http://95.111.244.212:3848/dashboard/
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Dashboard                           │
│  (Exchange tabs: All / GRVT / Binance)                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│                     Express + WS Server                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ V2 Router   │  │ WS Dispatcher │  │ Grid Engine          │   │
│  │ (REST API)   │  │ (Real-time)  │  │ (Per-bot tick loop)  │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         │                │                     │                │
│  ┌──────▼─────────────────▼─────────────────────▼──────────┐   │
│  │              Exchange Client Factory                    │   │
│  │  getExchangeClient(userId, exchange, subAccountId?)     │   │
│  └──────────────────┬────────────────────┬────────────────┘   │
│                    │                    │                       │
│         ┌──────────▼───────┐  ┌─────────▼────────────────┐   │
│         │   GRVT Client     │  │    Binance Client         │   │
│         │   (EIP-712 auth)  │  │    (HMAC-SHA256 auth)     │   │
│         └───────────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Exchange Adapter Pattern

Every exchange interaction goes through `IExchangeClient`. Adding a new exchange = implementing the interface, no engine changes needed.

```typescript
interface IExchangeClient {
  exchange: 'grvt' | 'binance';
  network: 'testnet' | 'mainnet';

  // Market data
  getInstruments(): Promise<Instrument[]>;
  getTicker(pair: string): Promise<Ticker>;
  getKlines(pair: string, interval: string, limit?: number): Promise<Kline[]>;

  // Account
  getBalance(): Promise<Balance>;
  getPosition(pair: string): Promise<Position | null>;

  // Orders
  createOrder(params: CreateOrderParams): Promise<Order>;
  cancelOrder(orderId: string, pair: string): Promise<void>;
  getOpenOrders(pair?: string): Promise<Order[]>;

  // Fills
  getFillHistory(pair?: string, limit?: number): Promise<Fill[]>;

  // WebSocket
  subscribeTicker(pair: string, cb: (t: Ticker) => void): void;
  subscribeOrders(pair: string, cb: (o: OrderUpdate) => void): void;
  unsubscribeTicker(pair: string): void;
  unsubscribeOrders(pair: string): void;
}
```

---

## Supported Exchanges

| Exchange | Pairs | Testnet | Auth Method | Docs |
|----------|-------|---------|-------------|------|
| GRVT | USDT perpetuals | ✅ testnet.grvt.io | EIP-712 signatures | [GRVT API](https://api.testnet.grvt.io) |
| Binance | USDC perpetuals | ✅ testnet.binance.vision | HMAC-SHA256 | [Binance API](https://developers.binance.com) |

---

## Features

- ✅ Grid trading engine with virtual grids support
- ✅ Compound rebalancing (auto-reinvest grid profits)
- ✅ Stop-loss / Take-profit per bot
- ✅ Dynamic grid auto-shift (price-following)
- ✅ DCA mode (time-based buys)
- ✅ Multiple sub-accounts per exchange
- ✅ Telegram alerts + Webhooks
- ✅ Backtesting
- ✅ Real-time dashboard with candlestick charts
- ✅ GRVT + Binance in same UI with exchange tabs

---

## Project Structure

```
grvt-binance-bots/
├── packages/
│   ├── bot/              # Trading engine + REST API + WebSocket
│   │   └── src/
│   │       ├── api/      # Exchange clients
│   │       │   ├── exchange-client.interface.ts
│   │       │   ├── client.ts           # GRVT client
│   │       │   ├── binance-client.ts   # Binance client (NEW)
│   │       │   └── exchange-client-factory.ts
│   │       ├── bot/
│   │       │   └── grid-engine.ts      # Exchange-agnostic engine
│   │       ├── database/
│   │       │   └── db.ts               # SQLite with exchange column
│   │       └── server/
│   │           ├── v2-router.ts        # REST API
│   │           └── ws-dispatcher.ts   # Real-time updates
│   │
│   ├── dashboard/         # React SPA
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── overview.tsx       # Exchange tabs (All/GRVT/Binance)
│   │       │   ├── bots-list.tsx      # Filtered by exchange
│   │       │   └── bot-detail.tsx     # Exchange badge
│   │       └── components/
│   │           └── create-bot-wizard.tsx  # Exchange → pair selector
│   │
│   └── notifier/          # Telegram sidecar (exchange-agnostic)
│
├── docs/
│   ├── ARCHITECTURE.md    # This file
│   ├── EXCHANGES.md       # GRVT vs Binance API differences
│   └── SECURITY.md        # Exchange-specific security notes
│
└── docker-compose.yml
```

---

## Environment Variables

```env
# GRVT (existing)
GRVT_ENV=testnet
GRVT_API_KEY=...
GRVT_API_SECRET=...

# Binance
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
BINANCE_TESTNET_API_KEY=...
BINANCE_TESTNET_SECRET_KEY=...

# Dashboard
DASHBOARD_API_KEY=...
BOT_PORT=3848

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

---

## Adding a New Exchange

1. Implement `IExchangeClient` in `packages/bot/src/api/<exchange>-client.ts`
2. Add to `exchange-client-factory.ts`
3. Add to DB migration (add exchange enum column)
4. Add env vars for API keys
5. Update frontend pair selector with exchange-specific pairs
6. No changes to `grid-engine.ts` required — it's exchange-agnostic

---

## License

AGPL-3.0-or-later