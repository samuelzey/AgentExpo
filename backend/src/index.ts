import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import express from 'express';
import { randomBytes } from 'crypto';
import {
  createProfile, getProfile, getAllProfiles,
  createSponsor, getSponsor, getAllSponsors, getProfilesBySponsor,
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

// ── EthCC[9] mock page ───────────────────────────────────────────────────────

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

app.get('/', (_req, res) => {
  res.sendFile(join(rootDir, 'app.html'));
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

app.get('/sponsors/:slug/members', (req, res) => {
  const sponsor = getSponsor(req.params.slug);
  if (!sponsor) { res.status(404).json({ error: 'Sponsor not found' }); return; }
  const members = getProfilesBySponsor(req.params.slug);
  res.json({ sponsor, members });
});

// ── Register ─────────────────────────────────────────────────────────────────

app.post('/register', (req, res) => {
  const { handle_slug, profile_text, goals, sponsor_slug } = req.body as {
    handle_slug: string; profile_text: string; goals: string; sponsor_slug?: string;
  };
  if (!handle_slug || !profile_text || !goals) {
    res.status(400).json({ error: 'handle_slug, profile_text, goals are required' });
    return;
  }
  const handle = `@${handle_slug}-${randomBytes(3).toString('hex')}`;
  try {
    const profile = createProfile(handle, profile_text, goals, sponsor_slug);
    res.json({ handle, profile_id: profile.id, sponsor_slug: profile.sponsor_slug });
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

  try {
    const { messages, outcome, dealAmount } = await runConversation(profileA, profileB);

    for (const msg of messages) {
      res.write(JSON.stringify({ type: 'msg', payload: msg }) + '\n');
    }

    let arcTxHash: string | undefined;
    if (outcome === 'deal' && dealAmount) {
      // x402 demo payment is always $0.005 USDC (the hardcoded service price).
      // The negotiated dealAmount is stored for record-keeping only.
      const payment = await processPayment(agent_a_handle, agent_b_handle, 0.005);
      arcTxHash = payment.arc_tx_hash;
      res.write(JSON.stringify({ type: 'payment', payload: { ...payment, deal_amount_usdc: dealAmount } }) + '\n');
    }

    saveConversation(agent_a_handle, agent_b_handle, messages, outcome, dealAmount ?? undefined, arcTxHash);
    res.write(JSON.stringify({ type: 'outcome', payload: { outcome, deal_amount_usdc: dealAmount, arc_tx_hash: arcTxHash } }) + '\n');
  } catch (err) {
    console.error('Converse error:', err);
    res.write(JSON.stringify({ type: 'error', payload: { message: String(err) } }) + '\n');
  }

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
