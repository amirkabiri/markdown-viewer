// Module: ai — assistant panel + agent loop. Owner of the provider selector,
// provider settings UI (localStorage `mv:ai`), the builtin availability state
// machine, panel UI, and request routing. The active provider is either the
// on-device Prompt API ('builtin') or a user configured OpenAI-/Anthropic-
// compatible HTTP service. Chat runs through the tool-protocol agent loop
// (ai/agent.ts): the model reads/edits the document by emitting ```qalam tool
// calls, which the loop executes against a ToolExecutor. The `directEdit`
// toggle is the agent's WRITE permission — ON: edit_document applies edits
// (confirm for replace-document) via ai/edits.ts; OFF: writes are refused and
// the agent includes suggested text in its reply instead. Selection-aware
// sends pin edit_document's replace-selection to the selection captured at
// send time. Assistant bubbles are the audit trail (text only — the old
// per-message edit/copy footer buttons are gone; the agent IS the apply path).
//
// Provider matrix (which backend serves which action):
//   chat send   builtin → Prompt API promptStreaming (prompt() fallback)
//               openai/anthropic → provider SSE stream
//               …all through the provider-agnostic agent loop (no native
//               function calling — builtin Gemini Nano has none)
//   summarize   builtin → native Summarizer, else Prompt API via provider
//               external → provider stream (summarize prompt)
//   rewrite     builtin → native Rewriter (origin trial, best effort), else
//               Prompt API via provider; external → provider stream
//   translate   builtin → native Translator (fa pairs unavailable by design)
//               external → provider stream (translate prompt)
//
// Frozen public contract: `initAi` and `normalizeStreamChunk` are exported
// unchanged so the `./ai` import path keeps working.

import { state, editor, toast } from '../state.js';
import { t, registerI18n } from '../i18n.js';
import { loadSettings, saveSettings, normalizeSettings, isExternalReady } from './settings.js';
import { BuiltinProvider, BUILTIN_SYSTEM_PROMPT } from './providers/builtin.js';
import { createOpenAIProvider } from './providers/openai.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createAgent, agentSystemPrompt, type AgentTool, type ToolExecutor } from './agent.js';
import { applyEdit, buildSelectionMessages } from './edits.js';
import type { ChatMessage, ChatProvider, ProviderId, ProviderSettings } from './types.js';

/* ---------------- public streaming helper (frozen export) ---------------- */

export { normalizeStreamChunk } from './chunk.js';

/* ---------------- i18n ---------------- */

registerI18n({
  aiButton: { en: 'AI assistant', fa: 'دستیار هوشمند' },
  aiTitle: { en: 'AI assistant', fa: 'دستیار هوشمند' },
  aiClose: { en: 'Close', fa: 'بستن' },
  aiSend: { en: 'Send', fa: 'ارسال' },
  aiInputPlaceholder: {
    en: 'Ask the assistant to write, improve, or draw (mermaid)…',
    fa: 'از دستیار بخواهید بنویسد، بهبود دهد یا نمودار (mermaid) بکشد…',
  },
  aiDownloadModel: { en: 'Download AI model (~4 GB)', fa: 'بارگیری مدل هوش مصنوعی (~۴ گیگابایت)' },
  aiDownloadProgress: { en: 'Downloading model…', fa: 'در حال بارگیری مدل…' },
  aiUnavailableExplainer: {
    en: 'On-device AI is unavailable in this browser. It ships in desktop Chromium browsers (Chrome, Edge) on HTTPS after a one-time ~4 GB model download — check chrome://components for "Optimization Guide On Device Model", or enable chrome://flags/#optimization-guide-on-device-model (older builds: #prompt-api-for-gemini-nano). This app makes no network calls; the model runs entirely in your browser.',
    fa: 'هوش مصنوعی روی دستگاه در این مرورگر در دسترس نیست. این قابلیت در مرورگرهای Chromium دسکتاپ (کروم، اج) روی HTTPS و پس از بارگیری یک‌بارهٔ مدل ~۴ گیگابایتی ارائه می‌شود — بخش «Optimization Guide On Device Model» را در chrome://components بررسی کنید یا chrome://flags/#optimization-guide-on-device-model (نسخه‌های قدیمی‌تر: #prompt-api-for-gemini-nano) را فعال کنید. این برنامه هیچ درخواست شبکه‌ای نمی‌فرستد؛ مدل کاملاً داخل مرورگر شما اجرا می‌شود.',
  },
  aiChecking: { en: 'Checking AI availability…', fa: 'بررسی دسترسی هوش مصنوعی…' },
  aiWorking: { en: 'Working…', fa: 'در حال پردازش…' },
  // Provider settings (new keys — no collisions with the keys above)
  aiSettings: { en: 'AI service', fa: 'سرویس هوش مصنوعی' },
  aiProvider: { en: 'Provider', fa: 'سرویس‌دهنده' },
  aiProviderBuiltin: { en: 'Built-in (on-device)', fa: 'داخلی (روی دستگاه)' },
  aiProviderOpenai: { en: 'OpenAI-compatible', fa: 'سازگار با OpenAI' },
  aiProviderAnthropic: { en: 'Anthropic-compatible', fa: 'سازگار با Anthropic' },
  aiSettingsBaseUrl: { en: 'Base URL', fa: 'نشانی پایه' },
  aiSettingsApiKey: { en: 'API token', fa: 'توکن API' },
  aiSettingsModel: { en: 'Model', fa: 'مدل' },
  aiSave: { en: 'Save', fa: 'ذخیره' },
  aiSaved: { en: 'AI settings saved', fa: 'تنظیمات هوش مصنوعی ذخیره شد' },
  aiReady: { en: 'Ready — external AI service configured.', fa: 'آماده — سرویس هوش مصنوعی بیرونی پیکربندی شد.' },
  aiSettingsIncomplete: {
    en: 'Enter the base URL and model to enable this provider (token optional).',
    fa: 'برای فعال‌سازی این سرویس‌دهنده، نشانی پایه و مدل را وارد کنید (توکن اختیاری است).',
  },
  // Direct editing = the agent's write permission (new keys — no collisions)
  aiDirectEdit: { en: 'Direct editing', fa: 'ویرایش مستقیم' },
  aiDirectEditHint: {
    en: 'Let the assistant edit the document directly (off = suggestions in chat only)',
    fa: 'به دستیار اجازهٔ ویرایش مستقیم سند را بده (خاموش = پیشنهاد فقط در گفتگو)',
  },
  // Tool progress notes (agent loop)
  aiToolRead: { en: 'Reading document…', fa: 'در حال خواندن سند…' },
  aiToolEdit: { en: 'Editing document…', fa: 'در حال ویرایش سند…' },
  aiSelectionChip: { en: 'Editing selection', fa: 'ویرایش انتخاب' },
});

/* ---------------- constants ---------------- */
/* (none — the prompt soft cap lives in ai/edits.ts clipContext and
   ai/agent.ts MAX_TOOL_RESULT_CHARS) */

/* ---------------- module state ---------------- */

let inited = false;
let aiBtn: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let messagesEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let sendBtn: HTMLButtonElement | null = null;

// Settings section (draft fields; applied on Save)
let settingsToggle: HTMLButtonElement | null = null;
let providerSelect: HTMLSelectElement | null = null;
let urlInput: HTMLInputElement | null = null;
let keyInput: HTMLInputElement | null = null;
let modelInput: HTMLInputElement | null = null;
let settingsBody: HTMLElement | null = null;
const extFieldEls: HTMLElement[] = [];

// Direct editing (= the agent's write permission): settings-section checkbox
// + compact header mirror (same state), and the selection chip above the
// composer.
let directEditCb: HTMLInputElement | null = null;
let directEditMirror: HTMLInputElement | null = null;
let selectionChip: HTMLElement | null = null;

type Availability = 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable';

// Builtin availability state machine: 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable'
let avail: Availability = 'checking';
let dlPercent = -1; // last downloadprogress value in %, -1 = indeterminate
let busy = false;   // a request/stream is in flight

const builtinProvider = new BuiltinProvider(); // owns the LanguageModel session
let settings: ProviderSettings = loadSettings(); // active settings (Save applies drafts)
let lastProvider: ChatProvider | null = null; // last provider used — destroyed on pagehide

/* ---------------- tiny DOM helper (createElement + textContent only) ---------------- */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------------- styles (injected once, all classes ai-*) ---------------- */

const AI_CSS = `
.ai-panel{position:fixed;inset-inline-end:0;top:var(--header-h);bottom:0;width:min(380px,92vw);display:flex;flex-direction:column;background:var(--bg-elev);border-inline-start:1px solid var(--border);box-shadow:var(--shadow);z-index:55}
.ai-head{display:flex;align-items:center;gap:8px;height:var(--pane-head-h);padding-inline:12px;flex-shrink:0;border-bottom:1px solid var(--border)}
.ai-title{flex:1;margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.ai-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--text-muted);font-family:inherit;font-size:18px;line-height:1;cursor:pointer}
.ai-close:hover{background:var(--bg-subtle);color:var(--text)}
.ai-status{flex-shrink:0;padding:10px 12px;border-bottom:1px solid var(--border);font-size:12.5px;line-height:1.8;color:var(--text-muted)}
.ai-status-note{margin:0 0 8px}
.ai-status-note:last-child{margin-bottom:0}
.ai-status-ok{color:var(--ok)}
.ai-bar{height:4px;border-radius:2px;background:var(--bg-subtle);overflow:hidden;margin-top:8px}
.ai-bar-fill{height:100%;width:0;background:var(--accent);transition:width .2s}
.ai-bar-fill.ai-bar-indet{width:40%;animation:ai-slide 1.2s ease-in-out infinite alternate}
@keyframes ai-slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
.ai-download{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%;height:34px;margin-top:2px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}
.ai-status-note + .ai-download{margin-top:8px}
.ai-download:hover{filter:brightness(1.08)}
.ai-settings{flex-shrink:0}
.ai-settings-toggle{display:flex;align-items:center;gap:7px;width:100%;height:30px;padding-inline:12px;border:0;background:transparent;color:var(--text-muted);font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;text-align:start}
.ai-settings-toggle:hover{background:var(--bg-subtle);color:var(--text)}
.ai-caret{display:inline-block;transition:transform .15s}
.ai-settings-toggle[aria-expanded="true"] .ai-caret{transform:rotate(90deg)}
.ai-settings-body{display:flex;flex-direction:column;gap:9px;padding:10px 12px;border-top:1px solid var(--border)}
.ai-field{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--text-muted)}
.ai-select,.ai-text{height:30px;padding:0 8px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font-family:inherit;font-size:12.5px}
.ai-select:focus,.ai-text:focus{border-color:var(--accent);outline:none}
.ai-save{align-self:flex-start;display:inline-flex;align-items:center;height:28px;padding-inline:12px;border:1px solid var(--border);border-radius:7px;background:var(--bg-elev);color:var(--text);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer}
.ai-save:hover{background:var(--bg-subtle)}
.ai-direct{display:inline-flex;align-items:center;flex-shrink:0;cursor:pointer;color:var(--text-muted)}
.ai-direct:hover{color:var(--text)}
.ai-direct input,.ai-check input{width:14px;height:14px;margin:0;accent-color:var(--accent);cursor:pointer}
.ai-check{flex-direction:row;align-items:center;gap:8px;cursor:pointer;color:var(--text)}
.ai-check:hover{color:var(--text)}
.ai-selchip{display:flex;align-items:center;gap:6px;margin:0 12px 8px;padding:5px 10px;border:1px dashed var(--border);border-radius:8px;background:var(--bg-subtle);color:var(--text-muted);font-size:11.5px;font-weight:600;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ai-selchip[hidden]{display:none}
.ai-messages{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:12px;background:var(--bg)}
.ai-msg{max-width:100%}
.ai-msg-user{align-self:flex-end;max-width:85%;padding:8px 11px;border-radius:var(--radius);border-end-end-radius:3px;background:var(--accent);color:#fff;font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}
.ai-msg-assistant{align-self:stretch;padding:9px 11px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elev)}
.ai-msg-text{font-family:var(--mono);font-size:12.5px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text)}
.ai-msg-text:empty{display:none}
.ai-tool-note{margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--text-muted)}
.ai-tool-note[hidden]{display:none}
.ai-composer{display:flex;gap:6px;align-items:flex-end;padding:0 12px 12px;flex-shrink:0}
.ai-input{flex:1;min-height:36px;max-height:130px;resize:none;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elev);color:var(--text);font-family:var(--sans);font-size:13px;line-height:1.6}
.ai-input:focus{border-color:var(--accent);outline:none}
.ai-input:disabled{opacity:.55}
.ai-send{display:inline-flex;align-items:center;justify-content:center;height:36px;padding-inline:14px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.ai-send:hover{filter:brightness(1.08)}
.ai-send:disabled{opacity:.5;cursor:default;filter:none}
`;

function injectStyles(): void {
  if (document.getElementById('ai-styles')) return;
  const style = el('style');
  style.id = 'ai-styles';
  style.textContent = AI_CSS;
  document.head.appendChild(style);
}

/* ---------------- status machine ----------------
   builtin   → the LanguageModel availability states (checking/available/
               downloadable/downloading/unavailable), exactly as before.
   external  → 'ready' once baseUrl + model are set (token optional); while
               incomplete, the status area explains what is missing. */

function isReady(): boolean {
  if (settings.provider === 'builtin') return avail === 'available';
  return isExternalReady(settings);
}

function setAvail(next: Availability): void {
  avail = next;
  if (next === 'unavailable') builtinProvider.destroy();
  renderStatus();
}

async function refreshAvailability(): Promise<void> {
  setAvail('checking');
  setAvail(await builtinProvider.availability());
}

function syncControls(): void {
  const ready = isReady();
  inputEl!.disabled = !ready;
  sendBtn!.disabled = !ready || busy;
}

function setBusy(next: boolean): void {
  busy = next;
  syncControls();
}

/** Re-renders the status area from the current machine state (i18n-safe). */
function renderStatus(): void {
  if (!statusEl) return;

  if (settings.provider !== 'builtin') {
    statusEl.textContent = '';
    const ready = isExternalReady(settings);
    statusEl.hidden = false;
    statusEl.appendChild(el('p',
      ready ? 'ai-status-note ai-status-ok' : 'ai-status-note',
      ready ? t('aiReady') : t('aiSettingsIncomplete')));
    syncControls();
    return;
  }

  statusEl.textContent = '';
  statusEl.hidden = avail === 'available';

  if (avail === 'checking') {
    statusEl.appendChild(el('p', 'ai-status-note', t('aiChecking')));
  } else if (avail === 'unavailable') {
    statusEl.appendChild(el('p', 'ai-status-note', t('aiUnavailableExplainer')));
  } else if (avail === 'downloadable') {
    const dl = el('button', 'ai-download', t('aiDownloadModel'));
    dl.type = 'button';
    dl.addEventListener('click', startDownload);
    statusEl.appendChild(dl);
  } else if (avail === 'downloading') {
    statusEl.appendChild(el('p', 'ai-status-note',
      dlPercent >= 0 ? `${t('aiDownloadProgress')} ${dlPercent}%` : t('aiDownloadProgress')));
    const bar = el('div', 'ai-bar');
    const fill = el('div', 'ai-bar-fill');
    if (dlPercent >= 0) fill.style.width = dlPercent + '%';
    else fill.classList.add('ai-bar-indet');
    bar.appendChild(fill);
    statusEl.appendChild(bar);
  }
  syncControls();
}

/**
 * Download-model button click = the user activation that LanguageModel.create()
 * needs when a download starts. Progress is wired through the create() monitor.
 */
async function startDownload(): Promise<void> {
  dlPercent = -1;
  setAvail('downloading');
  const ok = await builtinProvider.startDownload((pct) => {
    dlPercent = pct;
    renderStatus();
  });
  if (ok) {
    setAvail('available');
    inputEl!.focus();
  } else {
    refreshAvailability();
  }
}

/* ---------------- provider gating + routing ---------------- */

/** Ensure a provider is ready; guides the user to settings/download otherwise. */
async function ensureBuiltin(): Promise<BuiltinProvider | null> {
  if (!builtinProvider.supported) { toast(t('aiUnavailableExplainer'), 'error'); return null; }
  if (avail === 'checking') await refreshAvailability();
  if (avail === 'available') {
    const ses = await builtinProvider.ensureSession();
    if (ses) return builtinProvider;
    toast(t('aiUnavailableExplainer'), 'error');
    return null;
  }
  if (avail === 'downloadable') toast(t('aiDownloadModel'));
  else if (avail === 'downloading') toast(t('aiDownloadProgress'));
  else toast(t('aiUnavailableExplainer'), 'error');
  return null;
}

/** Gate + construct the ACTIVE provider; toasts why not when refused. */
async function ensureProvider(): Promise<ChatProvider | null> {
  if (settings.provider === 'builtin') return ensureBuiltin();
  if (!isExternalReady(settings)) {
    toast(t('aiSettingsIncomplete'), 'error');
    return null;
  }
  const provider = settings.provider === 'openai'
    ? createOpenAIProvider(settings)
    : createAnthropicProvider(settings);
  lastProvider = provider;
  return provider;
}

/**
 * Applies `text` to a PINNED editor range [a, b) — the agent's replace-
 * selection for a selection-aware send, targeted at the selection captured at
 * send time rather than the live one. Same mechanics as applyEdit
 * (execCommand insertText for the native undo stack, setRangeText fallback,
 * bubbling input event, no confirm needed — it can only rewrite the
 * selection the user explicitly targeted).
 */
function applyEditRange(a: number, b: number, text: string): boolean {
  const len = editor.value.length;
  const start = Math.max(0, Math.min(a, len));
  const end = Math.max(start, Math.min(b, len));
  editor.focus();
  let done = false;
  if (text !== '') {
    try {
      editor.setSelectionRange(start, end);
      done = document.execCommand('insertText', false, text);
    } catch { done = false; }
  }
  if (!done) editor.setRangeText(text, start, end, 'end');
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/**
 * The agent's hands. Read access is always granted (read_document returns the
 * live document). Write access is the directEdit toggle: OFF → editDocument
 * refuses everything (the system prompt tells the agent to suggest text in
 * its reply instead); ON → edits route through applyEdit (undo-preserving,
 * confirm only for replace-document), with replace-selection pinned to the
 * range captured at send time for selection-aware sends.
 */
function makeExecutor(opts: { pinnedRange?: [number, number] | null }): ToolExecutor {
  return {
    readDocument: () => editor.value,
    editDocument: (mode, text) => {
      if (settings.directEdit !== true) return false;
      if (mode === 'replace-selection' && opts.pinnedRange) {
        return applyEditRange(opts.pinnedRange[0], opts.pinnedRange[1], text);
      }
      return applyEdit(mode, text);
    },
  };
}

/** Maps the agent's tool events onto i18n'd progress notes for the bubble. */
function toolNote(tool: AgentTool): string {
  return t(tool === 'read_document' ? 'aiToolRead' : 'aiToolEdit');
}

/* ---------------- messages area ---------------- */

function scrollMessages(): void { messagesEl!.scrollTop = messagesEl!.scrollHeight; }

function addUserMsg(text: string): void {
  messagesEl!.appendChild(el('div', 'ai-msg ai-msg-user', text));
  scrollMessages();
}

/**
 * Assistant message: plain text only (white-space: pre-wrap — no sanitization
 * needed, nothing is parsed as HTML here; text inserted into the editor flows
 * through the app's existing DOMPurify preview pipeline). There are no
 * per-message action buttons: edits go through the agent's edit_document tool
 * calls, so the bubble is the audit trail. A transient `.ai-tool-note` line
 * surfaces which tool the agent is executing.
 */
function addAssistantMsg() {
  const wrap = el('div', 'ai-msg ai-msg-assistant');
  const textEl = el('div', 'ai-msg-text');
  const noteEl = el('div', 'ai-tool-note');
  noteEl.hidden = true;
  wrap.append(textEl, noteEl);
  messagesEl!.appendChild(wrap);
  scrollMessages();

  let full = '';
  return {
    wrap,
    set(text: string) { full = text; textEl.textContent = text; scrollMessages(); },
    get text() { return full; },
    /** Shows (text) or clears (null) the tool-progress note. */
    note(text: string | null) {
      noteEl.hidden = text == null;
      noteEl.textContent = text ?? '';
      scrollMessages();
    },
  };
}

type AssistantMsg = ReturnType<typeof addAssistantMsg>;

/** Wraps a task with a "Working…" assistant bubble; removes the bubble when empty. */
async function withAssistantMessage(run: (msg: AssistantMsg) => Promise<unknown>): Promise<void> {
  const msg = addAssistantMsg();
  msg.set(t('aiWorking'));
  setBusy(true);
  let out = '';
  try {
    out = String(await run(msg) || '');
    msg.set(out);
  } catch (err) {
    console.error('[ai] request failed', err);
  } finally {
    msg.note(null);
    setBusy(false);
  }
  if (!out) msg.wrap.remove(); // remove the "Working…" bubble when the task produced nothing
}

/* ---------------- chat ---------------- */

async function send(): Promise<void> {
  const question = inputEl!.value.trim();
  if (!question || busy || !isReady()) return;
  // Pin the document/selection state before any await: it decides the prompt
  // (whole-document chat vs selection-aware chat) and the agent's pinned
  // replace-selection target.
  const a = editor.selectionStart;
  const b = editor.selectionEnd;
  const docText = editor.value;
  const selected = docText.slice(a, b);
  const hasSelection = selected.trim() !== '';
  refreshSelectionChip(); // chip reflects what this send targets
  const provider = await ensureProvider();
  if (!provider) return;
  inputEl!.value = '';
  addUserMsg(question);

  // The agent's system prompt: persona + tool protocol (+ read-only note when
  // directEdit is off — the executor refuses writes and the agent answers
  // with suggested text in the reply instead).
  const readOnly = settings.directEdit !== true;
  let agentPrompt = agentSystemPrompt({ readOnly });
  if (hasSelection && !readOnly) {
    agentPrompt += '\n\nApply the edited selection with edit_document in "replace-selection" mode.';
  }
  const messages: ChatMessage[] = hasSelection
    ? withAgentPrompt(buildSelectionMessages(question, selected, docText), agentPrompt)
    : [
        { role: 'system', content: `${BUILTIN_SYSTEM_PROMPT}\n\n${agentPrompt}` },
        { role: 'user', content: question },
      ];

  // Selection-aware sends pin edit_document's replace-selection to the range
  // captured above, even though the tool fires later (after reads/retries).
  const executor = makeExecutor({ pinnedRange: hasSelection ? [a, b] : null });
  const agent = createAgent({ provider, executor });

  await withAssistantMessage(async (msg) => {
    let final = '';
    for await (const ev of agent.run(messages)) {
      if (ev.type === 'text') msg.set(ev.text);
      else if (ev.type === 'tool') msg.note(toolNote(ev.tool));
      else if (ev.type === 'tool-result') msg.note(null);
      else if (ev.type === 'done') final = ev.text;
    }
    return final;
  });
}

/** Appends the agent tool protocol to the system message of a prompt. */
function withAgentPrompt(messages: ChatMessage[], agentPrompt: string): ChatMessage[] {
  const [first, ...rest] = messages;
  if (first?.role !== 'system') return messages; // nothing to augment (defensive)
  return [{ role: 'system', content: `${first.content}\n\n${agentPrompt}` }, ...rest];
}

/* ---------------- provider settings section ---------------- */

function syncSettingsVisibility(): void {
  const external = providerSelect!.value !== 'builtin';
  for (const field of extFieldEls) field.hidden = !external;
}

function populateSettingsFields(): void {
  providerSelect!.value = settings.provider;
  urlInput!.value = settings.baseUrl;
  keyInput!.value = settings.apiKey;
  modelInput!.value = settings.model;
  syncDirectEditControls();
  syncSettingsVisibility();
}

/** Direct-edit state lives on the active settings; both checkboxes mirror it. */
function syncDirectEditControls(): void {
  const on = settings.directEdit === true;
  if (directEditCb) directEditCb.checked = on;
  if (directEditMirror) directEditMirror.checked = on;
}

function bindDirectEditToggle(input: HTMLInputElement): void {
  input.addEventListener('change', () => {
    settings.directEdit = input.checked;
    saveSettings(settings); // toggling saves immediately
    syncDirectEditControls();
  });
}

/** Save click: validate the draft, persist it, activate it, re-render status. */
function applySettingsDraft(): void {
  settings = normalizeSettings({
    provider: providerSelect!.value as ProviderId,
    baseUrl: urlInput!.value,
    apiKey: keyInput!.value,
    model: modelInput!.value,
    directEdit: settings.directEdit === true, // not a draft field — carry the live state across Save
  });
  saveSettings(settings);
  populateSettingsFields(); // reflect the normalized values back into the draft
  // Switching to builtin may need the first availability check of this session.
  if (settings.provider === 'builtin' && avail === 'checking') void refreshAvailability();
  renderStatus();
  toast(t('aiSaved'));
}

function buildSettingsSection(): HTMLElement {
  const section = el('div', 'ai-settings');

  settingsToggle = el('button', 'ai-settings-toggle');
  settingsToggle.type = 'button';
  settingsToggle.setAttribute('aria-expanded', 'false');
  settingsToggle.setAttribute('aria-controls', 'ai-settings-body');
  const caret = el('span', 'ai-caret', '▸');
  const label = el('span', undefined, t('aiSettings'));
  label.setAttribute('data-i18n', 'aiSettings');
  settingsToggle.append(caret, label);

  settingsBody = el('div', 'ai-settings-body');
  settingsBody.id = 'ai-settings-body';
  settingsBody.hidden = true;

  settingsToggle.addEventListener('click', () => {
    const open = settingsBody!.hidden;
    settingsBody!.hidden = !open;
    settingsToggle!.setAttribute('aria-expanded', String(open));
  });

  const providerField = el('label', 'ai-field');
  const providerLabel = el('span', undefined, t('aiProvider'));
  providerLabel.setAttribute('data-i18n', 'aiProvider');
  providerSelect = el('select', 'ai-select');
  ([
    ['builtin', 'aiProviderBuiltin'],
    ['openai', 'aiProviderOpenai'],
    ['anthropic', 'aiProviderAnthropic'],
  ] as const).forEach(([value, key]) => {
    const opt = el('option', undefined, t(key));
    opt.value = value;
    opt.setAttribute('data-i18n', key);
    providerSelect!.appendChild(opt);
  });
  providerSelect.addEventListener('change', syncSettingsVisibility);
  providerField.append(providerLabel, providerSelect);
  settingsBody.appendChild(providerField);

  // Direct editing — labeled checkbox; persists immediately on toggle.
  const directField = el('label', 'ai-field ai-check');
  directEditCb = el('input');
  directEditCb.type = 'checkbox';
  directEditCb.checked = settings.directEdit === true;
  directEditCb.setAttribute('data-i18n-title', 'aiDirectEditHint');
  directEditCb.setAttribute('data-i18n-aria', 'aiDirectEdit');
  bindDirectEditToggle(directEditCb);
  const directLabel = el('span', undefined, t('aiDirectEdit'));
  directLabel.setAttribute('data-i18n', 'aiDirectEdit');
  directField.append(directEditCb, directLabel);
  settingsBody.appendChild(directField);

  const makeExtField = (labelKey: string, inputType: string, placeholder: string): HTMLInputElement => {
    const field = el('label', 'ai-field ai-field-ext');
    const text = el('span', undefined, t(labelKey));
    text.setAttribute('data-i18n', labelKey);
    const input = el('input', 'ai-text');
    input.type = inputType;
    input.placeholder = placeholder;
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); applySettingsDraft(); }
    });
    field.append(text, input);
    extFieldEls.push(field);
    settingsBody!.appendChild(field);
    return input;
  };

  urlInput = makeExtField('aiSettingsBaseUrl', 'url', 'https://api.example.com/v1');
  keyInput = makeExtField('aiSettingsApiKey', 'password', 'sk-… (optional)');
  modelInput = makeExtField('aiSettingsModel', 'text', 'gpt-4o-mini / claude-sonnet-4-5');

  const saveBtn = el('button', 'ai-save', t('aiSave'));
  saveBtn.type = 'button';
  saveBtn.setAttribute('data-i18n', 'aiSave');
  saveBtn.addEventListener('click', applySettingsDraft);
  settingsBody.appendChild(saveBtn);

  section.append(settingsToggle, settingsBody);
  populateSettingsFields();
  return section;
}

/* ---------------- panel ---------------- */

function isOpen(): boolean { return !!panel && !panel.hidden; }

/** Selection chip above the composer: shown while a non-empty selection is
 *  the chat target. Digits follow the UI locale (same pattern as the counts). */
function refreshSelectionChip(): void {
  if (!selectionChip) return;
  const a = editor.selectionStart;
  const b = editor.selectionEnd;
  const active = editor.value.slice(a, b).trim() !== '';
  selectionChip.hidden = !active;
  if (active) {
    const len = Math.max(0, b - a).toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
    selectionChip.textContent = `${t('aiSelectionChip')} · ${len}`;
  }
}

function openAi(): void {
  panel!.hidden = false;
  aiBtn!.setAttribute('aria-expanded', 'true');
  syncDirectEditControls();
  refreshSelectionChip();
  if (settings.provider === 'builtin') {
    if (avail === 'checking') refreshAvailability();
    else renderStatus(); // re-render in case the UI language changed while closed
  } else {
    renderStatus();
  }
  if (isReady()) inputEl!.focus();
}

function closeAi(): void {
  panel!.hidden = true;
  aiBtn!.setAttribute('aria-expanded', 'false');
}

function toggleAi(): void { if (isOpen()) closeAi(); else openAi(); }

function buildPanel(): void {
  panel = el('aside', 'ai-panel');
  panel.id = 'ai-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', t('aiTitle'));
  panel.setAttribute('data-i18n-aria', 'aiTitle');

  const head = el('header', 'ai-head');
  const title = el('h2', 'ai-title', t('aiTitle'));
  title.setAttribute('data-i18n', 'aiTitle');
  // Compact direct-edit mirror: a bare checkbox whose title explains it; kept
  // in sync with the settings-section checkbox (both persist immediately).
  const directWrap = el('label', 'ai-direct');
  directEditMirror = el('input');
  directEditMirror.type = 'checkbox';
  directEditMirror.checked = settings.directEdit === true;
  directEditMirror.setAttribute('data-i18n-title', 'aiDirectEditHint');
  directEditMirror.setAttribute('data-i18n-aria', 'aiDirectEdit');
  bindDirectEditToggle(directEditMirror);
  directWrap.appendChild(directEditMirror);
  const closeBtn = el('button', 'ai-close', '×');
  closeBtn.type = 'button';
  closeBtn.title = t('aiClose');
  closeBtn.setAttribute('aria-label', t('aiClose'));
  closeBtn.setAttribute('data-i18n-title', 'aiClose');
  closeBtn.addEventListener('click', closeAi);
  head.append(title, directWrap, closeBtn);

  statusEl = el('div', 'ai-status');
  statusEl.setAttribute('role', 'status');

  const settingsSection = buildSettingsSection();

  messagesEl = el('div', 'ai-messages');


  const composer = el('div', 'ai-composer');
  inputEl = el('textarea', 'ai-input');
  inputEl.rows = 1;
  inputEl.placeholder = t('aiInputPlaceholder');
  inputEl.setAttribute('data-i18n-ph', 'aiInputPlaceholder');
  inputEl.setAttribute('aria-label', t('aiInputPlaceholder'));
  inputEl.setAttribute('data-i18n-aria', 'aiInputPlaceholder');
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn = el('button', 'ai-send', t('aiSend'));
  sendBtn.type = 'button';
  sendBtn.setAttribute('data-i18n', 'aiSend');
  sendBtn.addEventListener('click', send);
  composer.append(inputEl, sendBtn);

  // Selection chip: sits above the composer, refreshed on open and per send.
  selectionChip = el('div', 'ai-selchip');
  selectionChip.hidden = true;

  panel.append(head, statusEl, settingsSection, messagesEl, selectionChip, composer);
  document.body.appendChild(panel);
  renderStatus();
}

/* ---------------- init ---------------- */

/**
 * Idempotent. Builds the panel DOM, injects styles, binds #ai-btn.
 * No-ops with a console.warn when #ai-btn is absent (wiring is added elsewhere).
 */
export function initAi(): void {
  if (inited) return;
  const btn = document.getElementById('ai-btn');
  if (!btn) {
    console.warn('[ai] #ai-btn not found — AI assistant panel not initialized');
    return;
  }
  inited = true;
  aiBtn = btn;
  injectStyles();
  buildPanel();

  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', toggleAi);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeAi();
  });

  // Re-check builtin availability when the tab becomes visible again (the model
  // may have finished downloading elsewhere or been removed by policy).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && settings.provider === 'builtin') refreshAvailability();
  });

  // Free provider resources when the tab goes away: the on-device session and,
  // if one is in flight, the active external provider.
  window.addEventListener('pagehide', () => {
    if (lastProvider) {
      void lastProvider.destroy?.();
      lastProvider = null;
    }
    builtinProvider.destroy();
  });

  // Static labels carry data-i18n attributes (updated by applyLang()); the
  // dynamic status area re-renders when the document language/direction flips
  // (and the selection chip follows the locale's digits).
  new MutationObserver(() => { renderStatus(); refreshSelectionChip(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
}
