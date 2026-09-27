// Module: ai/providers/http — safe HTTP error reporting shared by the
// fetch-based providers. Response bodies may echo secrets (e.g. an invalid
// API key) — everything surfaced in an Error message is redacted and truncated.

const TOKEN_RE = /sk-[A-Za-z0-9][A-Za-z0-9_-]{2,}/g; // sk-…-style API tokens

/** Replaces `sk-…`-like token substrings with `[redacted]`. Pure. */
export function redactTokens(text: string): string {
  return text.replace(TOKEN_RE, '[redacted]');
}

const MAX_SNIPPET = 200;

/**
 * Builds the Error thrown for a non-OK provider response: HTTP status plus a
 * redacted, ~200-char body snippet. Redaction runs before truncation so a
 * token cannot be cut in half back into view.
 */
export async function responseError(res: Response): Promise<Error> {
  let body = '';
  try {
    body = await res.text();
  } catch { /* unreadable body — status alone is still reported */ }
  const snippet = redactTokens(body).slice(0, MAX_SNIPPET);
  return new Error(`AI request failed with HTTP status ${res.status}: ${snippet}`);
}
