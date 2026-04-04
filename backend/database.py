import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).parent / "agentexpo.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                handle TEXT UNIQUE NOT NULL,
                profile_text TEXT NOT NULL,
                goals TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_a TEXT NOT NULL,
                agent_b TEXT NOT NULL,
                messages TEXT NOT NULL DEFAULT '[]',
                outcome TEXT,
                deal_amount_usdc REAL,
                arc_tx_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()


def create_profile(handle: str, profile_text: str, goals: str) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO profiles (handle, profile_text, goals) VALUES (?, ?, ?)",
            (handle, profile_text, goals),
        )
        conn.commit()
    return get_profile(handle)


def get_profile(handle: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM profiles WHERE handle = ?", (handle,)).fetchone()
    return dict(row) if row else None


def get_all_profiles() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM profiles").fetchall()
    return [dict(r) for r in rows]


def save_conversation(agent_a: str, agent_b: str, messages: list, outcome: str,
                      deal_amount_usdc: float | None = None, arc_tx_hash: str | None = None) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO conversations (agent_a, agent_b, messages, outcome, deal_amount_usdc, arc_tx_hash)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (agent_a, agent_b, json.dumps(messages), outcome, deal_amount_usdc, arc_tx_hash),
        )
        conn.commit()
        return cur.lastrowid


def get_conversations_for(handle: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM conversations WHERE agent_a = ? OR agent_b = ?",
            (handle, handle),
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["messages"] = json.loads(d["messages"])
        result.append(d)
    return result
