import 'dotenv/config';
import express from 'express';
import { randomBytes } from 'crypto';
import {
  createProfile, getProfile, getAllProfiles,
  saveConversation, getConversationsFor
} from './database.js';
import { getTopMatches } from './matching.js';
import { runConversation } from './conversation.js';
import { processPayment, requirePayment } from './payment.js';

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

const PORT = process.env.PORT ?? 8000;

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '3.0' });
});

// ── Register ─────────────────────────────────────────────────────────────────

app.post('/register', (req, res) => {
  const { handle_slug, profile_text, goals } = req.body as {
    handle_slug: string; profile_text: string; goals: string;
  };
  if (!handle_slug || !profile_text || !goals) {
    res.status(400).json({ error: 'handle_slug, profile_text, goals are required' });
    return;
  }
  const handle = `@${handle_slug}-${randomBytes(3).toString('hex')}`;
  try {
    const profile = createProfile(handle, profile_text, goals);
    res.json({ handle, profile_id: profile.id });
  } catch {
    res.status(400).json({ error: 'Handle already exists' });
  }
});

// ── Match ─────────────────────────────────────────────────────────────────────

app.get('/match/:handle', async (req, res) => {
  const profile = getProfile(req.params.handle);
  if (!profile) { res.status(404).json({ error: 'Agent not found' }); return; }
  const all = getAllProfiles();
  if (all.length < 2) { res.json([]); return; }
  const matches = await getTopMatches(req.params.handle, all, profile);
  res.json(matches);
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

  const { messages, outcome, dealAmount } = await runConversation(profileA, profileB);

  for (const msg of messages) {
    res.write(JSON.stringify({ type: 'msg', payload: msg }) + '\n');
  }

  let arcTxHash: string | undefined;
  if (outcome === 'deal' && dealAmount) {
    const payment = await processPayment(agent_a_handle, agent_b_handle, dealAmount);
    arcTxHash = payment.arc_tx_hash;
    res.write(JSON.stringify({ type: 'payment', payload: payment }) + '\n');
  }

  saveConversation(agent_a_handle, agent_b_handle, messages, outcome, dealAmount ?? undefined, arcTxHash);
  res.write(JSON.stringify({ type: 'outcome', payload: { outcome, deal_amount_usdc: dealAmount, arc_tx_hash: arcTxHash } }) + '\n');
  res.end();
});

// ── x402 protected service endpoint (seller side demo) ───────────────────────

app.get('/service/data-query', requirePayment('$0.005'), (req, res) => {
  res.json({
    data: 'DeFi on-chain analytics — 30d volume, TVL, wallet cohorts',
    paid_by: (req as any).payment?.payer ?? 'unknown',
    timestamp: new Date().toISOString(),
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
      message_count: c.messages.length,
    })),
    deals: deals.length,
    passes: passes.length,
    spent_usdc: +spent.toFixed(6),
    earned_usdc: +earned.toFixed(6),
  });
});

app.listen(PORT, () => console.log(`AgentExpo API running on port ${PORT}`));
