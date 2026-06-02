// Exchange Client Factory — single source for exchange clients.
//
// No user login: credentials come from env vars only.
// For GRVT: reads GRVT_PRIVATE_KEY + GRVT_API_KEY from env.
// For Binance: reads BINANCE_API_KEY + BINANCE_API_SECRET (or BINANCE_TESTNET_*).
//
// Usage (no login, single user):
//   const client = getExchangeClient('grvt');
//   const client = getExchangeClient('binance');
//
// The factory returns a singleton per exchange, cached for 5 minutes.
// Credentials are read from env at construction time.
//
// IMPORTANT: the GRVT client is loaded lazily (dynamic import) to permit
// Binance-only deployments where GRVT_TRADING_ACCOUNT_ID may not be set.
// A top-level `import { grvtClient } from './client.js'` would throw
// at module load time if the env var is absent.
//
// Multi-user / sub-account: this factory is NOT used for per-user credentials.
// It is for the no-login single-user mode. For multi-user, each user has their
// own encrypted credentials in the DB (see grvt-client-factory.ts).

import { BinanceClient } from './binance-client.js';
import type { IExchangeClient } from './exchange-client.interface.js';


export type ExchangeId = 'grvt' | 'binance';

interface CacheEntry {
  client: IExchangeClient;
  expiresAt: number;
}

const cache = new Map<ExchangeId, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

function cacheKey(exchange: ExchangeId): ExchangeId {
  return exchange;
}

/**
 * Get a cached exchange client for the given exchange.
 * Credentials are read from env vars (no user login).
 */
export async function getExchangeClient(exchange: ExchangeId): Promise<IExchangeClient> {
  const key = cacheKey(exchange);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.client;
  }

  let client: IExchangeClient;

  if (exchange === 'binance') {
    const network = (process.env.BINANCE_ENV === 'mainnet' ? 'mainnet' : 'testnet');
    client = new BinanceClient(network);
  } else {
    // GRVT: lazy dynamic import so this factory doesn't crash when
    // GRVT_TRADING_ACCOUNT_ID is unset (Binance-only environments).
    const { grvtClient } = await import('./client.js');
    const { GrvtExchangeAdapter } = await import('./grvt-exchange-adapter.js');
    const network = (process.env.GRVT_ENV === 'mainnet' ? 'mainnet' : 'testnet');
    client = new GrvtExchangeAdapter(grvtClient, network);
  }

  cache.set(key, { client, expiresAt: Date.now() + TTL_MS });
  return client;
}

/**
 * Invalidate cached client (e.g. after credential rotation).
 */
export function invalidateExchangeClient(exchange: ExchangeId): void {
  const hit = cache.get(exchange);
  if (hit) {
    (hit.client as { disconnect?(): void })?.disconnect?.();
    cache.delete(exchange);
  }
}

/**
 * Invalidate all cached clients.
 */
export function invalidateAllExchangeClients(): void {
  cache.forEach((entry) => {
    (entry.client as { disconnect?(): void })?.disconnect?.();
  });
  cache.clear();
}

/**
 * Returns all available exchange IDs.
 */
export function getAvailableExchanges(): ExchangeId[] {
  return ['grvt', 'binance'];
}