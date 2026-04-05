import { GatewayClient } from '@circle-fin/x402-batching/client';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import type { RequestHandler } from 'express';

// ── Arc testnet USDC ──────────────────────────────────────────────────────────

const ARC_RPC          = 'https://rpc.testnet.arc.network';
const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];
const USDC_DECIMALS = 6;
export const MAX_DEAL_USDC = 1.0;

/**
 * Send USDC directly on-chain (Arc testnet) from the BUYER_PRIVATE_KEY wallet.
 * Amount is capped at MAX_DEAL_USDC.
 */
export async function sendArcUSDC(
  toAddress: string,
  amountUsdc: number
): Promise<{ tx_hash: string; amount_usdc: number }> {
  const { ethers } = await import('ethers');
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) throw new Error('BUYER_PRIVATE_KEY not set');

  const capped     = Math.min(amountUsdc, MAX_DEAL_USDC);
  const amountRaw  = BigInt(Math.round(capped * 10 ** USDC_DECIMALS));

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const usdc     = new ethers.Contract(ARC_USDC_ADDRESS, USDC_ABI, wallet);

  // Log pre-transfer balance
  try {
    const bal = await usdc.balanceOf(wallet.address);
    console.log(`Arc USDC balance: ${(Number(bal) / 1e6).toFixed(6)} USDC  (sending ${capped} to ${toAddress})`);
  } catch {}

  const tx      = await usdc.transfer(toAddress, amountRaw);
  const receipt = await tx.wait();
  console.log(`Arc USDC sent: ${receipt.hash}`);
  return { tx_hash: receipt.hash, amount_usdc: capped };
}

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

/** Express middleware: require $0.005 USDC to access a route */
export function requirePayment(amount = '$0.005'): RequestHandler {
  if (!process.env.SELLER_ADDRESS) {
    return (_req, _res, next) => next();
  }
  return getGatewayMiddleware().require(amount) as RequestHandler;
}

// ── Buyer client (Circle Gateway) ────────────────────────────────────────────

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

export async function processPayment(
  buyerHandle: string,
  sellerHandle: string,
  amountUsdc: number,
  sellerArcAddress?: string
): Promise<{ arc_tx_hash: string; arc_explorer_url: string; amount_usdc: number; simulated: boolean }> {

  // Hard cap
  const capped = Math.min(amountUsdc, MAX_DEAL_USDC);

  if (!process.env.BUYER_PRIVATE_KEY) {
    return simulatePayment(buyerHandle, sellerHandle, capped);
  }

  // Preferred: direct on-chain USDC transfer to seller's Arc wallet
  if (sellerArcAddress) {
    try {
      const result = await sendArcUSDC(sellerArcAddress, capped);
      return {
        arc_tx_hash: result.tx_hash,
        arc_explorer_url: `https://testnet.arcscan.app/tx/${result.tx_hash}`,
        amount_usdc: result.amount_usdc,
        simulated: false,
      };
    } catch (err) {
      console.error('Arc on-chain USDC transfer failed, falling back to simulation:', err);
      return simulatePayment(buyerHandle, sellerHandle, capped);
    }
  }

  // Fallback: x402 Circle Gateway (if no seller arc address)
  if (!process.env.SELLER_ADDRESS) {
    return simulatePayment(buyerHandle, sellerHandle, capped);
  }
  try {
    const client = getBuyerClient();
    const url    = `${process.env.API_BASE_URL ?? 'https://agentexpo-production.up.railway.app'}/service/data-query`;
    const response = await client.pay(url);
    const ref = response.transaction;
    return {
      arc_tx_hash: ref,
      arc_explorer_url: ref.startsWith('0x')
        ? `https://testnet.arcscan.app/tx/${ref}`
        : `https://gateway-api-testnet.circle.com/payments/${ref}`,
      amount_usdc: Number(response.formattedAmount),
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
