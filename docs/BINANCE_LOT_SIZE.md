# Binance LOT_SIZE Handling

## Problem

When creating grid bots with pairs that have strict LOT_SIZE filters (e.g. XLMUSDC with `stepSize=1`), the engine calculated quantities with decimals (e.g. `106.14 XLM`) which Binance rejected with error `-1013: Filter failure: LOT_SIZE`.

## Root Cause

The `computeQtyPerLevel()` formula in `grid-engine.ts` calculates:
```
qty = ceil((effCap / numGrids / midPrice) * 100) / 100
```

This produces quantities like `106.14` which don't conform to Binance's LOT_SIZE constraints:
- `stepSize=1` → quantities must be whole integers
- `minQty=1` → minimum 1 unit

The quantity was sent directly to Binance's REST API without rounding to the LOT_SIZE stepSize.

## Fix

**File:** `packages/bot/src/api/binance-client.ts`

1. Added `roundToStepSize(value, stepSize)` helper that rounds a number to the nearest valid step
2. Added `_lotSizeCache` (Map<string, string>) — lazy cache of LOT_SIZE.stepSize per symbol
3. Added `_getLotStepSize(symbol)` — fetches exchangeInfo for a single symbol, extracts LOT_SIZE.stepSize, caches result
4. Modified `createOrder()` to round `params.quantity` to stepSize before sending

### Example

```typescript
// stepSize = "1", value = 106.14 → "106"
// stepSize = "0.1", value = 0.156 → "0.2"
// stepSize = "0.01", value = 10.456 → "10.46"
```

## Testing

**Before fix:** XLMUSDC bot → 0 orders on Binance, all rejected with LOT_SIZE error
**After fix:** XLMUSDC bot → 5 active orders with correct quantities (106 XLM @ $0.23-$0.24)

## Files Changed

| File | Change |
|------|--------|
| `packages/bot/src/api/binance-client.ts` | Added roundToStepSize(), _getLotStepSize(), LOT_SIZE cache, modified createOrder() |

## Related Issues

- React error #310 (hooks mismatch) — `OverviewPage.tsx`
- WS 4401 showing "Error" instead of "Offline" — `ws-client.ts`
- Candles failing for Binance pairs — `v2-router.ts`
