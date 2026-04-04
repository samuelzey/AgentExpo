import Anthropic from '@anthropic-ai/sdk';
import type { Profile } from './database.js';

const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_TURNS = 8;

function agentSystemPrompt(profile: Profile): string {
  return `You are an AI agent representing a professional at AgentExpo — the world's first AI-to-AI deal-making event.

Your identity:
Handle: ${profile.handle}
Profile: ${profile.profile_text}
Goals: ${profile.goals}

Be concise (2-4 sentences per turn). Surface your services, pricing, and needs naturally.
If you find mutual value, propose a deal explicitly with a USDC amount (e.g. "I propose $0.005 USDC for one data query").
If misaligned, politely end the conversation.

End every message with one of these tags on a new line:
[CONTINUE] — keep talking
[DEAL: $X.XXX USDC] — propose or accept a deal
[PASS] — end, no deal`;
}

function parseDealAmount(text: string): number {
  const match = text.match(/\[DEAL:\s*\$?([\d.]+)/);
  return match ? parseFloat(match[1]) : 0.005;
}

export interface Message { speaker: string; text: string; }

export async function runConversation(
  profileA: Profile,
  profileB: Profile
): Promise<{ messages: Message[]; outcome: string; dealAmount: number | null }> {
  const log: Message[] = [];
  const historyA: Anthropic.MessageParam[] = [];
  const historyB: Anthropic.MessageParam[] = [];

  // A opens
  const opening = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: agentSystemPrompt(profileA),
    messages: [{ role: 'user', content: 'Start the conversation. Introduce yourself and your goals.' }],
  });
  const aOpen = (opening.content[0] as { text: string }).text;
  log.push({ speaker: profileA.handle, text: aOpen });
  historyA.push({ role: 'assistant', content: aOpen });
  historyB.push({ role: 'user', content: `${profileA.handle}: ${aOpen}` });

  let outcome = 'pass';
  let dealAmount: number | null = null;

  for (let i = 0; i < MAX_TURNS; i++) {
    // B responds
    const bResp = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: agentSystemPrompt(profileB),
      messages: [...historyB, { role: 'user', content: 'Respond.' }],
    });
    const bText = (bResp.content[0] as { text: string }).text;
    log.push({ speaker: profileB.handle, text: bText });
    historyB.push({ role: 'assistant', content: bText });
    historyA.push({ role: 'user', content: `${profileB.handle}: ${bText}` });

    if (bText.includes('[PASS]')) { outcome = 'pass'; break; }
    if (bText.includes('[DEAL:')) { outcome = 'deal'; dealAmount = parseDealAmount(bText); break; }

    // A responds
    const aResp = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: agentSystemPrompt(profileA),
      messages: [...historyA, { role: 'user', content: 'Respond.' }],
    });
    const aText = (aResp.content[0] as { text: string }).text;
    log.push({ speaker: profileA.handle, text: aText });
    historyA.push({ role: 'assistant', content: aText });
    historyB.push({ role: 'user', content: `${profileA.handle}: ${aText}` });

    if (aText.includes('[PASS]')) { outcome = 'pass'; break; }
    if (aText.includes('[DEAL:')) { outcome = 'deal'; dealAmount = parseDealAmount(aText); break; }
  }

  return { messages: log, outcome, dealAmount };
}
