# Exchange Support: GRVT vs Binance

This document covers the API and behavioral differences between GRVT and Binance that affect the grid bot implementation.

---

## Authentication

### GRVT: EIP-712 Typed Data Signatures

GRVT uses Ethereum-style EIP-712 signatures for authentication. Every request requires:

1. A signed message containing the request parameters
2. The signature + the signer's Ethereum address

```typescript
// packages/bot/src/api/grvt-auth.ts
// Uses @metamask/eth-sig-util to sign typed data
import { signTypedData } from '@metamask/eth-sig-util';

const domain = {
  name: 'GRVT Trading',
  version: '0',
  chainId: 326, // testnet
};
const message = { ... };
const signature = signTypedData({ privateKey, data: { domain, message } });
```

- **API Keys**: Ethereum private key (not an exchange API key)
- **Sub-accounts**: Multiple sub-account IDs per user
- **Encryption**: Credentials stored encrypted in `grvt_credentials` table

### Binance: HMAC-SHA256 Signed Requests

Binance uses standard HMAC-SHA256 with API key + secret. All parameters are signed.

```typescript
// packages/bot/src/api/binance-client.ts
import crypto from 'crypto';

function signBinanceRequest(params: Record<string, string>, secret: string): string {
  const queryString = new URLSearchParams(params).toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(queryString)
    .digest('hex');
  return signature;
}
```

- **API Keys**: `BINANCE_API_KEY` + `BINANCE_API_SECRET`
- **Sub-accounts**: Not applicable in the same way — Binance uses API key permissions
- **Testnet**: `BINANCE_TESTNET_API_KEY` + `BINANCE_TESTNET_SECRET_KEY`

---

## Network Endpoints

### GRVT

| Environment | Base URL | Chain ID |
|-------------|----------|----------|
| Testnet | `https://edge.testnet.grvt.io` | 326 |
| Mainnet | `https://edge.grvt.io` | 325 |

Market data: `https://market-data.testnet.grvt.io/full/v1`
Trading: `https://trades.testnet.grvt.io/full/v1`

### Binance

| Environment | Base URL | Notes |
|-------------|----------|-------|
| Testnet | `https://testnet.binance.vision/api/v3/` | No signature required for public |
| Testnet WS | `wss://testnet.binance.vision/ws` | |
| Spot Testnet | `https://testnet.binance.vision` | USDC-margined perpetual futures |
| Mainnet | `https://fapi.binance.com` | USDC-margined perps |
| Mainnet WS | `wss://fstream.binance.com/ws` | |

For grid bots (perpetual futures):

- **Testnet**: `https://testnet.binance.vision/api/v3/` (fapi for futures)
- **Mainnet**: `https://fapi.binance.com/api/v3/`

---

## Instrument / Pair Naming

### GRVT

Format: `{BASE}_{QUOTE}_{PERP}`

Examples: `BTC_USDT_Perp`, `ETH_USDT_Perp`, `XRP_USDT_Perp`

Note: Always USDT quote. No USDC pairs on GRVT.

### Binance

Format: `{BASE}USDC` (for perpetual futures)

Examples: `BTCUSDC`, `ETHUSDC`, `XRPUSDC`

Note: Grid bots use USDC-margined perpetual futures on Binance (not USDT spot). Pairs are `{BASE}USDC`.

**Symbol conversion**:
- GRVT `BTC_USDT_Perp` → `BTCUSDT` on Binance Spot
- GRVT `BTC_USDT_Perp` → `BTCUSDC` on Binance USDⓈ-Margined Futures

---

## Market Data Differences

### Ticker

**GRVT ticker response:**
```json
{
  "instrument": "BTC_USDT_Perp",
  "bid": "95000.00",
  "ask": "95001.00",
  "last": "95000.50",
  "mark_price": "95000.75",
  "index_price": "94999.00",
  "open_interest": "12345678",
  "volume_24h": "9876543210"
}
```

**Binance ticker response:**
```json
{
  "symbol": "BTCUSDC",
  "lastPrice": "95000.00",
  "bidPrice": "94999.00",
  "askPrice": "95001.00",
  "markPrice": "95000.75",
  "indexPrice": "94999.00",
  "openInterest": "12345678",
  "volume": "98765432"
}
```

### Klines / Candlesticks

Both support standard intervals: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`.

**GRVT**: `GET /klines?instrument=BTC_USDT_Perp&interval=1h&limit=100`
**Binance**: `GET /klines?symbol=BTCUSDC&interval=1h&limit=100`

### Order Book

GRVT: Not typically used by grid bot
Binance: `GET /depth?symbol=BTCUSDC&limit=100`

---

## Order Types and Placement

### GRVT

```typescript
interface CreateOrderParams {
  sub_account_id: string;
  instrument: string;    // "BTC_USDT_Perp"
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  size: string;          // quantity as string
  price?: string;        // required for limit
  time_in_force?: 'gtc' | 'ioc' | 'fok';
  post_only?: boolean;
}
```

Orders are signed with EIP-712. Requires `signOrder()` with the user's Ethereum private key.

### Binance

```typescript
interface CreateOrderParams {
  symbol: string;        // "BTCUSDC"
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  quantity: string;
  price?: string;        // required for LIMIT
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  newOrderRespType: 'RESULT' | 'FULL';
}
```

HMAC-SHA256 signature on: `symbol + side + type + quantity + price + timestamp`

---

## Position and Balance

### GRVT

```typescript
// Balance
GET /balance
{
  sub_account_id: "123",
  total_equity: "10000.00",
  available_balance: "8000.00",
  margin_used: "2000.00",
  currency: "USDT"
}

// Position
GET /position?instrument=BTC_USDT_Perp
{
  sub_account_id: "123",
  instrument: "BTC_USDT_Perp",
  size: "0.5",
  notional: "47500.00",
  entry_price: "95000.00",
  mark_price: "95050.00",
  unrealized_pnl: "25.00",
  side: "buy",
  leverage: "10",
  liquidation_price: "85500.00"
}
```

### Binance

```typescript
// Balance (USDⓈ-Margined)
GET /fapi/v3/account
{
  "assets": [
    {
      "asset": "USDC",
      "walletBalance": "10000.00",
      "unrealizedProfit": "25.00"
    }
  ],
  "positions": [
    {
      "symbol": "BTCUSDC",
      "positionAmt": "0.5",
      "entryPrice": "95000.00",
      "markPrice": "95050.00",
      "unrealizedProfit": "25.00",
      "isolatedMargin": "200.00"
    }
  ]
}
```

---

## Fill / Trade History

### GRVT

```typescript
GET /fills?instrument=BTC_USDT_Perp&limit=50
{
  "fills": [
    {
      "fill_id": "fill_123",
      "order_id": "order_456",
      "instrument": "BTC_USDT_Perp",
      "size": "0.01",
      "price": "95000.00",
      "side": "buy",
      "fee": "0.95",
      "fee_currency": "USDT",
      "liquidity": "maker",
      "created_time": 1704067200000
    }
  ]
}
```

### Binance

```typescript
GET /fapi/v1/userTrades?symbol=BTCUSDC&limit=50
[
  {
    "id": 12345,
    "orderId": 789,
    "symbol": "BTCUSDC",
    "side": "BUY",
    "price": "95000.00",
    "qty": "0.01",
    "commission": "0.95",
    "commissionAsset": "USDC",
    "isMaker": true,
    "time": 1704067200000
  }
]
```

---

## WebSocket Feeds

### GRVT

```typescript
// Ticker
ws://edge.testnet.grvt.io/ws/v1?channel=ticker:BTC_USDT_Perp

// Orders
ws://edge.testnet.grvt.io/ws/v1?channel=orders:{sub_account_id}

// Message format
{
  "type": "ticker",
  "data": {
    "instrument": "BTC_USDT_Perp",
    "last": "95000.50",
    "bid": "95000.00",
    "ask": "95001.00"
  }
}
```

### Binance

```typescript
// Ticker streams
wss://fstream.binance.com/ws/btcusdc@ticker
wss://fstream.binance.com/ws/btcusdc@depth

// Combined stream
wss://fstream.binance.com/ws/!ticker@arr

// Account updates (requires auth)
wss://fstream.binance.com/ws/<streamKey>

// Message format
{
  "e": "24hrTicker",
  "s": "BTCUSDC",
  "c": "95000.50",
  "b": "95000.00",
  "a": "95001.00"
}
```

---

## Key Differences Summary

| Aspect | GRVT | Binance |
|--------|------|---------|
| Auth | EIP-712 (eth-sig-util) | HMAC-SHA256 |
| Quote currency | USDT | USDC |
| Pair format | `BTC_USDT_Perp` | `BTCUSDC` |
| Chain ID | 326 (testnet) | N/A |
| Order signed by | Ethereum key | API secret |
| Sub-accounts | Yes (multiple per user) | No |
| Position endpoint | `/position` | `/fapi/v3/positionRisk` |
| Fill history | `/fills` | `/fapi/v1/userTrades` |
| WS ticker channel | `ticker:{instrument}` | `{symbol}@ticker` |
| Leverage | Per-position | Per-position |
| Liquidation | Calculated by exchange | Calculated by exchange |

---

## Testing

Always test new Binance code against testnet before mainnet:

```bash
# Set in .env
BINANCE_ENV=testnet  # uses testnet.binance.vision
BINANCE_TESTNET_API_KEY=...
BINANCE_TESTNET_SECRET_KEY=...
```

Use `BNB` as the testnet asset (not real USDT/USDC) — testnet balance is artificial.