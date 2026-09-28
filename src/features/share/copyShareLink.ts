// Module: features/share/copyShareLink — the one-click share flow (legacy
// ui.ts copyShareLink): encode the document as a self-contained #d= link,
// copy it to the clipboard, and report via toasts — "copied" (ok, or error
// when the clipboard is blocked), the >30k warn variant, and refusal over
// 300k chars. Pure lib/share does the encoding; this is the wiring.
import { SHARE_MAX_CHARS, SHARE_WARN_CHARS, shareEncode } from '../../lib/share';

export interface ShareDeps {
  /** Translator (useT) for the user-visible strings. */
  t: (key: string) => string;
  /** Toast reporting. */
  toast: (message: string, kind?: 'info' | 'ok' | 'error') => void;
  /** Injectable clipboard — tests pass a fake; production uses navigator.clipboard. */
  clipboard?: { writeText(text: string): Promise<void> };
}

export async function copyShareLink(text: string, deps: ShareDeps): Promise<void> {
  const result = await shareEncode(text);
  if (!result.ok) {
    deps.toast(deps.t('linkTooLarge'), 'error');
    return;
  }
  const clipboard = deps.clipboard ?? navigator.clipboard;
  clipboard
    .writeText(result.url)
    .then(() => deps.toast(deps.t('copied'), 'ok'))
    .catch(() => deps.toast(deps.t('copied'), 'error'));
  if (result.warn) deps.toast(deps.t('linkWarn'));
}

export { SHARE_MAX_CHARS, SHARE_WARN_CHARS };
