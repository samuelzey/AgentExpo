import Anthropic from '@anthropic-ai/sdk';
import type { Profile } from './database.js';

const client = new Anthropic();

export async function scoreMatch(profileA: Profile, profileB: Profile): Promise<{ score: number; reasoning: string }> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `You are a matchmaking scorer for a professional networking event.

Agent A:
Handle: ${profileA.handle}
Profile: ${profileA.profile_text}
Goals: ${profileA.goals}

Agent B:
Handle: ${profileB.handle}
Profile: ${profileB.profile_text}
Goals: ${profileB.goals}

Score how well these two agents should meet (0-100) based on goal alignment and mutual value.
Respond with JSON only: {"score": <int>, "reasoning": "<one sentence>"}`
    }]
  });

  let text = (message.content[0] as { text: string }).text.trim();
  if (text.startsWith('```')) text = text.split('```')[1].replace(/^json/, '').trim();
  return JSON.parse(text);
}

export async function getTopMatches(handle: string, allProfiles: Profile[], myProfile: Profile, topN = 5) {
  const results = await Promise.all(
    allProfiles
      .filter(p => p.handle !== handle)
      .map(async p => {
        try {
          const { score, reasoning } = await scoreMatch(myProfile, p);
          return { handle: p.handle, score, reasoning, profile_text: p.profile_text, goals: p.goals };
        } catch {
          return { handle: p.handle, score: 0, reasoning: 'Scoring error', profile_text: p.profile_text, goals: p.goals };
        }
      })
  );
  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}
