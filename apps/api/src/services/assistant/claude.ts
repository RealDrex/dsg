import Anthropic from '@anthropic-ai/sdk';
import { RespondInput, runTool, TOOL_DEFS, type ToolContext } from './tools';
import { SYSTEM_PROMPT } from './prompt';

const MAX_STEPS = 8;

export class AssistantUnavailable extends Error {}

/**
 * Runs one advisor turn with Claude: a manual tool-use loop that ends when
 * the model calls `respond`. Raw tool turns stay inside this call (append
 * only); only the rendered answer is persisted.
 */
export async function claudeTurn(
  client: Anthropic,
  model: string,
  history: Anthropic.Beta.BetaMessageParam[],
  userContext: string,
  ctx: ToolContext,
): Promise<RespondInput | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history];
  for (let step = 0; step < MAX_STEPS; step++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: userContext },
        ],
        tools: TOOL_DEFS,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new AssistantUnavailable('rate_limited');
      if (err instanceof Anthropic.AuthenticationError) throw new AssistantUnavailable('auth');
      if (err instanceof Anthropic.APIError) throw new AssistantUnavailable(`api_${err.status ?? 'error'}`);
      throw new AssistantUnavailable('network');
    }

    if (response.stop_reason === 'refusal') {
      return null; // the caller shows a polite decline
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const respond = toolUses.find((t) => t.name === 'respond');
    if (respond) {
      const parsed = RespondInput.safeParse(respond.input);
      if (parsed.success) return parsed.data;
    }

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (toolUses.length === 0 || response.stop_reason === 'max_tokens') {
      // The model answered in plain text instead of calling respond.
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      return RespondInput.parse({ text: text || '…' });
    }

    messages.push({ role: 'assistant', content: response.content });
    // Execute all tool calls of this step and return every result in one user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (t) => {
        if (t.name === 'respond') {
          return { type: 'tool_result' as const, tool_use_id: t.id, is_error: true, content: 'Invalid respond input; text is required and lists must be short. Call respond again.' };
        }
        try {
          const out = await runTool(t.name, t.input, ctx);
          return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(out) };
        } catch (e) {
          const msg = e instanceof Error && e.name === 'ZodError' ? 'invalid input' : e instanceof Error ? e.message : 'error';
          return { type: 'tool_result' as const, tool_use_id: t.id, is_error: true, content: msg };
        }
      }),
    );
    messages.push({ role: 'user', content: results });
  }
  throw new AssistantUnavailable('too_many_steps');
}
