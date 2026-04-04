import json
import uuid
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from database import init_db, create_profile, get_profile, get_all_profiles, save_conversation, get_conversations_for
from matching import get_top_matches
from conversation import run_conversation
from payment import process_payment

app = FastAPI(title="AgentExpo API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


# ── Models ──────────────────────────────────────────────

class RegisterRequest(BaseModel):
    handle_slug: str
    profile_text: str
    goals: str

class ConversationRequest(BaseModel):
    agent_a_handle: str
    agent_b_handle: str

class PayRequest(BaseModel):
    buyer_handle: str
    seller_handle: str
    service_id: str = "data-query"
    amount_usdc: float = 0.005


# ── Routes ──────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/register")
def register(req: RegisterRequest):
    handle = f"@{req.handle_slug}-{uuid.uuid4().hex[:6]}"
    existing = get_profile(handle)
    if existing:
        raise HTTPException(400, "Handle already exists")
    profile = create_profile(handle, req.profile_text, req.goals)
    return {"handle": handle, "profile_id": profile["id"]}


@app.get("/match/{handle}")
def match(handle: str):
    profile = get_profile(handle)
    if not profile:
        raise HTTPException(404, f"Agent {handle} not found")
    all_profiles = get_all_profiles()
    if len(all_profiles) < 2:
        return []
    matches = get_top_matches(handle, all_profiles, profile)
    return matches


@app.post("/converse")
def converse(req: ConversationRequest):
    profile_a = get_profile(req.agent_a_handle)
    profile_b = get_profile(req.agent_b_handle)
    if not profile_a:
        raise HTTPException(404, f"Agent {req.agent_a_handle} not found")
    if not profile_b:
        raise HTTPException(404, f"Agent {req.agent_b_handle} not found")

    def stream():
        messages, outcome, deal_amount = run_conversation(profile_a, profile_b)

        for msg in messages:
            yield json.dumps({"type": "msg", "payload": msg}) + "\n"

        arc_tx_hash = None
        if outcome == "deal" and deal_amount:
            payment = process_payment(req.agent_a_handle, req.agent_b_handle, deal_amount)
            arc_tx_hash = payment["arc_tx_hash"]
            yield json.dumps({"type": "payment", "payload": payment}) + "\n"

        save_conversation(
            req.agent_a_handle, req.agent_b_handle,
            messages, outcome, deal_amount, arc_tx_hash
        )
        yield json.dumps({"type": "outcome", "payload": {"outcome": outcome, "deal_amount_usdc": deal_amount, "arc_tx_hash": arc_tx_hash}}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/pay")
def pay(req: PayRequest):
    buyer = get_profile(req.buyer_handle)
    seller = get_profile(req.seller_handle)
    if not buyer:
        raise HTTPException(404, f"Buyer {req.buyer_handle} not found")
    if not seller:
        raise HTTPException(404, f"Seller {req.seller_handle} not found")
    result = process_payment(req.buyer_handle, req.seller_handle, req.amount_usdc)
    return result


@app.get("/recap/{handle}")
def recap(handle: str):
    profile = get_profile(handle)
    if not profile:
        raise HTTPException(404, f"Agent {handle} not found")
    convos = get_conversations_for(handle)
    deals = [c for c in convos if c["outcome"] == "deal"]
    passes = [c for c in convos if c["outcome"] == "pass"]

    spent = sum(c["deal_amount_usdc"] or 0 for c in deals if c["agent_a"] == handle)
    earned = sum(c["deal_amount_usdc"] or 0 for c in deals if c["agent_b"] == handle)

    return {
        "handle": handle,
        "conversations": [
            {
                "with": c["agent_b"] if c["agent_a"] == handle else c["agent_a"],
                "outcome": c["outcome"],
                "deal_amount_usdc": c["deal_amount_usdc"],
                "arc_tx_hash": c["arc_tx_hash"],
                "message_count": len(c["messages"]),
            }
            for c in convos
        ],
        "deals": len(deals),
        "passes": len(passes),
        "spent_usdc": round(spent, 6),
        "earned_usdc": round(earned, 6),
    }
