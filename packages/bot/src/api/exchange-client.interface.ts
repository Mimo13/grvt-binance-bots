// IExchangeClient — Exchange abstraction interface
//
// All exchange-specific logic lives behind this interface.
// The grid engine never talks to a concrete exchange class directly;
// it only holds an IExchangeClient obtained from ExchangeClientFactory.
//
// Adding a new exchange = implement this interface + register in factory.
// No changes needed to grid-engine.ts or v2-router.ts.
//
// Key design decisions:
// - All numeric values are strings in API calls (no floating point errors)
// - Timestamps are unix milliseconds (ms), not nanoseconds
// - Pair format is exchange-specific (GRVT: BTC_USDT_Perp, Binance: BTCUSDC)
// - WebSocket subscriptions are fire-and-forget; reconnect logic lives in the adapter

export type ExchangeId = 'grvt' | 'binance';
export type ExchangeNetwork = 'testnet' | 'mainnet';

// ─── Market Data Types ───────────────────────────────────────

export interface Instrument {
  symbol: string;        // exchange-native symbol (e.g. "BTC_USDT_Perp" or "BTCUSDC")
  baseCurrency: string;  // "BTC"
  quoteCurrency: string; // "USDT" or "USDC"
  tickSize: string;      // min price increment
  lotSize: string;       // min quantity increment
  maxLeverage: number;
  contractType: 'perpetual' | 'spot';
}

export interface Ticker {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  markPrice: string;
  indexPrice: string;
  openInterest: string;
  volume24h: string;
  high24h: string;
  low24h: string;
}

export interface Kline {
  openTime: number;   // unix ms
  closeTime: number;  // unix ms
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
}

// ─── Account Types ───────────────────────────────────────────

export interface Balance {
  totalEquity: string;
  availableBalance: string;
  marginUsed: string;
  maintenanceMargin: string;
  initialMargin: string;
  currency: string;
}

export interface Position {
  symbol: string;
  size: string;          // positive = long, negative = short
  notional: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  side: 'long' | 'short';
  leverage: string;
  liquidationPrice: string;
  marginUsed: string;
}

// ─── Order Types ─────────────────────────────────────────────

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected';
export type TimeInForce = 'gtc' | 'ioc' | 'fok';

export interface CreateOrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;         // required for limit orders
  timeInForce?: TimeInForce;
  postOnly?: boolean;
  clientOrderId?: string; // optional idempotency key
}

export interface Order {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  filledQuantity: string;
  price: string;
  status: OrderStatus;
  timeInForce: TimeInForce;
  createdTime: number;   // unix ms
  updatedTime: number;   // unix ms
  clientOrderId?: string;
}

// ─── Fill Types ─────────────────────────────────────────────

export interface Fill {
  fillId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: string;
  price: string;
  fee: string;
  feeCurrency: string;
  liquidity: 'maker' | 'taker';
  createdTime: number;   // unix ms
  realizedPnl?: string;  // only for closing fills
}

// ─── WebSocket Types ─────────────────────────────────────────

export interface OrderUpdate {
  orderId: string;
  symbol: string;
  side: OrderSide;
  status: OrderStatus;
  filledQuantity: string;
  price: string;
  updatedTime: number;
}

// ─── IExchangeClient Interface ────────────────────────────────

export interface IExchangeClient {
  readonly exchange: ExchangeId;
  readonly network: ExchangeNetwork;

  // ── Market Data ─────────────────────────────────────────

  /**
   * Get all available trading instruments (perpetual futures).
   * Used by the frontend pair selector.
   */
  getInstruments(): Promise<Instrument[]>;

  /**
   * Get current ticker for a symbol.
   * Cached by the backend cache layer (see server/cache.ts).
   */
  getTicker(symbol: string): Promise<Ticker>;

  /**
   * Get kline/candlestick data.
   * @param symbol Exchange-native symbol
   * @param interval 1m | 5m | 15m | 1h | 4h | 1d
   * @param limit Max candles (default 100, max 1000)
   */
  getKlines(symbol: string, interval: string, limit?: number): Promise<Kline[]>;

  // ── Account ─────────────────────────────────────────────

  /**
   * Get account balance.
   * For GRVT: returns USDT balance from sub_account.
   * For Binance: returns USDC balance.
   */
  getBalance(): Promise<Balance>;

  /**
   * Get open position for a symbol.
   * Returns null if no open position.
   */
  getPosition(symbol: string): Promise<Position | null>;

  // ── Orders ───────────────────────────────────────────────

  /**
   * Create a new order.
   * Returns the created order with exchange-assigned orderId.
   * Throws on validation error (bad price, insufficient balance, etc.).
   */
  createOrder(params: CreateOrderParams): Promise<Order>;

  /**
   * Cancel an open order.
   * Idempotent — throws if order already cancelled/filled.
   */
  cancelOrder(orderId: string, symbol: string): Promise<void>;

  /**
   * Get all open orders, optionally filtered by symbol.
   */
  getOpenOrders(symbol?: string): Promise<Order[]>;

  // ── Fills ────────────────────────────────────────────────

  /**
   * Get trade/fill history, newest first.
   * @param symbol Optional filter
   * @param limit Max records (default 50)
   */
  getFillHistory(symbol?: string, limit?: number): Promise<Fill[]>;

  // ── WebSocket ────────────────────────────────────────────

  /**
   * Subscribe to ticker updates for a symbol.
   * Calls `cb` whenever the ticker changes.
   * Auto-reconnects on disconnect.
   */
  subscribeTicker(symbol: string, cb: (ticker: Ticker) => void): void;

  /**
   * Subscribe to order update events (fill, cancel, modify).
   * Calls `cb` with each order update.
   * Requires authentication — fails if no valid session.
   */
  subscribeOrders(symbol: string, cb: (update: OrderUpdate) => void): void;

  /**
   * Unsubscribe ticker for a symbol.
   * No-op if not subscribed.
   */
  unsubscribeTicker(symbol: string): void;

  /**
   * Unsubscribe order updates for a symbol.
   * No-op if not subscribed.
   */
  unsubscribeOrders(symbol: string): void;

  /**
   * Close WebSocket connections and clean up resources.
   * Called when the engine pauses or stops a bot.
   */
  disconnect(): void;

  // ── Helpers ───────────────────────────────────────────────

  /**
   * Convert a display pair name to exchange-native symbol.
   * e.g. "BTC/USDT" → "BTC_USDT_Perp" (GRVT) or "BTCUSDC" (Binance)
   */
  normalizeSymbol(displayPair: string): string;

  /**
   * Convert exchange-native symbol to display pair.
   * e.g. "BTC_USDT_Perp" → "BTC/USDT" or "BTCUSDC" → "BTC/USDC"
   */
  displaySymbol(nativeSymbol: string): string;
}