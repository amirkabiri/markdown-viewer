// Module: features/ai/toast-queue — the AI panel's toast queue. One shared
// ToastQueue instance (react-stately) fed imperatively from anywhere in the
// feature and rendered by the panel's ToastRegion (React Aria Components) —
// the pattern recommended in docs/uikit-research.md, self-contained until the
// app-root toast plumbing lands. Content is a plain (already translated)
// string, matching the vanilla toast's text-only feedback.

import { ToastQueue } from 'react-stately';

/** Queue of plain-text AI panel notifications, rendered inside <AiPanel>. */
export const aiToastQueue = new ToastQueue<string>();

/** Shows a short, auto-dismissing feedback toast (errors use a longer read). */
export function aiToast(message: string, kind: 'info' | 'error' = 'info'): void {
  aiToastQueue.add(message, { timeout: kind === 'error' ? 8000 : 4000 });
}
