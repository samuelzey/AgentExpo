import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { privateKeyToAccount } from 'viem/accounts';

const key = process.env.SELLER_PRIVATE_KEY as `0x${string}` ?? process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!key) throw new Error('Set BUYER_PRIVATE_KEY in .env');

const account = privateKeyToAccount(key);
console.log('Address:', account.address);
console.log('\nPut this in your .env as SELLER_ADDRESS='+account.address);
