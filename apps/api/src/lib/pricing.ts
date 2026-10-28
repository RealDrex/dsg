/**
 * List prices used to estimate what each web search costs (USD per million
 * tokens; web search per search). Estimates only — the real bill is in the
 * Anthropic console — but close enough to enforce a daily budget.
 */
const PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Estimated cost of one response, in millionths of a dollar. Unknown models are priced like the most expensive one listed. */
export function costMicros(model: string, u: UsageLike | null | undefined): number {
  if (!u) return 0;
  const p = PER_MTOK[model] ?? PER_MTOK['claude-fable-5-1']!;
  const usd = ((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25) * p.input / 1e6
    + (u.cache_read_input_tokens ?? 0) * p.cacheRead / 1e6
    + (u.output_tokens ?? 0) * p.output / 1e6
    + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
  return Math.round(usd * 1e6);
}
