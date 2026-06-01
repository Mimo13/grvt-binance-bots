import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    on = vi.fn();
    send = vi.fn();
    close = vi.fn();
  }
  return { default: MockWebSocket };
});

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

import { fetch } from 'undici';
import { BinanceClient } from '../src/api/binance-client.js';

const mockFetch = vi.mocked(fetch);

function jsonResponse(data: unknown) {
  return {
    json: vi.fn().mockResolvedValue(data),
  } as any;
}

describe('BinanceClient Spot/Testnet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_ENV = 'testnet';
    process.env.BINANCE_TESTNET_API_KEY = 'test-key';
    process.env.BINANCE_TESTNET_SECRET_KEY = 'test-secret';
  });

  it('loads Spot exchangeInfo from /api/v3 and maps real filters', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      symbols: [
        {
          symbol: 'BTCUSDC',
          baseAsset: 'BTC',
          quoteAsset: 'USDC',
          status: 'TRADING',
          isSpotTradingAllowed: true,
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
            { filterType: 'LOT_SIZE', stepSize: '0.00001000' },
            { filterType: 'NOTIONAL', minNotional: '5.00000000' },
          ],
        },
        {
          symbol: 'OLDUSDC',
          baseAsset: 'OLD',
          quoteAsset: 'USDC',
          status: 'BREAK',
          isSpotTradingAllowed: true,
          filters: [],
        },
      ],
    }));

    const client = new BinanceClient('testnet');
    const instruments = await client.getInstruments();

    expect(mockFetch).toHaveBeenCalledWith('https://testnet.binance.vision/api/v3/exchangeInfo');
    expect(instruments).toEqual([
      {
        symbol: 'BTCUSDC',
        baseCurrency: 'BTC',
        quoteCurrency: 'USDC',
        tickSize: '0.01000000',
        lotSize: '0.00001000',
        maxLeverage: 1,
        contractType: 'spot',
      },
    ]);
  });

  it('uses signed Spot account endpoint and returns USDC spot balance', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      balances: [
        { asset: 'USDC', free: '10.5', locked: '2.25' },
        { asset: 'BTC', free: '0.1', locked: '0' },
      ],
    }));

    const client = new BinanceClient('testnet');
    const balance = await client.getBalance();

    const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('https://testnet.binance.vision/api/v3/account?');
    expect(calledUrl).toContain('timestamp=');
    expect(calledUrl).toContain('signature=');
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: { 'X-MBX-APIKEY': 'test-key' },
    });
    expect(balance).toEqual({
      totalEquity: '12.75',
      availableBalance: '10.5',
      marginUsed: '0',
      maintenanceMargin: '0',
      initialMargin: '0',
      currency: 'USDC',
    });
  });
});
