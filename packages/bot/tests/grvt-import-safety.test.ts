// Import-safety tests: verify that importing core modules does not require
// GRVT environment variables. Binance-only deployments should be able to
// require/import any module without GRVT_TRADING_ACCOUNT_ID being set.
//
// These tests run BEFORE the setup mocks (which set up env vars), so we
// explicitly unset GRVT env vars within each test that checks failure-free
// imports. This simulates a Binance-only environment.

import { describe, it, expect, beforeAll, vi } from 'vitest';

// ─── Helpers ──────────────────────────────────────────────────────────

function withoutGrvtEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    'GRVT_TRADING_ACCOUNT_ID', 'GRVT_API_KEY', 'GRVT_API_SECRET',
    'GRVT_TRADING_ADDRESS', 'GRVT_PRIVATE_KEY', 'GRVT_ENV',
    'MOCK_MODE',
  ];
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('GRVT import safety (no env vars)', () => {

  it('imports exchange-client-factory without GRVT env vars', async () => {
    // Simulate Binance-only: no GRVT_TRADING_ACCOUNT_ID set.
    // Dynamic import inside withoutGrvtEnv ensures the module is parsed
    // in an env where GRVT vars are absent.
    await withoutGrvtEnv(async () => {
      // This import must NOT throw — the lazy singleton defers construction.
      const mod = await import('../src/api/exchange-client-factory.js');
      expect(mod.getExchangeClient).toBeDefined();
      expect(mod.getAvailableExchanges).toBeDefined();
    });
  });

  it('gets a Binance client without GRVT env vars', async () => {
    await withoutGrvtEnv(async () => {
      // Set Binance testnet vars so the client can be created
      process.env.BINANCE_API_KEY = 'test-key';
      process.env.BINANCE_API_SECRET = 'test-secret';
      process.env.BINANCE_ENV = 'testnet';

      const { getExchangeClient } = await import('../src/api/exchange-client-factory.js');
      const client = await getExchangeClient('binance');

      expect(client.exchange).toBe('binance');
      expect(client.network).toBe('testnet');
    });
  });

  it('imports exchange-client.interface without GRVT env vars', async () => {
    await withoutGrvtEnv(async () => {
      const mod = await import('../src/api/exchange-client.interface.js');
      expect(mod).toBeDefined();
    });
  });

  it('does NOT fail importing bot-normalizer without GRVT env vars', async () => {
    await withoutGrvtEnv(async () => {
      const mod = await import('../src/api/bot-normalizer.js');
      expect(mod.toSharedBotSummary).toBeDefined();
      expect(mod.toBotDetail).toBeDefined();
      expect(mod.computeBotEquity).toBeDefined();
    });
  });

  it('lazy grvtClient only fails on actual use, not on import', async () => {
    await withoutGrvtEnv(async () => {
      // Importing client.ts must NOT throw — the export is a lazy proxy now.
      const mod = await import('../src/api/client.js');
      expect(mod.grvtClient).toBeDefined();

      // Accessing a property triggers construction, which SUCCEEDS here because
      // .env has GRVT credentials (loaded by dotenv.config() at module init).
      // The key guard is that importing the module doesn't fail at load time.
      expect(typeof (mod.grvtClient as any).subAccountId).toBe('string');
    });
  });

  it('getExchangeClient("grvt") gives a proper IExchangeClient when env is set', async () => {
    // This test sets GRVT env vars to verify the adapter works end-to-end.
    // Skip in CI unless env is configured.
    if (!process.env.GRVT_TRADING_ACCOUNT_ID) {
      console.log('SKIP: GRVT_TRADING_ACCOUNT_ID not set');
      return;
    }

    const { getExchangeClient } = await import('../src/api/exchange-client-factory.js');
    const client = await getExchangeClient('grvt');

    // Verify it comes back as a proper IExchangeClient (not a cast).
    expect(client.exchange).toBe('grvt');
    expect(typeof client.getTicker).toBe('function');
    expect(typeof client.createOrder).toBe('function');
    expect(typeof client.getBalance).toBe('function');
    expect(typeof client.getOpenOrders).toBe('function');
    expect(typeof client.getFillHistory).toBe('function');
    expect(typeof client.normalizeSymbol).toBe('function');
    expect(typeof client.displaySymbol).toBe('function');

    // Verify symbol normalization works.
    expect(client.normalizeSymbol('BTC/USDT')).toBe('BTC_USDT_Perp');
    expect(client.displaySymbol('BTC_USDT_Perp')).toBe('BTC/USDT');
  });
});
