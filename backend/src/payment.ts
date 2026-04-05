import { GatewayClient } from '@circle-fin/x402-batching/client';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import type { RequestHandler, Request, Response, NextFunction } from 'express';

export const MAX_DEAL_USDC = 1.0;

// ── Seller middleware ────────────────────────────────────────────────────────

let _gatewayMiddleware: ReturnType<typeof createGatewayMiddleware> | null = null;

export function getGatewayMiddleware() {
  const sellerAddress = process.env.SELLER_ADDRESS as `0x${string}`;
  if (!sellerAddress) throw new Error('SELLER_ADDRESS not set');
  if (!_gatewayMiddleware) {
    _gatewayMiddleware = createGatewayMiddleware({ sellerAddress });
  }
  return _gatewayMiddleware;
}

/** Express middleware: require fixed amount to access a route (for /service/data-query demo) */
export function requirePayment(amount = '$0.005'): RequestHandler {
  if (!process.env.SELLER_ADDRESS) {
    return (_req, _res, next) => next();
  }
  return getGatewayMiddleware().require(amount) as RequestHandler;
}

/**
 * Express middleware factory: require a dynamic amount payable to a specific address.
 * Used by /service/deal-payment to route funds to individual seller Arc wallets.
 */
export function requireDynamicPayment(sellerAddress: string, amount: number): RequestHandler {
  const capped = Math.min(amount, MAX_DEAL_USDC);
  const mw = createGatewayMiddleware({ sellerAddress: sellerAddress as `0x${string}` });
  return mw.require(`$${capped.toFixed(4)}`) as RequestHandler;
}

// ── Buyer client ─────────────────────────────────────────────────────────────

let _buyerClient: GatewayClient | null = null;

export function getBuyerClient(): GatewayClient {
  const privateKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
  if (!privateKey) throw new Error('BUYER_PRIVATE_KEY not set');
  if (!_buyerClient) {
    _buyerClient = new GatewayClient({ chain: 'arcTestnet', privateKey });
  }
  return _buyerClient;
}

// ── Payment flow ─────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE_URL ?? 'https://agentexpo-production.up.railway.app';

export async function processPayment(
  buyerHandle: string,
  sellerHandle: string,
  amountUsdc: number,
  sellerArcAddress?: string
): Promise<{ arc_tx_hash: string; arc_explorer_url: string; amount_usdc: number; simulated: boolean }> {

  const capped = Math.min(amountUsdc, MAX_DEAL_USDC);

  if (!process.env.BUYER_PRIVATE_KEY) {
    return simulatePayment(buyerHandle, sellerHandle, capped);
  }

  try {
    const client = getBuyerClient();

    // If we have the seller's Arc address, route payment directly to them
    // via the dynamic /service/deal-payment endpoint.
    // Circle Gateway handles EIP-712 signatures — no ETH for gas needed.
    const url = sellerArcAddress
      ? `${API_BASE}/service/deal-payment?amount=${capped.toFixed(4)}&to=${encodeURIComponent(sellerArcAddress)}`
      : `${API_BASE}/service/data-query`;

    const response = await client.pay(url);
    const ref = response.transaction;

    return {
      arc_tx_hash: ref,
      arc_explorer_url: ref.startsWith('0x')
        ? `https://testnet.arcscan.app/tx/${ref}`
        : `https://gateway-api-testnet.circle.com/payments/${ref}`,
      amount_usdc: capped,
      simulated: false,
    };
  } catch (err) {
    console.error('Circle Gateway payment failed, falling back to simulation:', err);
    return simulatePayment(buyerHandle, sellerHandle, capped);
  }
}

function simulatePayment(buyer: string, seller: string, amount: number) {
  const seed = `${buyer}${seller}${amount}${Date.now()}`;
  const hash = '0x' + Buffer.from(seed).toString('hex').padEnd(64, '0').slice(0, 64);
  return {
    arc_tx_hash: hash,
    arc_explorer_url: `https://testnet.arcscan.app/tx/${hash}`,
    amount_usdc: amount,
    simulated: true,
  };
}
