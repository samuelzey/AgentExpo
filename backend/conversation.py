import anthropic
from typing import AsyncGenerator

client = anthropic.Anthropic()

MAX_TURNS = 8  # max back-and-forth turns before forcing outcome


def _agent_system_prompt(profile: dict) -> str:
    return f"""You are an AI agent representing a professional at a networking event (AgentExpo).

Your identity:
Handle: {profile['handle']}
Profile: {profile['profile_text']}
Goals: {profile['goals']}

You are having a live conversation with another agent. Be concise (2-4 sentences per turn).
Surface your services, pricing, and needs naturally.
If you find mutual value, propose a deal explicitly with a USDC amount (e.g. "I propose $0.005 USDC for one data query").
If misaligned, politely end the conversation.
End your message with one of these tags on a new line:
[CONTINUE] — keep talking
[DEAL: $X.XXX USDC] — propose/accept a deal
[PASS] — end, no deal"""


def run_conversation(profile_a: dict, profile_b: dict) -> tuple[list[dict], str, float | None]:
    """
    Run a synchronous A2A conversation between two agents.
    Returns (messages, outcome, deal_amount_usdc)
    """
    messages_a = []  # history from A's perspective
    messages_b = []  # history from B's perspective
    log = []

    # A opens
    opening = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system=_agent_system_prompt(profile_a),
        messages=[{"role": "user", "content": "Start the conversation. Introduce yourself and your goals."}],
    )
    a_text = opening.content[0].text
    log.append({"speaker": profile_a["handle"], "text": a_text})
    messages_a.append({"role": "assistant", "content": a_text})
    messages_b.append({"role": "user", "content": f"{profile_a['handle']}: {a_text}"})

    outcome = "pass"
    deal_amount = None

    for _ in range(MAX_TURNS):
        # B responds
        b_resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            system=_agent_system_prompt(profile_b),
            messages=messages_b + [{"role": "user", "content": "Respond to the message above."}],
        )
        b_text = b_resp.content[0].text
        log.append({"speaker": profile_b["handle"], "text": b_text})
        messages_b.append({"role": "assistant", "content": b_text})
        messages_a.append({"role": "user", "content": f"{profile_b['handle']}: {b_text}"})

        if "[PASS]" in b_text:
            outcome = "pass"
            break
        if "[DEAL:" in b_text:
            outcome = "deal"
            deal_amount = _parse_deal_amount(b_text)
            break

        # A responds
        a_resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            system=_agent_system_prompt(profile_a),
            messages=messages_a + [{"role": "user", "content": "Respond to the message above."}],
        )
        a_text = a_resp.content[0].text
        log.append({"speaker": profile_a["handle"], "text": a_text})
        messages_a.append({"role": "assistant", "content": a_text})
        messages_b.append({"role": "user", "content": f"{profile_a['handle']}: {a_text}"})

        if "[PASS]" in a_text:
            outcome = "pass"
            break
        if "[DEAL:" in a_text:
            outcome = "deal"
            deal_amount = _parse_deal_amount(a_text)
            break

    return log, outcome, deal_amount


def _parse_deal_amount(text: str) -> float | None:
    import re
    match = re.search(r"\[DEAL:\s*\$?([\d.]+)", text)
    return float(match.group(1)) if match else 0.005
