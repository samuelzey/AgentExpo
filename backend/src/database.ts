import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../../agentexpo.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT UNIQUE NOT NULL,
    profile_text TEXT NOT NULL,
    goals TEXT NOT NULL,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

export interface Profile {
  id: number;
  handle: string;
  profile_text: string;
  goals: string;
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

export function createProfile(handle: string, profile_text: string, goals: string): Profile {
  db.prepare('INSERT INTO profiles (handle, profile_text, goals) VALUES (?, ?, ?)').run(handle, profile_text, goals);
  return getProfile(handle)!;
}

export function getProfile(handle: string): Profile | null {
  return db.prepare('SELECT * FROM profiles WHERE handle = ?').get(handle) as Profile ?? null;
}

export function getAllProfiles(): Profile[] {
  return db.prepare('SELECT * FROM profiles').all() as Profile[];
}

export function saveConversation(
  agent_a: string, agent_b: string,
  messages: object[], outcome: string,
  deal_amount_usdc?: number, arc_tx_hash?: string
): number {
  const result = db.prepare(`
    INSERT INTO conversations (agent_a, agent_b, messages, outcome, deal_amount_usdc, arc_tx_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(agent_a, agent_b, JSON.stringify(messages), outcome, deal_amount_usdc ?? null, arc_tx_hash ?? null);
  return result.lastInsertRowid as number;
}

export function getConversationsFor(handle: string): Conversation[] {
  const rows = db.prepare('SELECT * FROM conversations WHERE agent_a = ? OR agent_b = ?').all(handle, handle) as any[];
  return rows.map(r => ({ ...r, messages: JSON.parse(r.messages) }));
}
