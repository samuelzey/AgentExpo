import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import express from 'express';
import { randomBytes } from 'crypto';
import {
  createProfile, getProfile, getAllProfiles,
  createSponsor, getSponsor, getAllSponsors, getProfilesBySponsor,
  setSponsorLogo,
  saveConversation, getConversationsFor,
  claimFaucet, getUsdcBalance, adjustUsdcBalance,
} from './database.js';
import { getTopMatches } from './matching.js';
import { runConversation } from './conversation.js';
import { processPayment, requirePayment, getGatewayMiddleware, getBuyerClient, MAX_DEAL_USDC } from './payment.js';
import { uploadDealRecord } from './storage.js';

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

const PORT = process.env.PORT ?? 8000;

// In-memory active conversations tracker
const activeConversations = new Set<string>(); // "handleA|handleB"


// ── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '3.0' });
});

// ── EthCC[9] mock page ───────────────────────────────────────────────────────

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

app.get('/', (_req, res) => {
  res.sendFile(join(rootDir, 'app.html'));
});

app.get('/floor', (_req, res) => {
  res.sendFile(join(rootDir, 'floor.html'));
});

app.get('/ethcc', (_req, res) => {
  res.sendFile(join(rootDir, 'index.html'));
});

app.get('/ethereum_logo.mp4', (_req, res) => {
  res.sendFile(join(rootDir, 'ethereum_logo.mp4'));
});

// ── Skill ────────────────────────────────────────────────────────────────────

app.get('/skill.md', (_req, res) => {
  const skillPath = join(dirname(fileURLToPath(import.meta.url)), '../../skill.md');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(skillPath);
});

// ── Sponsors ──────────────────────────────────────────────────────────────────

app.get('/sponsors', (_req, res) => {
  res.json(getAllSponsors());
});

app.post('/register-sponsor', (req, res) => {
  const { slug, name, description } = req.body as {
    slug: string; name: string; description: string;
  };
  if (!slug || !name || !description) {
    res.status(400).json({ error: 'slug, name, description are required' });
    return;
  }
  try {
    const sponsor = createSponsor(slug, name, description);
    res.json(sponsor);
  } catch {
    res.status(400).json({ error: 'Sponsor slug already exists' });
  }
});

app.post('/sponsors/:slug/logo', (req, res) => {
  const sponsor = getSponsor(req.params.slug);
  if (!sponsor) { res.status(404).json({ error: 'Sponsor not found' }); return; }
  const { logo_data } = req.body as { logo_data: string };
  if (!logo_data?.startsWith('data:image/')) {
    res.status(400).json({ error: 'logo_data must be a base64 data URL' }); return;
  }
  setSponsorLogo(req.params.slug, logo_data);
  res.json({ ok: true });
});

app.get('/sponsors/:slug/members', (req, res) => {
  const sponsor = getSponsor(req.params.slug);
  if (!sponsor) { res.status(404).json({ error: 'Sponsor not found' }); return; }
  const members = getProfilesBySponsor(req.params.slug);
  res.json({ sponsor, members });
});

// ── Register ─────────────────────────────────────────────────────────────────

app.post('/register', async (req, res) => {
  const { handle_slug, profile_text, goals, sponsor_slug } = req.body as {
    handle_slug: string; profile_text: string; goals: string; sponsor_slug?: string;
  };
  if (!handle_slug || !profile_text || !goals) {
    res.status(400).json({ error: 'handle_slug, profile_text, goals are required' });
    return;
  }
  const handle = `@${handle_slug}-${randomBytes(3).toString('hex')}`;
  const { ethers } = await import('ethers');
  const arcWallet = ethers.Wallet.createRandom();
  try {
    const profile = createProfile(handle, profile_text, goals, sponsor_slug, arcWallet.address);
    res.json({ handle, profile_id: profile.id, sponsor_slug: profile.sponsor_slug, arc_address: arcWallet.address, usdc_balance: 0 });
  } catch {
    res.status(400).json({ error: 'Handle already exists' });
  }
});

// ── Floor data ────────────────────────────────────────────────────────────────

app.get('/api/floor', (_req, res) => {
  const agents = getAllProfiles().map(p => ({
    handle: p.handle,
    initials: p.handle.replace('@','').slice(0,2).toUpperCase(),
    sponsor_slug: p.sponsor_slug,
    arc_address: p.arc_address,
  }));
  const sponsors = getAllSponsors().map(s => ({
    slug: s.slug,
    name: s.name,
    logo_data: s.logo_data,
  }));
  const active = Array.from(activeConversations).map(key => {
    const [a, b] = key.split('|');
    return { agent_a: a, agent_b: b };
  });
  res.json({ agents, sponsors, active_conversations: active });
});

// ── Gateway balance ───────────────────────────────────────────────────────────

app.get('/gateway-balance', async (_req, res) => {
  try {
    const client = getBuyerClient();
    const balances = await client.getBalances();
    res.json({ usdc: balances.gateway.formattedAvailable });
  } catch (err) {
    res.json({ usdc: null, error: String(err) });
  }
});

// ── Faucet ────────────────────────────────────────────────────────────────────
// Credits 1 USDC to the agent's tracked balance in the DB — no ETH for gas needed.

app.post('/faucet', (req, res) => {
  const { handle } = req.body as { handle: string };
  if (!handle) { res.status(400).json({ error: 'handle is required' }); return; }

  const profile = getProfile(handle);
  if (!profile) { res.status(404).json({ error: `${handle} not found` }); return; }

  const result = claimFaucet(handle);
  if (!result.ok) {
    res.status(400).json({ error: result.error }); return;
  }
  res.json({ ok: true, amount_usdc: 1.0, new_balance: result.balance, arc_address: profile.arc_address });
});

// ── Match ─────────────────────────────────────────────────────────────────────

app.get('/match/:handle', async (req, res) => {
  const profile = getProfile(req.params.handle);
  if (!profile) { res.status(404).json({ error: 'Agent not found' }); return; }
  const all = getAllProfiles();
  if (all.length < 2) { res.json([]); return; }
  try {
    const matches = await getTopMatches(req.params.handle, all, profile);
    res.json(matches);
  } catch (err) {
    console.error('Match error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Converse ──────────────────────────────────────────────────────────────────

app.post('/converse', async (req, res) => {
  const { agent_a_handle, agent_b_handle } = req.body as {
    agent_a_handle: string; agent_b_handle: string;
  };
  const profileA = getProfile(agent_a_handle);
  const profileB = getProfile(agent_b_handle);
  if (!profileA) { res.status(404).json({ error: `${agent_a_handle} not found` }); return; }
  if (!profileB) { res.status(404).json({ error: `${agent_b_handle} not found` }); return; }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');

  const convKey = `${agent_a_handle}|${agent_b_handle}`;
  activeConversations.add(convKey);

  try {
    // Snapshot balance before conversation
    let balanceBefore: string | null = null;
    try {
      const client = getBuyerClient();
      const b = await client.getBalances();
      balanceBefore = b.gateway.formattedAvailable;
    } catch {}

    const { messages, outcome, dealAmount } = await runConversation(profileA, profileB);

    for (const msg of messages) {
      res.write(JSON.stringify({ type: 'msg', payload: msg }) + '\n');
    }

    let arcTxHash: string | undefined;
    if (outcome === 'deal' && dealAmount) {
      const amount  = Math.min(dealAmount, MAX_DEAL_USDC);
      const payment = await processPayment(agent_a_handle, agent_b_handle, amount);
      arcTxHash = payment.arc_tx_hash;
      // Update tracked USDC balances
      adjustUsdcBalance(agent_a_handle, -amount);
      adjustUsdcBalance(agent_b_handle, +amount);
      res.write(JSON.stringify({ type: 'payment', payload: { ...payment, deal_amount_usdc: amount } }) + '\n');
    }

    // Upload deal record to 0G Storage (async, non-blocking for stream)
    let zgRootHash: string | undefined;
    let zgTxHash: string | undefined;
    if (outcome === 'deal') {
      const zgResult = await uploadDealRecord({
        agent_a: agent_a_handle,
        agent_b: agent_b_handle,
        messages,
        outcome,
        deal_amount_usdc: dealAmount ?? null,
        arc_tx_hash: arcTxHash ?? null,
        timestamp: new Date().toISOString(),
      });
      if (zgResult) {
        zgRootHash = zgResult.root_hash;
        zgTxHash   = zgResult.tx_hash;
        res.write(JSON.stringify({ type: 'storage', payload: { zg_root_hash: zgRootHash, zg_tx_hash: zgTxHash } }) + '\n');
      }
    }

    // Snapshot balance after deal
    let balanceAfter: string | null = null;
    if (outcome === 'deal') {
      try {
        const client = getBuyerClient();
        const b = await client.getBalances();
        balanceAfter = b.gateway.formattedAvailable;
      } catch {}
    }

    saveConversation(agent_a_handle, agent_b_handle, messages, outcome, dealAmount ?? undefined, arcTxHash, zgRootHash, zgTxHash);
    res.write(JSON.stringify({ type: 'outcome', payload: {
      outcome, deal_amount_usdc: dealAmount, arc_tx_hash: arcTxHash,
      zg_root_hash: zgRootHash, zg_tx_hash: zgTxHash,
      balance_before: balanceBefore, balance_after: balanceAfter,
      buyer_arc_address: profileA.arc_address, seller_arc_address: profileB.arc_address,
    }}) + '\n');
  } catch (err) {
    console.error('Converse error:', err);
    res.write(JSON.stringify({ type: 'error', payload: { message: String(err) } }) + '\n');
  } finally {
    activeConversations.delete(convKey);
  }

  res.end();
});

// ── x402 protected service endpoint — dynamic amount via ?amount=X ───────────

app.get('/service/data-query', (req, res, next) => {
  if (!process.env.SELLER_ADDRESS) { next(); return; }
  const raw    = parseFloat(req.query.amount as string);
  const amount = isNaN(raw) ? 0.05 : Math.min(raw, MAX_DEAL_USDC);
  const mw     = getGatewayMiddleware().require(`$${amount.toFixed(4)}`);
  (mw as any)(req, res, next);
}, (req, res) => {
  res.json({
    data: 'DeFi on-chain analytics — 30d volume, TVL, wallet cohorts',
    paid_by: (req as any).payment?.payer ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// ── Debug: check which payment env vars are configured ────────────────────────

app.get('/debug/payment', (_req, res) => {
  res.json({
    BUYER_PRIVATE_KEY: !!process.env.BUYER_PRIVATE_KEY,
    SELLER_ADDRESS:    !!process.env.SELLER_ADDRESS,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    mode: (process.env.BUYER_PRIVATE_KEY && process.env.SELLER_ADDRESS) ? 'real' : 'simulated',
  });
});


// ── Pay (direct) ──────────────────────────────────────────────────────────────

app.post('/pay', async (req, res) => {
  const { buyer_handle, seller_handle, amount_usdc = 0.005 } = req.body as {
    buyer_handle: string; seller_handle: string; amount_usdc?: number;
  };
  if (!getProfile(buyer_handle)) { res.status(404).json({ error: `${buyer_handle} not found` }); return; }
  if (!getProfile(seller_handle)) { res.status(404).json({ error: `${seller_handle} not found` }); return; }
  const result = await processPayment(buyer_handle, seller_handle, amount_usdc);
  res.json(result);
});

// ── Recap ─────────────────────────────────────────────────────────────────────

app.get('/recap/:handle', (req, res) => {
  const profile = getProfile(req.params.handle);
  if (!profile) { res.status(404).json({ error: 'Agent not found' }); return; }

  const convos = getConversationsFor(req.params.handle);
  const deals = convos.filter(c => c.outcome === 'deal');
  const passes = convos.filter(c => c.outcome === 'pass');
  const spent = deals.filter(c => c.agent_a === req.params.handle).reduce((s, c) => s + (c.deal_amount_usdc ?? 0), 0);
  const earned = deals.filter(c => c.agent_b === req.params.handle).reduce((s, c) => s + (c.deal_amount_usdc ?? 0), 0);

  res.json({
    handle: req.params.handle,
    conversations: convos.map(c => ({
      with: c.agent_a === req.params.handle ? c.agent_b : c.agent_a,
      outcome: c.outcome,
      deal_amount_usdc: c.deal_amount_usdc,
      arc_tx_hash: c.arc_tx_hash,
      zg_root_hash: (c as any).zg_root_hash ?? null,
      zg_tx_hash: (c as any).zg_tx_hash ?? null,
      message_count: c.messages.length,
    })),
    deals: deals.length,
    passes: passes.length,
    spent_usdc: +spent.toFixed(6),
    earned_usdc: +earned.toFixed(6),
  });
});

app.listen(PORT, () => console.log(`AgentExpo API running on port ${PORT}`));
