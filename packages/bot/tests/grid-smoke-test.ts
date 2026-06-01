// Grid engine Binance Spot smoke test — SOLUSDC bot
// Run: cd packages/bot && npx tsx tests/grid-smoke-test.ts

import { config } from 'dotenv';
config({ path: '../../.env', override: true });

// Verify env loaded
const bk = process.env.BINANCE_TESTNET_API_KEY;
const bs = process.env.BINANCE_TESTNET_SECRET_KEY;
if (!bk || !bs) {
  console.error('BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_SECRET_KEY not loaded from .env');
  process.exit(1);
}
console.log('Env loaded: BINANCE_TESTNET_API_KEY=' + bk.slice(0, 6) + '... BINANCE_TESTNET_SECRET_KEY=' + bs.slice(0, 6) + '...');
import { db } from '../src/database/db.js';
import { GridEngine } from '../src/bot/grid-engine.js';

async function main() {
  console.log('=== Grid Engine Binance Spot Smoke Test (SOLUSDC) ===\n');

  await db.initialize();
  console.log('DB initialized');

  const engine = new GridEngine();

  // 1. Create SOLUSDC bot — $20 capital, 5 grid levels
  //    Range around current price $80.84: $75-$90
  console.log('\n1. Creating SOLUSDC bot ($50, range $75-$90, 5 grids)...');
  const botId = await engine.createBot({
    userId: 1,
    pair: 'SOLUSDC',
    direction: 'long',
    leverage: 1,
    lowerPrice: 75,
    upperPrice: 90,
    numGrids: 5,
    investmentUSDT: 50,
    exchange: 'binance',
    grvtNetwork: 'testnet',
  });
  console.log('   Bot created: id=' + botId);

  // 2. Verify bot in DB
  const bot = await db.getBot(botId);
  console.log('\n2. Bot DB state:');
  console.log('   exchange=' + bot?.exchange);
  console.log('   pair=' + bot?.pair);
  console.log('   status=' + bot?.status);
  console.log('   investment_usdt=' + bot?.investment_usdt);
  console.log('   capital_usdc=' + (bot as any)?.capital_usdc);
  console.log('   capital_token=' + (bot as any)?.capital_token);
  console.log('   quantity_per_level=' + bot?.quantity_per_level);

  // 3. Start bot — triggers initial purchase + grid orders
  console.log('\n3. Starting bot...');
  await engine.startBot(botId);
  console.log('   Bot started');

  // 4. Wait for orders to settle
  await new Promise(r => setTimeout(r, 8000));

  // 5. Check bot state after start
  const runningBot = await db.getBot(botId);
  console.log('\n4. Bot after start:');
  console.log('   status=' + runningBot?.status);
  console.log('   position_size=' + runningBot?.position_size);
  console.log('   avg_entry_price=' + runningBot?.avg_entry_price);

  // 6. Grid levels
  const levels = await db.getGridLevels(botId);
  const withOrder = levels.filter(l => l.order_id).length;
  const filled = levels.filter(l => l.is_filled).length;
  console.log('\n5. Grid levels: ' + levels.length + ' total, ' + withOrder + ' with orders, ' + filled + ' filled');
  for (const l of levels) {
    const tag = l.order_id ? (l.is_filled ? 'FILLED' : 'OPEN') : 'NO_ORDER';
    console.log('   ' + l.side + ' @ $' + l.price + ' qty=' + l.quantity + ' [' + tag + '] order=' + (l.order_id || 'none'));
  }

  // 7. Capital snapshot
  const instance = (engine as any).bots?.get(botId);
  if (instance) {
    const snap = instance.getCapitalSnapshot();
    console.log('\n6. Capital:');
    console.log('   usdc=' + snap.usdc.toFixed(2));
    console.log('   token=' + snap.token.toFixed(6));
    console.log('   bought=' + snap.bought.toFixed(6));
    console.log('   sold=' + snap.sold.toFixed(6));
    console.log('   realizedPnl=' + snap.realizedPnl.toFixed(4));
  }

  // 8. Orders on exchange (via BinanceClient)
  console.log('\n7. Open orders on Binance testnet...');
  try {
    const client = (instance as any)?.grvt || (instance as any)?.injectedClient;
    if (client && client.getOpenOrders) {
      const orders = await client.getOpenOrders('SOLUSDC');
      console.log('   ' + orders.length + ' open orders on exchange');
      for (const o of orders.slice(0, 8)) {
        console.log('   ' + o.side + ' ' + o.quantity + ' @ $' + o.price + ' [' + o.status + ']');
      }
      if (orders.length > 8) console.log('   ... and ' + (orders.length - 8) + ' more');
    }
  } catch (e: any) {
    console.log('   (could not read exchange orders: ' + e.message + ')');
  }

  // 9. Pause bot
  console.log('\n8. Pausing bot...');
  await engine.pauseBot(botId);
  const paused = await db.getBot(botId);
  console.log('   status=' + paused?.status);

  // 10. Cleanup — close bot and cancel orders
  console.log('\n9. Closing bot (cleanup)...');
  try {
    await engine.closeBot(botId);
    console.log('   Bot closed');
  } catch (e: any) {
    console.log('   Close: ' + e.message);
  }

  console.log('\n=== Smoke test complete ===');
  process.exit(0);
}

main().catch(e => {
  console.error('FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
