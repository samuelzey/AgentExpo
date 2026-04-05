import { GatewayClient } from '@circle-fin/x402-batching/client';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import type { RequestHandler } from 'express';

export const MAX_DEAL_USDC = 1.0;

// ── Arc testnet direct USDC transfer (no Circle Gateway needed) ───────────────
const ARC_RPC          = 'https://rpc.testnet.arc.network';
const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const USDC_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export async function sendArcUSDC(
  toAddress: string,
  amountUsdc: number
): Promise<{ tx_hash: string; amount_usdc: number }> {
  const { ethers } = await import('ethers');
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) throw new Error('BUYER_PRIVATE_KEY not set');

  const capped    = Math.min(amountUsdc, MAX_DEAL_USDC);
  const amountRaw = BigInt(Math.round(capped * 1e6));

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const usdc     = new ethers.Contract(ARC_USDC_ADDRESS, USDC_ABI, wallet);

  console.log(`sendArcUSDC: ${capped} USDC → ${toAddress}`);
  const tx      = await usdc.transfer(toAddress, amountRaw);
  const receipt = await tx.wait();
  console.log(`sendArcUSDC done: ${receipt.hash}`);
  return { tx_hash: receipt.hash, amount_usdc: capped };
}

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
    const url    = `${API_BASE}/service/data-query?amount=${capped.toFixed(4)}`;
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
