import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../../agentexpo.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    logo_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT UNIQUE NOT NULL,
    profile_text TEXT NOT NULL,
    goals TEXT NOT NULL,
    arc_address TEXT,
    sponsor_slug TEXT REFERENCES sponsors(slug),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_a TEXT NOT NULL,
    agent_b TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    outcome TEXT,
    deal_amount_usdc REAL,
    arc_tx_hash TEXT,
    zg_root_hash TEXT,
    zg_tx_hash TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrations
try { db.exec('ALTER TABLE profiles ADD COLUMN sponsor_slug TEXT REFERENCES sponsors(slug)'); } catch {}
try { db.exec('ALTER TABLE profiles ADD COLUMN arc_address TEXT'); } catch {}
try { db.exec('ALTER TABLE profiles ADD COLUMN usdc_balance REAL NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE profiles ADD COLUMN faucet_claimed INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE conversations ADD COLUMN zg_root_hash TEXT'); } catch {}
try { db.exec('ALTER TABLE conversations ADD COLUMN zg_tx_hash TEXT'); } catch {}
try { db.exec('ALTER TABLE sponsors ADD COLUMN logo_data TEXT'); } catch {}

export interface Sponsor {
  id: number;
  slug: string;
  name: string;
  description: string;
  logo_data: string | null;
  created_at: string;
}

export function setSponsorLogo(slug: string, logo_data: string): void {
  db.prepare('UPDATE sponsors SET logo_data = ? WHERE slug = ?').run(logo_data, slug);
}

export interface Profile {
  id: number;
  handle: string;
  profile_text: string;
  goals: string;
  arc_address: string | null;
  sponsor_slug: string | null;
  usdc_balance: number;
  faucet_claimed: number; // 0 or 1
  created_at: string;
}

export interface Conversation {
  id: number;
  agent_a: string;
  agent_b: string;
  messages: { speaker: string; text: string }[];
  outcome: string;
  deal_amount_usdc: number | null;
  arc_tx_hash: string | null;
  created_at: string;
}

export function createSponsor(slug: string, name: string, description: string): Sponsor {
  db.prepare('INSERT INTO sponsors (slug, name, description) VALUES (?, ?, ?)').run(slug, name, description);
  return getSponsor(slug)!;
}

export function getSponsor(slug: string): Sponsor | null {
  return db.prepare('SELECT * FROM sponsors WHERE slug = ?').get(slug) as Sponsor ?? null;
}

export function getAllSponsors(): Sponsor[] {
  return db.prepare('SELECT * FROM sponsors ORDER BY name').all() as Sponsor[];
}

export function createProfile(handle: string, profile_text: string, goals: string, sponsor_slug?: string, arc_address?: string): Profile {
  db.prepare('INSERT INTO profiles (handle, profile_text, goals, sponsor_slug, arc_address) VALUES (?, ?, ?, ?, ?)')
    .run(handle, profile_text, goals, sponsor_slug ?? null, arc_address ?? null);
  return getProfile(handle)!;
}

export function getProfile(handle: string): Profile | null {
  return db.prepare('SELECT * FROM profiles WHERE handle = ?').get(handle) as Profile ?? null;
}

export function getAllProfiles(): Profile[] {
  return db.prepare('SELECT * FROM profiles').all() as Profile[];
}

export function getProfilesBySponsor(sponsor_slug: string): Profile[] {
  return db.prepare('SELECT * FROM profiles WHERE sponsor_slug = ?').all(sponsor_slug) as Profile[];
}

export function saveConversation(
  agent_a: string, agent_b: string,
  messages: object[], outcome: string,
  deal_amount_usdc?: number, arc_tx_hash?: string,
  zg_root_hash?: string, zg_tx_hash?: string
): number {
  const result = db.prepare(`
    INSERT INTO conversations (agent_a, agent_b, messages, outcome, deal_amount_usdc, arc_tx_hash, zg_root_hash, zg_tx_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agent_a, agent_b, JSON.stringify(messages), outcome,
    deal_amount_usdc ?? null, arc_tx_hash ?? null,
    zg_root_hash ?? null, zg_tx_hash ?? null);
  return result.lastInsertRowid as number;
}

export function getConversationsFor(handle: string): Conversation[] {
  const rows = db.prepare('SELECT * FROM conversations WHERE agent_a = ? OR agent_b = ?').all(handle, handle) as any[];
  return rows.map(r => ({ ...r, messages: JSON.parse(r.messages) }));
}

// ── USDC balance tracking ─────────────────────────────────────────────────────

export function getUsdcBalance(handle: string): number {
  const row = db.prepare('SELECT usdc_balance FROM profiles WHERE handle = ?').get(handle) as any;
  return row ? (row.usdc_balance ?? 0) : 0;
}

export function claimFaucet(handle: string, tx_ref?: string): { ok: boolean; balance?: number; error?: string } {
  const profile = getProfile(handle);
  if (!profile) return { ok: false, error: 'Profile not found' };
  if (profile.faucet_claimed) return { ok: false, error: 'Already claimed 1 USDC faucet' };
  db.prepare('UPDATE profiles SET usdc_balance = usdc_balance + 1.0, faucet_claimed = 1 WHERE handle = ?').run(handle);
  return { ok: true, balance: getUsdcBalance(handle) };
}

export function adjustUsdcBalance(handle: string, delta: number): number {
  db.prepare('UPDATE profiles SET usdc_balance = MAX(0, usdc_balance + ?) WHERE handle = ?').run(delta, handle);
  return getUsdcBalance(handle);
}
