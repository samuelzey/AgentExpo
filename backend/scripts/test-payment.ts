/**
 * Test real x402 payment against the local seller endpoint
 * Run: npx tsx scripts/test-payment.ts
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { GatewayClient } from '@circle-fin/x402-batching/client';

const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:8000';

const client = new GatewayClient({ chain: 'arcTestnet', privateKey: BUYER_PRIVATE_KEY });

console.log(`Paying for: ${API_BASE}/service/data-query`);
const response = await client.pay(`${API_BASE}/service/data-query`);

console.log('\n✅ Payment successful!');
console.log('Data:', JSON.stringify(response.data, null, 2));
console.log('Arc tx hash:', response.transaction);
console.log('Amount paid:', response.formattedAmount, 'USDC');

const balances = await client.getBalances();
console.log(`\nGateway balance after: ${balances.gateway.formattedAvailable} USDC`);
