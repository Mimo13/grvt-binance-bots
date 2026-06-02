// GrvtExchangeAdapter — wraps GRVTClient as a proper IExchangeClient.
//
// Translates between GRVT's raw API types (snake_case, instrument-based)
// and IExchangeClient's normalized types (camelCase, symbol-based).
// This replaces the `(grvtClient as unknown as IExchangeClient)` cast
// so the type system enforces correct field accesses and no Binance
// code path can accidentally read a GRVT-only field.
//
// WebSocket methods (subscribeTicker, subscribeOrders, etc.) are stubbed
// — GRVTClient doesn't expose WS at this level; the server layer
// (ws-dispatcher.ts) handles that independently.
//
// normalizeSymbol / displaySymbol: GRVT uses BTC_USDT_Perp internally,
// display format is BTC/USDT.

import type {
  IExchangeClient,
  Instrument,
  Ticker,
  Kline,
  Balance,
  Position,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  CreateOrderParams,
  Order,
  Fill,
  OrderUpdate,
  ExchangeId,
  ExchangeNetwork,
} from './exchange-client.interface.js';
import { GRVTClient, type GrvtNetwork } from './client.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/** GRVT internal pair → display pair (e.g. "BTC_USDT_Perp" → "BTC/USDT"). */
function grvtToDisplay(grvtSymbol: string): string {
  // Strip trailing "_Perp" or similar suffix
  const base = grvtSymbol.replace(/_(Perp|Future)$/, '');
  // Replace first underscore with "/"
  const idx = base.indexOf('_');
  if (idx === -1) return grvtSymbol;
  return base.slice(0, idx) + '/' + base.slice(idx + 1);
}

/** Display pair → GRVT internal pair (e.g. "BTC/USDT" → "BTC_USDT_Perp"). */
function displayToGrvt(displayPair: string): string {
  return displayPair.replace('/', '_') + '_Perp';
}

/** Sniff the GrvtNetwork from an IExchangeClient network id. */
function toGrvtNetwork(network: ExchangeNetwork): GrvtNetwork {
  return network;
}

// ─── Type mappers ─────────────────────────────────────────────────────

function mapTicker(raw: any): Ticker {
  return {
    symbol: raw.instrument ?? '',
    lastPrice: raw.last_price ?? '0',
    bidPrice: raw.best_bid ?? '0',
    askPrice: raw.best_ask ?? '0',
    markPrice: raw.mark_price ?? '0',
    indexPrice: raw.index_price ?? '0',
    openInterest: raw.open_interest ?? '0',
    volume24h: raw.volume_24h ?? '0',
    high24h: raw.high_price ?? '0',
    low24h: raw.low_price ?? '0',
  };
}

function mapInstrument(raw: any): Instrument {
  const name = raw.instrument ?? raw.symbol ?? raw.name ?? '';
  return {
    symbol: name,
    baseCurrency: (name.split('_')[0] ?? '').split('/')[0],
    quoteCurrency: name.includes('USDT') ? 'USDT' : name.includes('USDC') ? 'USDC' : 'USDT',
    tickSize: String(raw.tick_size ?? '0.01'),
    lotSize: String(raw.base_min_size ?? raw.min_size ?? '0.01'),
    maxLeverage: Number(raw.max_leverage ?? 1),
    contractType: 'perpetual',
  };
}

function mapKline(raw: any): Kline {
  return {
    openTime: Number(raw.open_time) / 1_000_000,
    closeTime: Number(raw.close_time) / 1_000_000,
    open: String(raw.open ?? '0'),
    high: String(raw.high ?? '0'),
    low: String(raw.low ?? '0'),
    close: String(raw.close ?? '0'),
    volume: String(raw.volume_b ?? raw.volume ?? '0'),
    trades: Number(raw.trades ?? 0),
  };
}

function mapBalance(raw: any): Balance {
  return {
    totalEquity: raw.total_equity ?? '0',
    availableBalance: raw.available_balance ?? '0',
    marginUsed: raw.margin_used ?? '0',
    maintenanceMargin: raw.maintenance_margin ?? '0',
    initialMargin: raw.initial_margin ?? '0',
    currency: raw.currency ?? 'USDT',
  };
}

function mapPosition(raw: any): Position {
  const side: 'long' | 'short' = raw.side === 'buy' ? 'long' : 'short';
  const size = parseFloat(raw.size ?? '0');
  return {
    symbol: raw.instrument ?? '',
    size: String(Math.abs(size)),
    notional: raw.notional ?? '0',
    entryPrice: raw.entry_price ?? '0',
    markPrice: raw.mark_price ?? '0',
    unrealizedPnl: raw.unrealized_pnl ?? '0',
    side,
    leverage: raw.leverage ?? '1',
    liquidationPrice: raw.liquidation_price ?? '0',
    marginUsed: raw.margin_used ?? '0',
  };
}

function mapOrder(raw: any): Order {
  const side: OrderSide = raw.side === 'buy' ? 'buy' : 'sell';
  const type: OrderType = raw.type === 'market' ? 'market' : 'limit';
  const status: OrderStatus = raw.status ?? 'open';
  const tif: TimeInForce = raw.time_in_force ?? 'gtc';
  return {
    orderId: raw.order_id ?? '',
    symbol: raw.instrument ?? '',
    side,
    type,
    quantity: raw.size ?? '0',
    filledQuantity: raw.filled_size ?? '0',
    price: raw.price ?? '0',
    status,
    timeInForce: tif,
    createdTime: Number(raw.created_time ?? Date.now()),
    updatedTime: Number(raw.updated_time ?? Date.now()),
    clientOrderId: raw.metadata?.client_order_id ?? undefined,
  };
}

function mapFill(raw: any): Fill {
  const side: OrderSide = raw.side === 'buy' ? 'buy' : 'sell';
  return {
    fillId: raw.fill_id ?? '',
    orderId: raw.order_id ?? '',
    symbol: raw.instrument ?? '',
    side,
    quantity: raw.size ?? '0',
    price: raw.price ?? '0',
    fee: raw.fee ?? '0',
    feeCurrency: raw.fee_currency ?? 'USDT',
    liquidity: raw.liquidity === 'maker' ? 'maker' : 'taker',
    createdTime: Number(raw.created_time ?? Date.now()),
    realizedPnl: raw.realized_pnl ?? undefined,
  };
}

function mapIntervalToGrvt(interval: string): string {
  const map: Record<string, string> = {
    '1m': 'CI_1_M',
    '5m': 'CI_5_M',
    '15m': 'CI_15_M',
    '1h': 'CI_1_H',
    '4h': 'CI_4_H',
    '1d': 'CI_1_D',
  };
  return map[interval] ?? interval;
}

// ─── Adapter ──────────────────────────────────────────────────────────

export class GrvtExchangeAdapter implements IExchangeClient {
  readonly exchange: ExchangeId = 'grvt';
  readonly network: ExchangeNetwork;

  private client: GRVTClient;

  constructor(client: GRVTClient, network: ExchangeNetwork = 'testnet') {
    this.client = client;
    this.network = network;
  }

  // ── Market Data ───────────────────────────────────────────────────

  async getInstruments(): Promise<Instrument[]> {
    const raw = await this.client.getInstruments();
    return Array.isArray(raw) ? raw.map(mapInstrument) : [];
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const raw = await this.client.getTicker(symbol);
    return mapTicker(raw);
  }

  async getKlines(symbol: string, interval: string = 'CI_1_H', limit?: number): Promise<Kline[]> {
    const grvtInterval = mapIntervalToGrvt(interval);
    const raw = await this.client.getKlines(symbol, grvtInterval, limit ?? 500);
    return Array.isArray(raw) ? raw.map(mapKline) : [];
  }

  // ── Account ───────────────────────────────────────────────────────

  async getBalance(): Promise<Balance> {
    const raw = await this.client.getBalance();
    return mapBalance(raw);
  }

  async getPosition(symbol: string): Promise<Position | null> {
    const raw = await this.client.getPosition(symbol);
    return raw ? mapPosition(raw) : null;
  }

  // ── Orders ────────────────────────────────────────────────────────

  async createOrder(params: CreateOrderParams): Promise<Order> {
    const raw = await this.client.createOrder({
      sub_account_id: this.client.subAccountId,
      instrument: params.symbol,
      size: params.quantity,
      price: params.price,
      side: params.side,
      type: params.type,
      time_in_force: params.timeInForce,
      post_only: params.postOnly,
    }, params.type === 'market');
    return mapOrder(raw);
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    await this.client.cancelOrder(orderId, symbol);
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const raw = await this.client.getOpenOrders(symbol);
    return Array.isArray(raw) ? raw.map(mapOrder) : [];
  }

  // ── Fills ─────────────────────────────────────────────────────────

  async getFillHistory(symbol?: string, limit?: number): Promise<Fill[]> {
    const raw = await this.client.getFillHistory(limit ?? 50, symbol);
    return Array.isArray(raw) ? raw.map(mapFill) : [];
  }

  // ── WebSocket ─────────────────────────────────────────────────────
  // GRVTClient doesn't expose WS at this level; the server layer
  // (ws-dispatcher.ts) handles subscriptions separately.
  // These stubs can be wired up when GRVTClient gains WS support.

  subscribeTicker(_symbol: string, _cb: (ticker: Ticker) => void): void {
    // no-op — WS not supported at adapter level
  }

  subscribeOrders(_symbol: string, _cb: (update: OrderUpdate) => void): void {
    // no-op — WS not supported at adapter level
  }

  unsubscribeTicker(_symbol: string): void {
    // no-op
  }

  unsubscribeOrders(_symbol: string): void {
    // no-op
  }

  disconnect(): void {
    // no-op — individual WS connections managed by server layer
  }

  // ── Helpers ───────────────────────────────────────────────────────

  normalizeSymbol(displayPair: string): string {
    return displayToGrvt(displayPair);
  }

  displaySymbol(nativeSymbol: string): string {
    return grvtToDisplay(nativeSymbol);
  }
}
