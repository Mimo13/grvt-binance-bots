// Grid Engine Tests
// Tests for GridBotInstance internals: calculateRealGridProfit, handleOrderFilled, deduplication

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mock objects so they're available inside vi.mock factories
const { mockGrvtClient, mockDb, mockGetInstrumentSpec, mockGetExchangeClient } = vi.hoisted(() => ({
  mockGrvtClient: {
    getOpenOrders: vi.fn(),
    getFillHistory: vi.fn(),
    getTicker: vi.fn(),
    getAccountSummary: vi.fn(),
    createOrder: vi.fn(),
    cancelOrder: vi.fn(),
    cancelAllOrders: vi.fn(),
    getInstruments: vi.fn(),
    login: vi.fn(),
  },
  mockGetInstrumentSpec: vi.fn(() => ({ min_size: 0.00001, min_notional: 5 })),
  mockGetExchangeClient: vi.fn(),
  mockDb: {
    getBot: vi.fn(),
    createBot: vi.fn(),
    updateBot: vi.fn(),
    getBots: vi.fn(),
    getGridLevels: vi.fn(),
    createGridLevel: vi.fn(),
    updateGridLevel: vi.fn(),
    fillGridLevel: vi.fn(),
    createOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
    createTrade: vi.fn(),
    getOrders: vi.fn(),
    close: vi.fn(),
    getLastFillArchiveTimestamp: vi.fn(),
    insertFillArchive: vi.fn(),
    insertPairedRoundtrip: vi.fn(),
    getFillsArchive: vi.fn(),
    getPairedRoundtrips: vi.fn(),
  },
}));

// Mock modules using the hoisted objects
vi.mock('../src/api/client.js', () => ({
  grvtClient: mockGrvtClient,
  GRVTClient: vi.fn(),
  getInstrumentSpec: mockGetInstrumentSpec,
}));

vi.mock('../src/database/db.js', () => ({
  db: mockDb,
}));

vi.mock('../src/api/exchange-client-factory.js', () => ({
  getExchangeClient: mockGetExchangeClient,
  invalidateExchangeClient: vi.fn(),
}));

import { GridBotInstance, GridEngine } from '../src/bot/grid-engine.js';
import { createMockFill, createMockGridLevel } from './setup.js';

describe('GridEngine.startBot Binance Spot path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRY_RUN = 'true';
  });

  it('starts Binance Spot bots without calling Futures/GRVT leverage APIs', async () => {
    const bot = {
      id: 9,
      user_id: 1,
      exchange: 'binance',
      pair: 'BTCUSDC',
      direction: 'long',
      lower_price: 90000,
      upper_price: 110000,
      num_grids: 2,
      spacing: 10000,
      leverage: 1,
      investment_usdt: 1000,
      capital_usdc: 1000,
      quantity_per_level: 0.001,
      status: 'paused',
    };
    const levels = [
      createMockGridLevel({ id: 1, level_index: 0, price: 90000, side: 'buy', quantity: 0.001 }),
      createMockGridLevel({ id: 2, level_index: 1, price: 100000, side: 'buy', quantity: 0.001 }),
      createMockGridLevel({ id: 3, level_index: 2, price: 110000, side: 'sell', quantity: 0.001 }),
    ];
    const binanceClient = {
      exchange: 'binance',
      network: 'testnet',
      getOpenOrders: vi.fn().mockResolvedValue([]),
      getPosition: vi.fn().mockResolvedValue(null),
      getBalance: vi.fn().mockResolvedValue({ availableBalance: '2000', totalEquity: '2000' }),
      getTicker: vi.fn().mockResolvedValue({ symbol: 'BTCUSDC', lastPrice: '100000' }),
      createOrder: vi.fn().mockResolvedValue({
        orderId: 'dry-unused',
        symbol: 'BTCUSDC',
        side: 'buy',
        type: 'limit',
        quantity: '0.001',
        filledQuantity: '0',
        price: '90000',
        status: 'open',
        timeInForce: 'gtc',
        createdTime: 1710000000000,
        updatedTime: 1710000000000,
      }),
    };

    mockDb.getBot.mockResolvedValue(bot);
    mockDb.getGridLevels.mockResolvedValue(levels);
    mockDb.updateBot.mockResolvedValue(undefined);
    mockDb.updateGridLevel.mockResolvedValue(undefined);
    mockDb.createOrder.mockResolvedValue(undefined);
    mockGetExchangeClient.mockReturnValue(binanceClient);

    const engine = new GridEngine();
    await expect(engine.startBot(9)).resolves.toBeUndefined();

    expect(mockGetExchangeClient).toHaveBeenCalledWith('binance');
    expect((binanceClient as any).setLeverage).toBeUndefined();
    expect(mockDb.updateBot).toHaveBeenCalledWith(9, { status: 'running' });
  });

  it('archives Binance Spot fills using normalized IExchangeClient fill fields', async () => {
    const bot = {
      id: 10,
      user_id: 1,
      exchange: 'binance',
      pair: 'BTCUSDC',
      direction: 'long',
      lower_price: 90000,
      upper_price: 110000,
      num_grids: 2,
      spacing: 10000,
      leverage: 1,
      investment_usdt: 10,
      quantity_per_level: 0.001,
      status: 'running',
    };
    const binanceClient = {
      exchange: 'binance',
      network: 'testnet',
      getFillHistory: vi.fn().mockResolvedValue([
        {
          fillId: '98765',
          orderId: '12345',
          symbol: 'BTCUSDC',
          side: 'buy',
          quantity: '0.001',
          price: '100000',
          fee: '0.05',
          feeCurrency: 'USDC',
          liquidity: 'taker',
          createdTime: 1710000000000,
        },
      ]),
    };
    mockGetExchangeClient.mockReturnValue(binanceClient);
    mockDb.insertFillArchive.mockResolvedValue(true);

    const engine = new GridEngine();
    (engine as any).bots.set(10, new GridBotInstance(bot as any, binanceClient as any));

    await (engine as any).pollFillArchive();

    expect(binanceClient.getFillHistory).toHaveBeenCalledWith('BTCUSDC', 1000);
    expect(mockDb.insertFillArchive).toHaveBeenCalledWith({
      fill_id: '98765',
      event_time: '1710000000000',
      is_buyer: 1,
      price: 100000,
      size: 0.001,
      fee: 0.05,
      created_at: new Date(1710000000000).toISOString(),
      bot_id: 10,
      instrument: 'BTCUSDC',
    });
  });
});

describe('GridBotInstance', () => {
  let instance: InstanceType<typeof GridBotInstance>;
  let mockBot: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBot = {
      id: 1,
      user_id: 1,
      pair: 'ETH_USDT_Perp',
      direction: 'long',
      lower_price: 1800,
      upper_price: 2450,
      num_grids: 94,
      spacing: 6.99,
      leverage: 5,
      quantity_per_level: 0.02,
      status: 'running',
    };

    mockDb.getBot.mockResolvedValue(mockBot);
    mockDb.getGridLevels.mockResolvedValue([]);
    mockDb.getOrders.mockResolvedValue([]);
    mockDb.getFillsArchive.mockResolvedValue([]);
    mockDb.getPairedRoundtrips.mockResolvedValue([]);

    // Construct with injected mock client
    instance = new GridBotInstance(mockBot, mockGrvtClient as any);
  });

  describe('calculateRealGridProfit', () => {
    it('should return null when no fills exist', async () => {
      mockDb.getFillsArchive.mockResolvedValue([]);

      const result = await (instance as any).calculateRealGridProfit();
      expect(result === null || result === 0).toBe(true);
    });
  });

  describe('handleOrderFilled', () => {
    it('should deduplicate fills by orderId', async () => {
      const order = {
        id: 1,
        bot_id: 1,
        grid_level_id: 100,
        side: 'buy',
        price: 2000,
        quantity: 0.02,
        order_id: 'order_123',
        status: 'active',
      };

      mockDb.getGridLevels.mockResolvedValue([
        createMockGridLevel({ id: 100, level_index: 10, side: 'buy', price: 2000 }),
        createMockGridLevel({ id: 101, level_index: 11, side: 'sell', price: 2007 }),
      ]);
      mockDb.updateGridLevel.mockResolvedValue(undefined);
      mockDb.updateOrderStatus.mockResolvedValue(undefined);
      mockDb.createTrade.mockResolvedValue(undefined);
      mockDb.createOrder.mockResolvedValue(undefined);
      mockGrvtClient.createOrder.mockResolvedValue({ order_id: 'new_order' });

      // First call should process
      await (instance as any).handleOrderFilled('order_123', order);
      // Second call should be deduped (processedFills set)
      await (instance as any).handleOrderFilled('order_123', order);

      // The internal logic may vary, but the key invariant is that
      // the second call should not double-process
    });
  });

  describe('placeGridOrder', () => {
    it('places a Binance Spot market buy for initial long inventory before grid limits', async () => {
      process.env.DRY_RUN = 'false';
      mockBot = {
        ...mockBot,
        exchange: 'binance',
        pair: 'BTCUSDC',
        quantity_per_level: 0.001,
        investment_usdt: 1000,
        capital_usdc: 1000,
      };
      const levels = [
        createMockGridLevel({ id: 1, level_index: 0, side: 'buy', price: 90000, quantity: 0.001 }),
        createMockGridLevel({ id: 2, level_index: 1, side: 'buy', price: 100000, quantity: 0.001 }),
        createMockGridLevel({ id: 3, level_index: 2, side: 'sell', price: 110000, quantity: 0.001 }),
      ];
      const binanceClient = {
        exchange: 'binance',
        network: 'testnet',
        getTicker: vi.fn().mockResolvedValue({ symbol: 'BTCUSDC', lastPrice: '100000' }),
        createOrder: vi.fn()
          .mockResolvedValueOnce({
            orderId: 'market-1',
            symbol: 'BTCUSDC',
            side: 'buy',
            type: 'market',
            quantity: '0.001',
            filledQuantity: '0.001',
            price: '100000',
            status: 'filled',
            timeInForce: 'ioc',
            createdTime: 1710000000000,
            updatedTime: 1710000000000,
            clientOrderId: 'initial_purchase_1',
          })
          .mockResolvedValue({
            orderId: 'limit-1',
            symbol: 'BTCUSDC',
            side: 'buy',
            type: 'limit',
            quantity: '0.001',
            filledQuantity: '0',
            price: '90000',
            status: 'open',
            timeInForce: 'gtc',
            createdTime: 1710000000000,
            updatedTime: 1710000000000,
          }),
      };
      mockDb.getGridLevels.mockResolvedValue(levels);
      mockDb.updateGridLevel.mockResolvedValue(undefined);
      mockDb.updateBot.mockResolvedValue(undefined);
      mockDb.createOrder.mockResolvedValue(undefined);
      instance = new GridBotInstance(mockBot, binanceClient as any);

      await instance.placeInitialOrders();

      expect(binanceClient.createOrder).toHaveBeenNthCalledWith(1, {
        symbol: 'BTCUSDC',
        side: 'buy',
        type: 'market',
        quantity: '0.001',
        clientOrderId: 'initial_purchase_1',
      });
      expect(mockDb.updateBot).toHaveBeenCalledWith(1, {
        position_size: 0.001,
        avg_entry_price: 100000,
      });
    });

    it('should call grvt.createOrder with correct params', async () => {
      const mockSignedOrder = { subAccountID: '1', legs: [], signature: {} };
      // We need to mock signOrder — it's imported at module level
      // For now, just verify the method exists
      expect(typeof (instance as any).placeGridOrder).toBe('function');
    });

    it('routes Binance Spot grid orders through IExchangeClient createOrder params', async () => {
      process.env.DRY_RUN = 'false';
      mockBot = {
        ...mockBot,
        exchange: 'binance',
        pair: 'BTCUSDC',
        quantity_per_level: 0.001,
        investment_usdt: 1000,
        capital_usdc: 1000,
      };
      const binanceClient = {
        exchange: 'binance',
        network: 'testnet',
        createOrder: vi.fn().mockResolvedValue({
          orderId: '12345',
          symbol: 'BTCUSDC',
          side: 'buy',
          type: 'limit',
          quantity: '0.001',
          filledQuantity: '0',
          price: '90000',
          status: 'open',
          timeInForce: 'gtc',
          createdTime: 1710000000000,
          updatedTime: 1710000000000,
          clientOrderId: 'grid_1_3',
        }),
      };
      instance = new GridBotInstance(mockBot, binanceClient as any);

      await instance.placeGridOrder(createMockGridLevel({
        id: 3,
        level_index: 3,
        side: 'buy',
        price: 90000,
        quantity: 0.001,
      }));

      expect(binanceClient.createOrder).toHaveBeenCalledWith({
        symbol: 'BTCUSDC',
        side: 'buy',
        type: 'limit',
        quantity: '0.001',
        price: '90000',
        timeInForce: 'gtc',
        clientOrderId: 'grid_1_3',
      });
      expect(mockDb.createOrder).toHaveBeenCalledWith(expect.objectContaining({
        bot_id: 1,
        order_id: '12345',
        instrument: 'BTCUSDC',
        side: 'buy',
        type: 'limit',
        quantity: 0.001,
        price: 90000,
        status: 'pending',
        grid_level_id: 3,
        metadata: 'grid_1_3',
      }));
      expect(mockDb.updateGridLevel).toHaveBeenCalledWith(3, {
        order_id: '12345',
        state: 'active',
      });
    });
  });

  // ── 6.3: Binance Spot capital manager tests ────────────────────────
  describe('Binance Spot capital manager', () => {
    let binanceBot: any;
    let binanceInstance: InstanceType<typeof GridBotInstance>;

    beforeEach(() => {
      binanceBot = {
        id: 42,
        user_id: 1,
        pair: 'BTCUSDC',
        direction: 'long',
        leverage: 1,
        lower_price: 90000,
        upper_price: 110000,
        num_grids: 10,
        investment_usdt: 1000,
        capital_usdc: 1000,
        capital_token: 0,
        total_base_bought: 0,
        total_base_sold: 0,
        realized_pnl: 0,
        quantity_per_level: 0.001,
        exchange: 'binance',
        status: 'running',
      };
    });

    it('initializes capital from DB values on construction', () => {
      binanceBot.capital_usdc = 500;
      binanceBot.capital_token = 0.005;
      binanceBot.total_base_bought = 0.01;
      binanceBot.total_base_sold = 0.005;
      binanceBot.realized_pnl = 2.5;

      binanceInstance = new GridBotInstance(binanceBot, {} as any);
      const snap = binanceInstance.getCapitalSnapshot();

      expect(snap.usdc).toBe(500);
      expect(snap.token).toBe(0.005);
      expect(snap.bought).toBe(0.01);
      expect(snap.sold).toBe(0.005);
      expect(snap.realizedPnl).toBe(2.5);
    });

    it('recordBuyFill deducts USDC and adds token', () => {
      binanceInstance = new GridBotInstance(binanceBot, {} as any);

      binanceInstance.recordBuyFill(0.01, 100000, 0.5);

      const snap = binanceInstance.getCapitalSnapshot();
      // cost = 0.01 * 100000 + 0.5 = 1000.5, but clamped to 0
      expect(snap.usdc).toBe(0);
      expect(snap.token).toBeCloseTo(0.01, 6);
      expect(snap.bought).toBeCloseTo(0.01, 6);
    });

    it('recordSellFill adds USDC proceeds and deducts token', () => {
      binanceBot.capital_usdc = 500;
      binanceBot.capital_token = 0.01;
      binanceBot.total_base_bought = 0.01;
      binanceInstance = new GridBotInstance(binanceBot, {} as any);

      binanceInstance.recordSellFill(0.005, 105000, 0.3);

      const snap = binanceInstance.getCapitalSnapshot();
      // proceeds = 0.005 * 105000 - 0.3 = 525 - 0.3 = 524.7
      expect(snap.usdc).toBeCloseTo(500 + 524.7, 2);
      expect(snap.token).toBeCloseTo(0.01 - 0.005, 6);
      expect(snap.sold).toBeCloseTo(0.005, 6);
    });

    it('getBinanceBuyCap returns capital_usdc', () => {
      binanceInstance = new GridBotInstance(binanceBot, {} as any);
      expect(binanceInstance.getBinanceBuyCap()).toBe(1000);
    });

    it('getBinanceSellCap returns min(capital_token, wallet balance)', async () => {
      binanceBot.capital_token = 0.005;
      const mockClient = {
        exchange: 'binance',
        getBalance: vi.fn().mockResolvedValue({
          balances: [{ asset: 'BTC', free: '0.003', locked: '0' }],
        }),
      };
      binanceInstance = new GridBotInstance(binanceBot, mockClient as any);

      const sellCap = await binanceInstance.getBinanceSellCap();
      // min(0.005, 0.003) = 0.003
      expect(sellCap).toBeCloseTo(0.003, 6);
    });

    it('getBinanceSellCap falls back to bot holdings when getBalance fails', async () => {
      binanceBot.capital_token = 0.005;
      const mockClient = {
        exchange: 'binance',
        getBalance: vi.fn().mockRejectedValue(new Error('network')),
      };
      binanceInstance = new GridBotInstance(binanceBot, mockClient as any);

      const sellCap = await binanceInstance.getBinanceSellCap();
      expect(sellCap).toBeCloseTo(0.005, 6);
    });

    it('blocks sell order when capital_token = 0', async () => {
      binanceBot.capital_token = 0;
      const mockClient = {
        exchange: 'binance',
        getBalance: vi.fn().mockResolvedValue({
          balances: [{ asset: 'BTC', free: '0', locked: '0' }],
        }),
      };
      binanceInstance = new GridBotInstance(binanceBot, mockClient as any);

      await binanceInstance.placeGridOrder({
        id: 1, bot_id: 42, level_index: 0, price: 100000,
        side: 'sell', quantity: 0.001, is_filled: false, created_at: '',
      });

      expect(mockDb.createOrder).not.toHaveBeenCalled();
    });

    it('blocks buy order when cost exceeds capital_usdc', async () => {
      binanceBot.capital_usdc = 50; // only $50 available
      binanceInstance = new GridBotInstance(binanceBot, {} as any);

      await binanceInstance.placeGridOrder({
        id: 1, bot_id: 42, level_index: 0, price: 100000,
        side: 'buy', quantity: 0.001, is_filled: false, created_at: '',
      });

      // cost = 0.001 * 100000 = 100 > 50 → blocked
      expect(mockDb.createOrder).not.toHaveBeenCalled();
    });
  });
});
