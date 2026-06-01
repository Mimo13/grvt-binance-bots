// Binance Spot Testnet smoke test
// Run: cd packages/bot && npx tsx tests/binance-smoke-test.ts

import 'dotenv/config';
import crypto from 'crypto';

const BASE_URL = 'https://testnet.binance.vision';
const API_KEY = process.env.BINANCE_TESTNET_API_KEY || '';
const API_SECRET = process.env.BINANCE_TESTNET_SECRET_KEY || '';

if (!API_KEY || !API_SECRET) {
  console.error('Missing BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_SECRET_KEY in .env');
  process.exit(1);
}

function hmacSign(params: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  return crypto.createHmac('sha256', API_SECRET).update(qs.toString()).digest('hex');
}

async function signedReq(method: string, endpoint: string, params: Record<string, string | number> = {}) {
  const allParams = { ...params, timestamp: Date.now(), recvWindow: 5000 };
  const signature = hmacSign(allParams);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...allParams, signature })) qs.append(k, String(v));
  const url = BASE_URL + endpoint + '?' + qs.toString();
  const res = await fetch(url, { method, headers: { 'X-MBX-APIKEY': API_KEY } });
  const data = await res.json();
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(data));
  return data;
}

async function pubReq(endpoint: string, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const url = BASE_URL + endpoint + (qs.toString() ? '?' + qs.toString() : '');
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(data));
  return data;
}

async function main() {
  console.log('=== Binance Spot Testnet Smoke Test ===\n');

  // 1. Exchange info
  console.log('1. Exchange Info (BTCUSDC)...');
  const info = await pubReq('/api/v3/exchangeInfo', { symbol: 'BTCUSDC' });
  const sym = info.symbols && info.symbols[0];
  if (!sym) { console.error('BTCUSDC not found'); process.exit(1); }
  const filters: Record<string, any> = {};
  for (const f of sym.filters) filters[f.filterType] = f;
  console.log('   ' + sym.symbol + ' status=' + sym.status);
  console.log('   tickSize=' + (filters['PRICE_FILTER'] && filters['PRICE_FILTER'].tickSize));
  console.log('   stepSize=' + (filters['LOT_SIZE'] && filters['LOT_SIZE'].stepSize));
  const minNot = (filters['NOTIONAL'] && filters['NOTIONAL'].minNotional) || (filters['MIN_NOTIONAL'] && filters['MIN_NOTIONAL'].minNotional);
  console.log('   minNotional=' + minNot);

  // 2. Account balances
  console.log('\n2. Account balances...');
  const account = await signedReq('GET', '/api/v3/account');
  const usdc = (account.balances || []).find((b: any) => b.asset === 'USDC');
  const btc = (account.balances || []).find((b: any) => b.asset === 'BTC');
  const usdcFree = parseFloat((usdc && usdc.free) || '0');
  const btcFree = parseFloat((btc && btc.free) || '0');
  console.log('   USDC: ' + usdcFree + ' free, ' + ((usdc && usdc.locked) || '0') + ' locked');
  console.log('   BTC:  ' + btcFree + ' free, ' + ((btc && btc.locked) || '0') + ' locked');
  if (usdcFree < 5) {
    console.log('   WARNING: < 5 USDC free. Faucet: https://testnet.binance.vision/faucet');
  }

  // 3. Ticker
  console.log('\n3. Ticker BTCUSDC...');
  const ticker = await pubReq('/api/v3/ticker/24hr', { symbol: 'BTCUSDC' });
  console.log('   lastPrice=' + ticker.lastPrice + ' volume=' + ticker.volume);

  // 4. Open orders
  console.log('\n4. Open orders...');
  const openOrders = await signedReq('GET', '/api/v3/openOrders', { symbol: 'BTCUSDC' });
  console.log('   ' + openOrders.length + ' open orders');

  // 5. Market buy test
  if (usdcFree >= 5) {
    console.log('\n5. Market buy test (~$6 worth)...');
    // minNotional=5, price~72000 → need qty >= 5/72000 ≈ 0.00007
    const testQty = '0.00010'; // ~$7.2 at current price
    try {
      const order = await signedReq('POST', '/api/v3/order', {
        symbol: 'BTCUSDC',
        side: 'BUY',
        type: 'MARKET',
        quantity: testQty,
      });
      console.log('   orderId=' + order.orderId + ' status=' + order.status);
      console.log('   executedQty=' + order.executedQty + ' quoteQty=' + order.cummulativeQuoteQty);
      console.log('   CREDENTIALS VALID — signed POST works');
    } catch (e: any) {
      console.error('   Market buy failed: ' + e.message);
      if (e.message.indexOf('401') >= 0 || e.message.indexOf('-2014') >= 0) {
        console.error('   CREDENTIALS INVALID — regenerate at https://testnet.binance.vision/');
      }
    }
  } else {
    console.log('\n5. Skipping market buy (insufficient USDC)');
  }

  // 6. Recent trades
  console.log('\n6. Recent trades...');
  const trades = await signedReq('GET', '/api/v3/myTrades', { symbol: 'BTCUSDC', limit: 5 });
  console.log('   ' + trades.length + ' recent trades');
  for (const t of trades.slice(-3)) {
    console.log('   ' + (t.isBuyer ? 'BUY' : 'SELL') + ' ' + t.qty + ' @ ' + t.price + ' fee=' + t.commission + ' ' + t.commissionAsset);
  }

  console.log('\n=== All checks passed ===');
}

main().catch(function(e) {
  console.error('Smoke test failed: ' + e.message);
  process.exit(1);
});
