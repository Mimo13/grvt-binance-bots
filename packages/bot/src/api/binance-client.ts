// BinanceClient — IExchangeClient implementation for Binance Spot/Testnet
//
// Auth: HMAC-SHA256 signed requests (API key + secret from env).
// Network: BINANCE_ENV=testnet → testnet.binance.vision, mainnet → api.binance.com
// Symbols stored in DB as Binance-native: "BTCUSDC", "ETHUSDC", etc.
//
// WebSocket: raw spot streams wss://stream.binance.com:9443/ws/<symbol>@ticker
//            Account updates via listenKey (requires signed POST /api/v3/userDataStream)

import crypto from 'crypto';
import WebSocket from 'ws';
import { IExchangeClient, type Instrument, type Ticker, type Kline, type Balance, type Position, type CreateOrderParams, type Order, type Fill, type OrderUpdate, type ExchangeNetwork } from './exchange-client.interface.js';

// ─── Config ─────────────────────────────────────────────────────────────────

interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  network: ExchangeNetwork;
}

function getBinanceConfig(): BinanceConfig {
  const network: ExchangeNetwork = (process.env.BINANCE_ENV === 'mainnet' ? 'mainnet' : 'testnet');
  const apiKey = network === 'testnet'
    ? (process.env.BINANCE_TESTNET_API_KEY || '')
    : (process.env.BINANCE_API_KEY || '');
  const apiSecret = network === 'testnet'
    ? (process.env.BINANCE_TESTNET_SECRET_KEY || '')
    : (process.env.BINANCE_API_SECRET || '');
  return { apiKey, apiSecret, network };
}

const BASE_URL_TESTNET = 'https://testnet.binance.vision';
const BASE_URL_MAINNET = 'https://api.binance.com';
const WS_URL_TESTNET = 'wss://testnet.binance.vision/ws';
const WS_URL_MAINNET = 'wss://stream.binance.com:9443/ws';

// ─── Helpers ────────────────────────────────────────────────────────────────

function baseUrl(network: ExchangeNetwork): string {
  return network === 'mainnet' ? BASE_URL_MAINNET : BASE_URL_TESTNET;
}

function wsUrl(network: ExchangeNetwork): string {
  return network === 'mainnet' ? WS_URL_MAINNET : WS_URL_TESTNET;
}

function hmacSign(params: Record<string, string | number>, secret: string): string {
  const queryString = toSearchParams(params).toString();
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

function toSearchParams(params: Record<string, string | number>): URLSearchParams {
  return new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string]));
}

async function signedRequest(
  config: BinanceConfig,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<unknown> {
  const timestamp = Date.now();
  const allParams = { ...params, timestamp };
  const signature = hmacSign(allParams, config.apiSecret);
  const url = `${baseUrl(config.network)}${endpoint}?${toSearchParams({ ...allParams, signature }).toString()}`;

  const { fetch } = await import('undici');
  const resp = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': config.apiKey },
  });
  const json = await resp.json() as { code?: number; msg?: string };
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(`Binance API error ${json.code}: ${json.msg}`);
  }
  return json;
}

async function publicRequest<T>(
  network: ExchangeNetwork,
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const qs = toSearchParams(params).toString();
  const url = `${baseUrl(network)}${endpoint}${qs ? `?${qs}` : ''}`;
  const { fetch } = await import('undici');
  const resp = await fetch(url);
  return resp.json() as Promise<T>;
}

// ─── Symbol conversion ────────────────────────────────────────────────────────

// DB stores "BTCUSDC", display is "BTC/USDC"
export function normalizeSymbol(displayPair: string): string {
  // e.g. "BTC/USDC" → "BTCUSDC"
  return displayPair.replace('/', '');
}

export function displaySymbol(nativeSymbol: string): string {
  // e.g. "BTCUSDC" → "BTC/USDC" (insert / before last 4 chars)
  if (nativeSymbol.length <= 4) return nativeSymbol;
  const idx = nativeSymbol.length - 4;
  return nativeSymbol.slice(0, idx) + '/' + nativeSymbol.slice(idx);
}

// ─── BinanceClient ───────────────────────────────────────────────────────────

export class BinanceClient implements IExchangeClient {
  readonly exchange: 'binance' = 'binance';
  readonly network: ExchangeNetwork;
  private readonly config: BinanceConfig;
  private readonly _ws: WebSocket;
  private readonly _tickerCbs = new Map<string, Set<(t: Ticker) => void>>();
  private readonly _orderCbs = new Map<string, Set<(o: OrderUpdate) => void>>();
  private _listenKey: string | null = null;
  private _listenKeyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(network: ExchangeNetwork = 'testnet') {
    this.network = network;
    this.config = getBinanceConfig();
    this._ws = new WebSocket(wsUrl(this.network));
    this._setupWS();
  }

  // ── WebSocket setup ───────────────────────────────────────────────────────

  private _setupWS(): void {
    this._ws.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString());
        this._handleWSMessage(msg);
      } catch { /* ignore parse errors */ }
    });
    this._ws.on('error', (err) => {
      console.warn('[BinanceClient WS] error:', err.message);
    });
  }

  private _handleWSMessage(msg: Record<string, unknown>): void {
    // 24hr ticker
    if (msg.e === '24hrTicker') {
      const sym = String(msg.s);
      const cbSet = this._tickerCbs.get(sym);
      if (!cbSet || cbSet.size === 0) return;
      const ticker = this._wsTickerToTicker(msg as unknown as Ws24hrTicker);
      cbSet.forEach(cb => cb(ticker));
    }
    // Account update (listenKey stream)
    if (msg.e === 'ORDER_TRADE_UPDATE') {
      const data = msg as unknown as WsOrderUpdate;
      const sym = data.s;
      const cbSet = this._orderCbs.get(sym);
      if (!cbSet || cbSet.size === 0) return;
      const update: OrderUpdate = {
        orderId: String(data.t),
        symbol: sym,
        side: data.S === 'BUY' ? 'buy' : 'sell',
        status: mapBinanceOrderStatus(data.X),
        filledQuantity: data.z,
        price: data.p,
        updatedTime: data.T,
      };
      cbSet.forEach(cb => cb(update));
    }
  }

  private _subscribeWS(channel: string, symbol: string): void {
    const streams: string[] = [];
    if (channel === 'ticker') {
      streams.push(`${symbol.toLowerCase()}@ticker`);
    }
    if (streams.length === 0) return;
    this._ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now(),
    }));
  }

  private _wsTickerToTicker(w: Ws24hrTicker): Ticker {
    return {
      symbol: w.s,
      lastPrice: w.c,
      bidPrice: w.b,
      askPrice: w.a,
      markPrice: w.o,       // open price as proxy; Binance 24hr doesn't have mark
      indexPrice: '0',
      openInterest: w.Q,
      volume24h: w.v,
      high24h: w.h,
      low24h: w.l,
    };
  }

  // ── IExchangeClient implementation ───────────────────────────────────────

  async getInstruments(): Promise<Instrument[]> {
    const data = await publicRequest<ExchangeInfoResponse>(
      this.network,
      '/api/v3/exchangeInfo'
    );
    return (data.symbols || [])
      .filter((s: ExchangeSymbol) => s.status === 'TRADING' && s.isSpotTradingAllowed !== false)
      .map((s: ExchangeSymbol) => ({
        symbol: s.symbol,
        baseCurrency: s.baseAsset,
        quoteCurrency: s.quoteAsset,
        tickSize: getFilterValue(s.filters, 'PRICE_FILTER', 'tickSize') ?? '0',
        lotSize: getFilterValue(s.filters, 'LOT_SIZE', 'stepSize') ?? '0',
        maxLeverage: 1,
        contractType: 'spot' as const,
      }));
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const data = await publicRequest<Record<string, unknown>>(
      this.network,
      '/api/v3/ticker/24hr',
      { symbol }
    );
    // REST /api/v3/ticker/24hr uses long field names (symbol, lastPrice, bidPrice, ...)
    // WS 24hrTicker uses short names (s, c, b, ...). Handle both.
    const d = data as Record<string, unknown>;
    return {
      symbol: String(d.symbol ?? d.s ?? symbol),
      lastPrice: String(d.lastPrice ?? d.c ?? '0'),
      bidPrice: String(d.bidPrice ?? d.b ?? '0'),
      askPrice: String(d.askPrice ?? d.a ?? '0'),
      markPrice: String(d.openPrice ?? d.o ?? '0'),
      indexPrice: '0',
      openInterest: String(d.count ?? d.Q ?? '0'),
      volume24h: String(d.volume ?? d.v ?? '0'),
      high24h: String(d.highPrice ?? d.h ?? '0'),
      low24h: String(d.lowPrice ?? d.l ?? '0'),
    };
  }

  async getKlines(symbol: string, interval: string, limit = 100): Promise<Kline[]> {
    const raw = await publicRequest<RawKline[]>(this.network, '/api/v3/klines', {
      symbol,
      interval,
      limit,
    });
    return raw.map(k => ({
      openTime: k[0],
      closeTime: k[6],
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      volume: k[5],
      trades: 0,
    }));
  }

  async getBalance(): Promise<Balance> {
    const data = await signedRequest(this.config, 'GET', '/api/v3/account', {}) as { balances?: BinanceAsset[] };
    const usdcAsset = data.balances?.find(a => a.asset === 'USDC');
    return {
      totalEquity: usdcAsset ? String(Number(usdcAsset.free || '0') + Number(usdcAsset.locked || '0')) : '0',
      availableBalance: usdcAsset?.free || '0',
      marginUsed: '0',
      maintenanceMargin: '0',
      initialMargin: '0',
      currency: 'USDC',
    };
  }

  async getPosition(symbol: string): Promise<Position | null> {
    void symbol;
    return null;
  }

  async createOrder(params: CreateOrderParams): Promise<Order> {
    const reqParams: Record<string, string | number> = {
      symbol: params.symbol,
      side: params.side.toUpperCase(),
      type: params.type.toUpperCase(),
      quantity: params.quantity,
      newOrderRespType: 'RESULT',
    };
    if (params.price) reqParams.price = params.price;
    if (params.timeInForce) reqParams.timeInForce = params.timeInForce.toUpperCase();
    if (params.postOnly) reqParams.icebergQty = params.quantity;
    if (params.clientOrderId) reqParams.newClientOrderId = params.clientOrderId;

    const data = await signedRequest(this.config, 'POST', '/api/v3/order', reqParams);
    const o = data as BinanceOrder;
    return {
      orderId: String(o.orderId),
      symbol: o.symbol,
      side: o.side === 'BUY' ? 'buy' : 'sell',
      type: o.type === 'LIMIT' ? 'limit' : 'market',
      quantity: o.origQty,
      filledQuantity: o.executedQty,
      price: o.price,
      status: mapBinanceOrderStatus(o.status),
      timeInForce: (o.timeInForce || 'GTC').toLowerCase() as 'gtc' | 'ioc' | 'fok',
      createdTime: o.transactTime,
      updatedTime: o.transactTime,
      clientOrderId: o.clientOrderId,
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    await signedRequest(this.config, 'DELETE', '/api/v3/order', {
      symbol,
      orderId: parseInt(orderId, 10),
    });
  }

  async cancelAllOrders(symbol?: string): Promise<void> {
    const params: Record<string, string | number> = {};
    if (symbol) params.symbol = symbol;
    await signedRequest(this.config, 'DELETE', '/api/v3/openOrders', params);
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params: Record<string, string | number> = {};
    if (symbol) params.symbol = symbol;
    const data = await signedRequest(this.config, 'GET', '/api/v3/openOrders', params);
    return (data as BinanceOrder[]).map(o => ({
      orderId: String(o.orderId),
      symbol: o.symbol,
      side: o.side === 'BUY' ? 'buy' : 'sell',
      type: o.type === 'LIMIT' ? 'limit' : 'market',
      quantity: o.origQty,
      filledQuantity: o.executedQty,
      price: o.price,
      status: mapBinanceOrderStatus(o.status),
      timeInForce: (o.timeInForce || 'GTC').toLowerCase() as 'gtc' | 'ioc' | 'fok',
      createdTime: o.time,
      updatedTime: o.updateTime,
      clientOrderId: o.clientOrderId,
    }));
  }

  async getFillHistory(symbol?: string, limit = 50): Promise<Fill[]> {
    const params: Record<string, string | number> = { limit };
    if (symbol) params.symbol = symbol;
    const data = await signedRequest(this.config, 'GET', '/api/v3/myTrades', params);
    return (data as BinanceTrade[]).map(t => ({
      fillId: String(t.id),
      orderId: String(t.orderId),
      symbol: t.symbol,
      side: t.side === 'BUY' ? 'buy' : 'sell',
      quantity: t.qty,
      price: t.price,
      fee: t.commission,
      feeCurrency: t.commissionAsset,
      liquidity: t.isMaker ? 'maker' : 'taker',
      createdTime: t.time,
    }));
  }

  subscribeTicker(symbol: string, cb: (t: Ticker) => void): void {
    if (!this._tickerCbs.has(symbol)) {
      this._tickerCbs.set(symbol, new Set());
      this._subscribeWS('ticker', symbol);
    }
    this._tickerCbs.get(symbol)!.add(cb);
  }

  subscribeOrders(symbol: string, cb: (o: OrderUpdate) => void): void {
    if (!this._orderCbs.has(symbol)) {
      this._orderCbs.set(symbol, new Set());
      this._initListenKey(symbol);
    }
    this._orderCbs.get(symbol)!.add(cb);
  }

  private async _initListenKey(symbol: string): Promise<void> {
    if (this._listenKey) return; // reuse existing listenKey for all symbols
    try {
      const data = await signedRequest(this.config, 'POST', '/api/v3/userDataStream', {});
      this._listenKey = (data as { listenKey: string }).listenKey;
      const ws = new WebSocket(`${wsUrl(this.network)}/${this._listenKey}`);
      ws.on('message', (raw: WebSocket.Data) => {
        try { this._handleWSMessage(JSON.parse(raw.toString())); } catch { /* ignore */ }
      });
      // Ping every 30min to keep listenKey alive
      this._listenKeyTimer = setInterval(async () => {
        try {
          await signedRequest(this.config, 'PUT', '/api/v3/userDataStream', {});
        } catch { /* ignore */ }
      }, 30 * 60 * 1000);
    } catch (err) {
      console.warn('[BinanceClient] failed to init listenKey:', err);
    }
  }

  unsubscribeTicker(symbol: string): void {
    this._tickerCbs.delete(symbol);
  }

  unsubscribeOrders(symbol: string): void {
    const cbSet = this._orderCbs.get(symbol);
    if (cbSet) { this._orderCbs.delete(symbol); }
  }

  disconnect(): void {
    this._ws.close();
    if (this._listenKeyTimer) clearInterval(this._listenKeyTimer);
    this._tickerCbs.clear();
    this._orderCbs.clear();
  }

  normalizeSymbol(displayPair: string): string {
    return normalizeSymbol(displayPair);
  }

  displaySymbol(nativeSymbol: string): string {
    return displaySymbol(nativeSymbol);
  }
}

// ─── Type helpers ───────────────────────────────────────────────────────────

function mapBinanceOrderStatus(s: string): 'open' | 'filled' | 'cancelled' | 'rejected' {
  const map: Record<string, 'open' | 'filled' | 'cancelled' | 'rejected'> = {
    NEW: 'open', PARTIALLY_FILLED: 'open',
    FILLED: 'filled', REJECTED: 'rejected', EXPIRED: 'cancelled', CANCELED: 'cancelled',
  };
  return map[s] || 'open';
}

interface Ws24hrTicker {
  e: string; s: string; c: string; b: string; a: string;
  o: string; Q: string; v: string; h: string; l: string;
}
interface WsOrderUpdate {
  e: string; T: number; s: string; S: string; X: string;
  z: string; p: string; t: number;
}
interface ExchangeInfoResponse {
  symbols: ExchangeSymbol[];
}
interface ExchangeSymbol {
  symbol: string; baseAsset: string; quoteAsset: string;
  pricePrecision?: number; quantityPrecision?: number;
  status: string; isSpotTradingAllowed?: boolean;
  filters?: BinanceFilter[];
}
type RawKline = [number, string, string, string, string, string, number];
interface BinanceAsset { asset: string; free: string; locked: string; }
interface BinanceOrder { orderId: number; symbol: string; side: string; type: string; origQty: string; executedQty: string; price: string; status: string; timeInForce: string; transactTime: number; time: number; updateTime: number; clientOrderId?: string; }
interface BinanceTrade { id: number; orderId: number; symbol: string; side: string; qty: string; price: string; commission: string; commissionAsset: string; isMaker: boolean; time: number; }
type BinanceFilter = { filterType: string } & Record<string, string>;

function getFilterValue(filters: BinanceFilter[] | undefined, filterType: string, key: string): string | undefined {
  return filters?.find((f) => f.filterType === filterType)?.[key];
}