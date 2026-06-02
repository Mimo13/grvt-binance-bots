// Bot normalizer — transforms raw DB rows into exchange-safe read models.
//
// The overview/list endpoint MUST NOT expose GRVT-only fields for Binance
// bots or vice versa. This module is the single function that enforces that.
//
// Design principle: shared fields are required; exchange-specific fields
// are always optional/null in the common shape. The frontend renders based
// on the `exchange` discriminator.

import type { ExchangeId } from './exchange-client.interface.js';

// ─── Raw DB Row Shape ─────────────────────────────────────────────────
// The minimal fields v2-router.ts SELECTs from grid_bots. Not every row
// includes every column; the normalizer fills gaps safely.

export interface BotSummaryRow {
  id: number;
  pair: string;
  exchange: ExchangeId | null;
  status: string;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  grid_profit_usdt: number;
  total_pnl_usdt: number;
  position_size: number;
  avg_entry_price: number;
  quantity_per_level?: number;
  created_at: string;
  updated_at: string;
  compound_pct?: number | null;
  compound_threshold_usdt?: number | null;
  compound_interval_hours?: number | null;
  last_compound_at?: string | null;
  total_reinvested?: number | null;
  original_investment_usdt?: number | null;
  sl_pct?: number | null;
  tp_pct?: number | null;
  safeguard_enabled?: number | null;
  virtual_enabled?: number | null;
  active_window_size?: number | null;
  auto_shift_enabled?: number | null;
  auto_shift_pct?: number | null;
  last_auto_shift_at?: number | null;
  leverage: number;
  direction: string | null;
  trend_pnl_usdt: number;
  liquidation_price: number | null;
  grvt_sub_account_id?: number | null;
  grvt_network?: string | null;
  // Binance-specific capital tracking
  capital_usdc?: number | null;
  capital_token?: number | null;
  total_base_bought?: number | null;
  total_base_sold?: number | null;
  realized_pnl?: number | null;
}

// ─── Shared Read Model (overview/list) ─────────────────────────────────
// Every field in SharedBotSummary works for BOTH exchanges.
// Binance bots get sensible defaults for GRVT-only concepts.
//
// NOTE: field naming is snake_case to match the existing v2 wire format
// the frontend already consumes. The normalizer is the single place where
// exchange-specific fields get safe defaults.

export interface SharedBotSummary {
  id: number;
  pair: string;
  exchange: ExchangeId;
  status: BotStatus;
  lower_price: number;
  upper_price: number;
  num_grids: number;
  investment_usdt: number;
  grid_profit_usdt: number;
  total_pnl_usdt: number;
  position_size: number;
  avg_entry_price: number;
  quantity_per_level?: number;
  created_at: string;
  updated_at: string;
  compound_pct?: number | null;
  compound_threshold_usdt?: number | null;
  compound_interval_hours?: number | null;
  last_compound_at?: string | null;
  total_reinvested?: number | null;
  original_investment_usdt?: number | null;
  sl_pct?: number | null;
  tp_pct?: number | null;
  virtual_enabled?: 0 | 1;
  active_window_size?: number | null;
  auto_shift_enabled?: 0 | 1;
  auto_shift_pct?: number | null;
  last_auto_shift_at?: number | null;
  // GRVT-only fields — null/zero for Binance
  direction: 'long' | 'short';
  leverage: number;
  trend_pnl_usdt: number;
  liquidation_price: number | null;
  // Binance-only fields — null for GRVT
  capital_usdc?: number;
  capital_token?: number;
  total_base_bought?: number;
  total_base_sold?: number;
  realized_pnl?: number;
}

export type BotStatus = 'running' | 'paused' | 'stopped' | 'error';

// ─── Exchange-Specific Detail Models ───────────────────────────────────

export interface BinanceBotDetail extends SharedBotSummary {
  exchange: 'binance';
  // Spot-specific capital isolation (Binance-only columns)
  // These are already in SharedBotSummary via the shared shape
  // GRVT-only fields always null for Binance
  grvt_sub_account_id?: null;
  grvt_network?: null;
}

export interface GrvtBotDetail extends SharedBotSummary {
  exchange: 'grvt';
  // Perpetual-specific
  grvt_sub_account_id?: number | null;
  grvt_network?: 'testnet' | 'mainnet';
}

// ─── Normalizer ────────────────────────────────────────────────────────

export function toSharedBotSummary(row: BotSummaryRow): SharedBotSummary {
  const exchange: ExchangeId = row.exchange ?? 'grvt';
  const isBinance = exchange === 'binance';

  return {
    id: row.id,
    pair: row.pair,
    exchange,
    status: (['running', 'paused', 'stopped', 'error'] as const).includes(row.status as BotStatus)
      ? (row.status as BotStatus)
      : 'error',
    lower_price: row.lower_price,
    upper_price: row.upper_price,
    num_grids: row.num_grids,
    investment_usdt: row.investment_usdt,
    grid_profit_usdt: row.grid_profit_usdt,
    total_pnl_usdt: row.total_pnl_usdt ?? row.grid_profit_usdt + (row.trend_pnl_usdt ?? 0),
    position_size: row.position_size,
    avg_entry_price: row.avg_entry_price,
    quantity_per_level: row.quantity_per_level ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    compound_pct: row.compound_pct ?? null,
    compound_threshold_usdt: row.compound_threshold_usdt ?? null,
    compound_interval_hours: row.compound_interval_hours ?? null,
    last_compound_at: row.last_compound_at ?? null,
    total_reinvested: row.total_reinvested ?? null,
    original_investment_usdt: row.original_investment_usdt ?? null,
    sl_pct: row.sl_pct ?? null,
    tp_pct: row.tp_pct ?? null,
    virtual_enabled: (row.virtual_enabled ?? 0) as 0 | 1,
    active_window_size: row.active_window_size ?? null,
    auto_shift_enabled: (row.auto_shift_enabled ?? 0) as 0 | 1,
    auto_shift_pct: row.auto_shift_pct ?? null,
    last_auto_shift_at: row.last_auto_shift_at ?? null,
    // GRVT-centric: Binance doesn't have direction/trend/liquidation
    direction: isBinance ? 'long' : (row.direction as 'long' | 'short') ?? 'long',
    leverage: isBinance ? 1 : (row.leverage ?? 1),
    trend_pnl_usdt: isBinance ? 0 : (row.trend_pnl_usdt ?? 0),
    liquidation_price: isBinance ? null : (row.liquidation_price ?? null),
    // Binance-only capital fields
    capital_usdc: row.capital_usdc ?? undefined,
    capital_token: row.capital_token ?? undefined,
    total_base_bought: row.total_base_bought ?? undefined,
    total_base_sold: row.total_base_sold ?? undefined,
    realized_pnl: row.realized_pnl ?? undefined,
  };
}

export function toBotDetail(
  row: BotSummaryRow
): BinanceBotDetail | GrvtBotDetail {
  const exchange: ExchangeId = row.exchange ?? 'grvt';
  const base = toSharedBotSummary(row);

  if (exchange === 'binance') {
    return {
      ...base,
      exchange: 'binance',
      // These are already in the shared shape via toSharedBotSummary
      // GRVT-only fields explicitly null
      grvt_sub_account_id: null,
      grvt_network: null,
    };
  }

  return {
    ...base,
    exchange: 'grvt',
    grvt_sub_account_id: row.grvt_sub_account_id ?? null,
    grvt_network: (row.grvt_network as 'testnet' | 'mainnet') ?? 'testnet',
  };
}

// ─── Exchange Capabilities ─────────────────────────────────────────────
// Tells the frontend which exchange-specific actions to show/hide.

export interface ExchangeCapabilities {
  id: ExchangeId;
  label: string;
  supportsLeverage: boolean;
  supportsDirection: boolean;
  supportsLiquidation: boolean;
  supportsFunding: boolean;
  supportsSubAccounts: boolean;
  supportsSpotCapital: boolean;
  supportsRangeUpdate: boolean;
  supportsAutoShift: boolean;
  supportsCancelAll: boolean;
  supportsRestart: boolean;
  supportsStop: boolean;
  defaultCurrency: string;
}

export const EXCHANGE_CAPABILITIES: Record<ExchangeId, ExchangeCapabilities> = {
  grvt: {
    id: 'grvt',
    label: 'GRVT Perpetual Futures',
    supportsLeverage: true,
    supportsDirection: true,
    supportsLiquidation: true,
    supportsFunding: true,
    supportsSubAccounts: true,
    supportsSpotCapital: false,
    supportsRangeUpdate: true,
    supportsAutoShift: true,
    supportsCancelAll: true,
    supportsRestart: true,
    supportsStop: true,
    defaultCurrency: 'USDT',
  },
  binance: {
    id: 'binance',
    label: 'Binance Spot',
    supportsLeverage: false,
    supportsDirection: false,
    supportsLiquidation: false,
    supportsFunding: false,
    supportsSubAccounts: false,
    supportsSpotCapital: true,
    supportsRangeUpdate: true,
    supportsAutoShift: true,
    supportsCancelAll: true,
    supportsRestart: true,
    supportsStop: true,
    defaultCurrency: 'USDC',
  },
};

export function getCapabilities(exchange: ExchangeId): ExchangeCapabilities {
  return EXCHANGE_CAPABILITIES[exchange];
}

// ─── Portfolio helpers ─────────────────────────────────────────────────

export interface PortfolioBotMetrics {
  investmentUsdt: number;
  gridProfitUsdt: number;
  trendPnlUsdt: number;
  positionSize: number;
  avgEntryPrice: number;
  leverage: number;
  exchange: ExchangeId;
}

/**
 * Compute the equity for a single bot in an exchange-aware way.
 * For Binance (Spot): equity = investment + grid_profit (no trend/unrealized PnL).
 * For GRVT (futures): equity = investment + grid_profit + trend_pnl.
 */
export function computeBotEquity(metrics: PortfolioBotMetrics): number {
  const pnl = metrics.exchange === 'binance'
    ? metrics.gridProfitUsdt
    : metrics.gridProfitUsdt + (metrics.trendPnlUsdt ?? 0);
  return metrics.investmentUsdt + pnl;
}

/**
 * Compute aggregate portfolio PnL in an exchange-aware way.
 */
export function computePortfolioPnL(
  bots: PortfolioBotMetrics[]
): { totalEquity: number; totalRealized: number; totalUnrealized: number; totalPnl: number } {
  let totalEquity = 0;
  let totalRealized = 0;
  let totalUnrealized = 0;
  for (const b of bots) {
    totalRealized += b.gridProfitUsdt;
    const unrealized = b.exchange === 'binance' ? 0 : (b.trendPnlUsdt ?? 0);
    totalUnrealized += unrealized;
    totalEquity += computeBotEquity(b);
  }
  return {
    totalEquity,
    totalRealized,
    totalUnrealized,
    totalPnl: totalRealized + totalUnrealized,
  };
}
