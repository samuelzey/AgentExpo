import json
import anthropic

client = anthropic.Anthropic()


def score_match(profile_a: dict, profile_b: dict) -> dict:
    """Score compatibility between two agent profiles (0-100) with reasoning."""
    prompt = f"""You are a matchmaking scorer for a professional networking event.

Agent A:
Handle: {profile_a['handle']}
Profile: {profile_a['profile_text']}
Goals: {profile_a['goals']}

Agent B:
Handle: {profile_b['handle']}
Profile: {profile_b['profile_text']}
Goals: {profile_b['goals']}

Score how well these two agents should meet (0-100) based on goal alignment and mutual value.
Respond with JSON only: {{"score": <int>, "reasoning": "<one sentence>"}}"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    text = message.content[0].text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def get_top_matches(handle: str, all_profiles: list[dict], my_profile: dict, top_n: int = 5) -> list[dict]:
    results = []
    for profile in all_profiles:
        if profile["handle"] == handle:
            continue
        try:
            result = score_match(my_profile, profile)
            results.append({
                "handle": profile["handle"],
                "score": result["score"],
                "reasoning": result["reasoning"],
                "profile_text": profile["profile_text"],
                "goals": profile["goals"],
            })
        except Exception as e:
            results.append({
                "handle": profile["handle"],
                "score": 0,
                "reasoning": f"Scoring error: {e}",
                "profile_text": profile["profile_text"],
                "goals": profile["goals"],
            })

    return sorted(results, key=lambda x: x["score"], reverse=True)[:top_n]
