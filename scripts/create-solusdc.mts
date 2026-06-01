import { config } from 'dotenv';
config({ path: '/root/proyectos/grvt-binance-bots/.env', override: true });

const API_KEY = process.env.DASHBOARD_API_KEY;
if (!API_KEY) { console.error('No DASHBOARD_API_KEY'); process.exit(1); }

// Step 1: Create bot
console.log('Creating SOLUSDC bot...');
const createRes = await fetch('http://localhost:3849/api/v2/bots', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
  body: JSON.stringify({
    pair: 'SOLUSDC',
    direction: 'long',
    leverage: 1,
    lower_price: 75,
    upper_price: 90,
    num_grids: 5,
    investment_usdt: 50,
    exchange: 'binance',
  }),
});
const createData = await createRes.json();
console.log('Create status:', createRes.status);
console.log('Create body:', JSON.stringify(createData, null, 2));

if (!createData.id) {
  console.error('Failed to create bot');
  process.exit(1);
}

const botId = createData.id;
console.log(`Bot created: id=${botId}`);

// Step 2: Start bot
console.log(`Starting bot ${botId}...`);
const startRes = await fetch(`http://localhost:3849/api/v2/bots/${botId}/start`, {
  method: 'POST',
  headers: { 'X-Api-Key': API_KEY },
});
const startData = await startRes.json();
console.log('Start status:', startRes.status);
console.log('Start body:', JSON.stringify(startData, null, 2));

// Step 3: Wait and check status
await new Promise(r => setTimeout(r, 5000));
console.log(`\nChecking bot ${botId} status...`);
const statusRes = await fetch(`http://localhost:3849/api/v2/bots/${botId}/status`, {
  headers: { 'X-Api-Key': API_KEY },
});
const statusData = await statusRes.json();
console.log('Status:', JSON.stringify(statusData, null, 2));

console.log('\nDone! Dashboard: http://95.111.244.212:3849/dashboard/');
