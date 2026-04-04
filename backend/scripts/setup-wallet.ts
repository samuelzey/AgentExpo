/**
 * One-time setup: deposit USDC into Arc Testnet GatewayWallet
 * Run: npx tsx scripts/setup-wallet.ts
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { GatewayClient } from '@circle-fin/x402-batching/client';

const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!BUYER_PRIVATE_KEY) throw new Error('BUYER_PRIVATE_KEY not set in .env');

const client = new GatewayClient({
  chain: 'arcTestnet',
  privateKey: BUYER_PRIVATE_KEY,
});

console.log('Checking balances...');
const balances = await client.getBalances();
console.log(`  Wallet USDC:   ${balances.wallet.formatted}`);
console.log(`  Gateway USDC:  ${balances.gateway.formattedAvailable}`);

if (balances.wallet.raw === 0n) {
  console.log('\n❌ No USDC in wallet. Get testnet USDC first:');
  console.log('   https://faucet.circle.com  →  select Arc Testnet');
  process.exit(1);
}

if (balances.gateway.available < 100_000n) { // < 0.1 USDC
  console.log('\nDepositing 1 USDC into GatewayWallet...');
  const result = await client.deposit('1');
  console.log(`✅ Deposit tx: https://testnet.arcscan.app/tx/${result.depositTxHash}`);
  console.log(`   Deposited: ${result.formattedAmount} USDC`);
} else {
  console.log(`\n✅ Gateway already funded: ${balances.gateway.formattedAvailable} USDC`);
}

const updated = await client.getBalances();
console.log('\nFinal balances:');
console.log(`  Wallet USDC:   ${updated.wallet.formatted}`);
console.log(`  Gateway USDC:  ${updated.gateway.formattedAvailable}`);
