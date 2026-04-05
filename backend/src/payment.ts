import { GatewayClient } from '@circle-fin/x402-batching/client';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import type { RequestHandler } from 'express';

export const MAX_DEAL_USDC = 1.0;

// ── Seller middleware ─────────────────────────────────────────────────────────

let _gatewayMiddleware: ReturnType<typeof createGatewayMiddleware> | null = null;

export function getGatewayMiddleware() {
  const sellerAddress = process.env.SELLER_ADDRESS as `0x${string}`;
  if (!sellerAddress) throw new Error('SELLER_ADDRESS not set');
  if (!_gatewayMiddleware) {
    _gatewayMiddleware = createGatewayMiddleware({ sellerAddress });
  }
  return _gatewayMiddleware;
}

export function requirePayment(amount = '$0.005'): RequestHandler {
  if (!process.env.SELLER_ADDRESS) {
    return (_req, _res, next) => next();
  }
  return getGatewayMiddleware().require(amount) as RequestHandler;
}

// ── Buyer client ──────────────────────────────────────────────────────────────

let _buyerClient: GatewayClient | null = null;

export function getBuyerClient(): GatewayClient {
  const privateKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) throw new Error('BUYER_PRIVATE_KEY not set');
  if (!_buyerClient) {
    _buyerClient = new GatewayClient({ chain: 'arcTestnet', privateKey });
  }
  return _buyerClient;
}

// ── Payment flow ──────────────────────────────────────────────────────────────
//
// Architecture: all real payments go through the single x402-protected
// /service/data-query endpoint (SELLER_ADDRESS receives on-chain).
// Per-agent earnings are tracked in the DB via adjustUsdcBalance().
// This avoids the "server calling itself" problem of a dynamic endpoint.

const API_BASE = process.env.API_BASE_URL ?? 'https://agentexpo-production.up.railway.app';

export async function processPayment(
  buyerHandle: string,
  sellerHandle: string,
  amountUsdc: number,
): Promise<{ arc_tx_hash: string; arc_explorer_url: string; amount_usdc: number; simulated: boolean }> {

  const capped = Math.min(amountUsdc, MAX_DEAL_USDC);

  if (!process.env.BUYER_PRIVATE_KEY || !process.env.SELLER_ADDRESS) {
    return simulatePayment(buyerHandle, sellerHandle, capped);
  }

  try {
    const client = getBuyerClient();
    const url    = `${API_BASE}/service/data-query`;
    const response = await client.pay(url);
    const ref = response.transaction;
    console.log(`Circle Gateway payment OK: ${ref}  amount=${capped}`);
    return {
      arc_tx_hash: ref,
      arc_explorer_url: ref.startsWith('0x')
        ? `https://testnet.arcscan.app/tx/${ref}`
        : `https://gateway-api-testnet.circle.com/payments/${ref}`,
      amount_usdc: capped,
      simulated: false,
    };
  } catch (err) {
    console.error('Circle Gateway payment failed, simulating:', err);
    return simulatePayment(buyerHandle, sellerHandle, capped);
  }
}

function simulatePayment(buyer: string, seller: string, amount: number) {
  // Use random bytes so the hash doesn't leak handle names
  const rand = Math.random().toString(16).slice(2).padEnd(62, '0');
  const hash = `0xSIM${rand}`.slice(0, 66);
  return {
    arc_tx_hash: hash,
    arc_explorer_url: `https://testnet.arcscan.app/tx/${hash}`,
    amount_usdc: amount,
    simulated: true,
  };
}
