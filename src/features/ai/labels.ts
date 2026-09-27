// Module: features/ai/labels — EN/FA strings for the AI panel keys that are
// NEW in the React rewrite (loading states, download consent, tool-call
// activity, edit-mode labels). The ported global dictionaries
// (src/i18n/dictionaries.ts) are frozen for this feature (consume, never
// modify), so the panel resolves keys here first and falls through to the
// injected t() for every legacy key (aiSend, aiWorking, aiDownloadModel, …).
// If the lead later promotes these keys into the global dictionaries, the
// fallback order keeps both sources in agreement (they must stay byte-equal).

import type { Lang } from '../../i18n';

/** Feature-local label table, keyed like the global dictionaries. */
export const aiLabels: Record<Lang, Record<string, string>> = {
  en: {
    // First-send loading feedback (never silence while the model warms up)
    aiStartingModel: 'Starting the on-device model…',
    aiConnectingOpenai: 'Connecting to the OpenAI-compatible service…',
    aiConnectingAnthropic: 'Connecting to the Anthropic-compatible service…',
    // One-time ~4 GB download consent (AlertDialog on send; never auto-download)
    aiConsentTitle: 'Download the on-device AI model?',
    aiConsentBody:
      'The on-device model requires a one-time download of about 4 GB and then runs entirely in your browser — this app makes no network calls. Download it now?',
    aiDownloadAction: 'Download',
    aiNotNow: 'Not now',
    // Visible tool-call activity inside an assistant message
    aiToolActivity: 'Agent activity',
    aiToolRunning: 'Running…',
    aiToolOk: 'OK',
    aiToolRefused: 'Refused',
    // Edit-mode labels (agent edit_document calls)
    aiInsert: 'Insert at cursor',
    aiReplaceSelection: 'Replace selection',
    aiAppend: 'Append',
    aiReplaceDocument: 'Replace document',
  },
  fa: {
    aiStartingModel: 'در حال راه‌اندازی مدل روی دستگاه…',
    aiConnectingOpenai: 'در حال اتصال به سرویس سازگار با OpenAI…',
    aiConnectingAnthropic: 'در حال اتصال به سرویس سازگار با Anthropic…',
    aiConsentTitle: 'بارگیری مدل هوش مصنوعی روی دستگاه؟',
    aiConsentBody:
      'این قابلیت به بارگیری یک‌بارهٔ حدود ۴ گیگابایتی مدل نیاز دارد و سپس کاملاً روی دستگاه شما اجرا می‌شود — این برنامه هیچ درخواست شبکه‌ای نمی‌فرستد. اکنون بارگیری شود؟',
    aiDownloadAction: 'بارگیری',
    aiNotNow: 'فعلاً نه',
    aiToolActivity: 'فعالیت دستیار',
    aiToolRunning: 'در حال اجرا…',
    aiToolOk: 'انجام شد',
    aiToolRefused: 'رد شد',
    aiInsert: 'درج در نشانگر',
    aiReplaceSelection: 'جایگزینی انتخاب',
    aiAppend: 'افزودن در پایان',
    aiReplaceDocument: 'جایگزینی کل سند',
  },
};

/**
 * Builds the panel's translator: feature-local keys first (new keys), then the
 * injected app translator (all legacy keys), then the key itself (same chain
 * as the app's t()).
 */
export function makeAiT(lang: Lang, t: (key: string) => string): (key: string) => string {
  return (key: string) => aiLabels[lang][key] || t(key);
}
