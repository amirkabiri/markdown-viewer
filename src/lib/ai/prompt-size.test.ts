// Prompt-budget guard for the agent tool protocol (spec §5, doc
// docs/agent-framework-research.md §6.1 risk (b): "prompt growth raises
// per-send tokens — mitigate with compact tool docs (measure)".)
//
// Measurement convention: ~4 characters per token (the standard heuristic for
// English prose + code; good to ±20%, which is plenty for a +400 budget).
//
// Baseline (measured on the v1 two-tool protocol before this change, same
// estimator): 860 chars ≈ 215 tokens; 1037 chars ≈ 260 tokens with the
// read-only note. The v2 protocol must stay under baseline + 400 tokens.

import { describe, expect, it } from 'vitest';
import { agentSystemPrompt } from './agent';

const V1_PROTOCOL_TOKENS = 215;

/** ~4 chars/token heuristic (documented above). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('agent tool-protocol prompt budget', () => {
  it('stays within +400 tokens of the v1 baseline (logged for the report)', () => {
    const protocol = agentSystemPrompt();
    const tokens = estimateTokens(protocol);
    // Visible in test output — the number this task must report.
    console.info(`[prompt-size] v2 tool protocol ≈ ${tokens} tokens (${protocol.length} chars); v1 baseline ≈ ${V1_PROTOCOL_TOKENS}`);
    expect(tokens).toBeLessThan(V1_PROTOCOL_TOKENS + 400);
  });

  it('stays within +400 tokens including the read-only note', () => {
    const readOnly = agentSystemPrompt({ readOnly: true });
    expect(estimateTokens(readOnly)).toBeLessThan(260 + 400);
  });
});
