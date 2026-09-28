// Module: features/ai/AiPanel — the AI co-author panel (React port of
// legacy/src/ai/index.ts, on React Aria Components + the ported src/lib/ai
// modules). Self-contained: props are exactly { editor, t, lang } (the frozen
// wave-2 contract) — no app-context dependencies. Behavior parity with legacy:
//
//   provider settings (disclosure: provider select, base URL, token, model,
//     Save → persistence + validation + status line + toast feedback)
//   builtin availability state machine (checking / unavailable / downloadable
//     / downloading / available) + honest no-network-calls explainer
//   direct-edit toggle = the agent's write permission (off → read-only prompt,
//     edits refused, agent suggests text in chat)
//   selection-aware chat (chip; selection + document pinned at send time;
//     replace-selection pinned to the captured range)
//   plain-text bubbles (textContent semantics, never dangerouslySetInnerHTML),
//     Esc closes, busy disables send, close destroys the builtin session
//
// One deliberate exception to "no app dependencies": the Esc topmost-layer
// rule imports the pure probe isForeignLayerOpen from app/shortcuts (no
// React, no context) so the panel never closes out from under a RAC layer.
//
// Plus the three stakeholder UX requirements:
//   1. first-send loading feedback — labeled spinner state from send until the
//      first streamed event ("Starting the on-device model…" for builtin
//      LanguageModel.create(), "Connecting to <provider>…" for external SSE);
//      input/send disabled while loading; the assistant bubble shows the
//      loading affordance; "Working…" afterwards, like legacy.
//   2. explicit ~4 GB download consent — a 'downloadable' availability NEVER
//      auto-downloads; trying to use the model opens the consent AlertDialog;
//      only the explicit Download press starts it (progress live), "Not now"
//      keeps the draft and shows the honest explainer.
//   3. visible tool calls — every agent tool event renders as a compact
//      muted entry in the message (tool, edit-mode label, running → OK /
//      refused) that STAYS in the chat audit trail.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Button,
  Dialog,
  Heading,
  I18nProvider,
  Modal,
  ModalOverlay,
  ProgressBar,
  TextArea,
} from 'react-aria-components';
import { createAgent } from '../../lib/ai/agent';
import type { ToolExecutor } from '../../lib/ai/agent';
import { isForeignLayerOpen } from '../../app/shortcuts';
import {
  isExternalReady,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../../lib/ai/settings';
import type { ChatProvider, ProviderSettings } from '../../lib/ai/types';
import type { EditorApi } from '../editor/api';
import type { Lang } from '../../i18n';
import { buildChatMessages } from './chat';
import createExternalProvider from './chat-provider';
import ConsentDialog from './ConsentDialog';
import AiSettingsForm from './AiSettingsForm';
import type { ProviderDraft } from './AiSettingsForm';
import ToolActivity from './ToolActivity';
import type { ToolCallView } from './ToolActivity';
import { aiToast } from './toast-queue';
import { useBuiltinAi } from './useBuiltinAi';
import type { BuiltinAi } from './useBuiltinAi';
import styles from './AiPanel.module.css';

export interface AiPanelProps {
  /** The frozen editor contract (read document/selection, apply edits). */
  editor: EditorApi;
  /** App translator (already bound to the active language). */
  t: (key: string) => string;
  /** Active UI language — drives the kit's RTL direction and local digits. */
  lang: Lang;
}

interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  tools: ToolCallView[];
  pending: boolean;
}

/** A send captured before any await (the prompt + pinned edit target). */
interface PendingSend {
  question: string;
  docText: string;
  pinnedRange: [number, number] | null;
}

interface SelectionChipState {
  active: boolean;
  length: number;
}

/** Status label shown until the first streamed event of a run. */
function loadingLabelFor(settings: ProviderSettings, tt: (key: string) => string): string {
  if (settings.provider === 'builtin') return tt('aiStartingModel');
  if (settings.provider === 'openai') return tt('aiConnectingOpenai');
  return tt('aiConnectingAnthropic');
}

/** The selection chip reflects what a send would target right now. */
function readChip(editor: EditorApi): SelectionChipState {
  const { start, end } = editor.getSelection();
  const length = Math.max(0, end - start);
  return { active: editor.getText().slice(start, end).trim() !== '', length };
}

/** Keeps a background promise from surfacing as an unhandled rejection. */
function trap(promise: Promise<unknown>): void {
  promise.catch((err) => console.error('[ai] background task failed', err));
}

/**
 * The status area above the messages: the external readiness line, or the
 * builtin availability machine (checking / unavailable / downloadable /
 * downloading / available).
 */
interface StatusAreaProps {
  settings: ProviderSettings;
  builtin: BuiltinAi;
  consentDeclined: boolean;
  tt: (key: string) => string;
  onDownload: () => void;
}

function StatusArea({
  settings,
  builtin,
  consentDeclined,
  tt,
  onDownload,
}: StatusAreaProps) {
  if (settings.provider !== 'builtin') {
    const ready = isExternalReady(settings);
    return (
      <p className={ready ? `${styles.statusNote} ${styles.statusOk}` : styles.statusNote}>
        {ready ? tt('aiReady') : tt('aiSettingsIncomplete')}
      </p>
    );
  }
  const percent = builtin.downloadPercent;
  if (builtin.availability === 'checking') {
    return <p className={styles.statusNote}>{tt('aiChecking')}</p>;
  }
  if (builtin.availability === 'unavailable') {
    return <p className={styles.statusNote}>{tt('aiUnavailableExplainer')}</p>;
  }
  if (builtin.availability === 'downloading') {
    return (
      <>
        <p className={styles.statusNote}>
          {tt('aiDownloadProgress')}
          {percent >= 0 ? ` ${percent}%` : ''}
        </p>
        <ProgressBar
          aria-label={tt('aiDownloadProgress')}
          minValue={0}
          maxValue={100}
          value={percent >= 0 ? percent : undefined}
          className={styles.progressBar}
        >
          <div className={styles.bar}>
            <div
              className={percent >= 0 ? styles.barFill : `${styles.barFill} ${styles.barIndet}`}
              style={percent >= 0 ? { width: `${percent}%` } : undefined}
            />
          </div>
        </ProgressBar>
      </>
    );
  }
  if (builtin.availability === 'downloadable') {
    return (
      <>
        {consentDeclined && <p className={styles.statusNote}>{tt('aiUnavailableExplainer')}</p>}
        <Button onPress={onDownload} className={styles.downloadButton}>
          {tt('aiDownloadModel')}
        </Button>
      </>
    );
  }
  return null; // 'available' — nothing to explain
}

/** The body of one chat bubble (user/assistant text or the pending affordance). */
interface MessageBodyProps {
  entry: ChatEntry;
  showLoading: boolean;
  loadingLabel: string | null;
  tt: (key: string) => string;
}

function MessageBody({
  entry,
  showLoading,
  loadingLabel,
  tt,
}: MessageBodyProps) {
  if (entry.role === 'assistant' && entry.pending && entry.text === '') {
    return (
      <div className={styles.pending}>
        <span className={styles.spinner} aria-hidden="true" />
        <span>{showLoading ? loadingLabel : tt('aiWorking')}</span>
      </div>
    );
  }
  if (entry.text !== '') {
    return <div className={styles.msgText}>{entry.text}</div>;
  }
  return null;
}

/**
 * The AI co-author panel: a sliding side sheet (inline-end, overlaying the
 * workspace) rendered through React Aria's modal primitives.
 */
export default function AiPanel({ editor, t, lang }: AiPanelProps) {
  // All labels now live in the global dictionaries (promoted from the former
  // feature-local labels.ts) — the injected translator covers every key.
  const tt = t;

  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState<ProviderSettings>(loadSettings);
  const settingsRef = useRef(settings);
  // The settings form's draft (lifted here so the form stays a controlled,
  // effect-free component); Save normalizes + persists + activates it.
  const [settingsDraft, setSettingsDraft] = useState<ProviderDraft>(() => {
    const initial = loadSettings();
    return {
      provider: initial.provider,
      baseUrl: initial.baseUrl,
      apiKey: initial.apiKey,
      model: initial.model,
    };
  });
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentDeclined, setConsentDeclined] = useState(false);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const lastExternalRef = useRef<ChatProvider | null>(null);
  const nextIdRef = useRef(1);
  const nextId = (): number => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  };

  const builtin = useBuiltinAi();

  // Own overlay element — the Escape handler measures foreign layers against
  // it (the panel's OWN dialog must not count as "a layer above me").
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const [chip, setChip] = useState<SelectionChipState>(() => readChip(editor));
  const refreshChip = useCallback(() => setChip(readChip(editor)), [editor]);

  // Esc closes the panel — a document-level CAPTURE listener, exactly like
  // legacy (bubble-phase events from inside the RAC portal are delegated at
  // React's root and never reach a document bubble listener; capture runs
  // first). Topmost-layer rule: while any React Aria layer OUTSIDE this
  // panel is open (the consent dialog, the Open dialog, menus…), THAT layer
  // owns the escape hatch — the panel never closes out from under it.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const overlay = overlayRef.current;
      if (overlay && isForeignLayerOpen(overlay)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Auto-scroll the message list to the newest content.
  const messagesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loadingLabel]);

  // Free the in-flight external provider when the panel goes away (legacy
  // pagehide); the builtin session is destroyed by useBuiltinAi's cleanup.
  useEffect(() => () => {
    const { current: last } = lastExternalRef;
    if (last?.destroy) trap(Promise.resolve(last.destroy()));
    lastExternalRef.current = null;
  }, []);

  const updateSettings = (next: ProviderSettings): void => {
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  };

  const applySettingsDraft = (): void => {
    // directEdit is not a draft field — carry the live state across Save.
    const next = normalizeSettings({
      ...settingsDraft,
      directEdit: settingsRef.current.directEdit === true,
    });
    updateSettings(next);
    setSettingsDraft({
      provider: next.provider,
      baseUrl: next.baseUrl,
      apiKey: next.apiKey,
      model: next.model,
    });
    aiToast(t('aiSaved'));
    // Switching to builtin may need this session's first availability check.
    if (next.provider === 'builtin' && builtin.availability === 'checking') {
      trap(builtin.refresh());
    }
  };

  // Toggling the write permission saves immediately (legacy parity).
  const handleDirectEditChange = (on: boolean): void => {
    updateSettings(normalizeSettings({ ...settingsRef.current, directEdit: on }));
  };

  /**
   * The agent's hands. Reads are always granted; writes are the direct-edit
   * permission, with replace-selection pinned to the range captured at send
   * time for selection-aware sends.
   */
  const makeExecutor = (
    pinnedRange: [number, number] | null,
    directEditOn: boolean,
  ): ToolExecutor => ({
    readDocument: () => editor.getText(),
    editDocument: (mode, text) => {
      if (!directEditOn) return false;
      if (mode === 'replace-selection' && pinnedRange) {
        return editor.applyEdit(mode, text, pinnedRange);
      }
      return editor.applyEdit(mode, text);
    },
  });

  /** Gate + construct the ACTIVE provider; explains why when refused. */
  const resolveProvider = async (
    currentSettings: ProviderSettings,
  ): Promise<ChatProvider | null> => {
    if (currentSettings.provider === 'builtin') {
      if (!builtin.provider.supported) {
        aiToast(tt('aiUnavailableExplainer'), 'error');
        return null;
      }
      // The possibly-long LanguageModel.create() runs under the loading label.
      const session = await builtin.provider.ensureSession();
      if (!session) {
        aiToast(tt('aiUnavailableExplainer'), 'error');
        trap(builtin.refresh());
        return null;
      }
      return builtin.provider;
    }
    if (!isExternalReady(currentSettings)) {
      aiToast(tt('aiSettingsIncomplete'), 'error');
      return null;
    }
    const provider = createExternalProvider(currentSettings);
    lastExternalRef.current = provider;
    return provider;
  };

  /** Runs one send end-to-end against the agent loop. */
  const performSend = async (req: PendingSend): Promise<void> => {
    const { current: currentSettings } = settingsRef;
    const readOnly = currentSettings.directEdit !== true;
    busyRef.current = true;
    setBusy(true);
    // Visible, labeled loading from NOW until the first streamed event.
    setLoadingLabel(loadingLabelFor(currentSettings, tt));
    try {
      const provider = await resolveProvider(currentSettings);
      if (!provider) return; // reason surfaced; the draft stays in the composer

      setDraft('');
      const hasSelection = req.pinnedRange !== null;
      const selected = hasSelection && req.pinnedRange
        ? req.docText.slice(req.pinnedRange[0], req.pinnedRange[1])
        : '';
      const prompt = buildChatMessages({
        question: req.question,
        hasSelection,
        selected,
        docText: req.docText,
        readOnly,
      });
      const userId = nextId();
      const assistantId = nextId();
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: 'user',
          text: req.question,
          tools: [],
          pending: false,
        },
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          tools: [],
          pending: true,
        },
      ]);

      const agent = createAgent({
        provider,
        executor: makeExecutor(req.pinnedRange, !readOnly),
      });

      let final = '';
      try {
        for await (const ev of agent.run(prompt)) {
          if (ev.type === 'text') {
            setLoadingLabel(null); // first event → loading phase over
            setMessages((prev) => prev.map((m) => {
              if (m.id !== assistantId) return m;
              return { ...m, text: ev.text };
            }));
          } else if (ev.type === 'tool') {
            setLoadingLabel(null);
            const step: ToolCallView = {
              id: nextId(),
              tool: ev.tool,
              mode: ev.args.mode,
              status: 'running',
            };
            setMessages((prev) => prev.map((m) => {
              if (m.id !== assistantId) return m;
              return { ...m, tools: [...m.tools, step] };
            }));
          } else if (ev.type === 'tool-result') {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== assistantId) return m;
              const tools = [...m.tools];
              for (let i = tools.length - 1; i >= 0; i -= 1) {
                const step = tools[i];
                if (step.status === 'running' && step.tool === ev.tool) {
                  tools[i] = { ...step, status: ev.ok ? 'ok' : 'refused' };
                  break;
                }
              }
              return { ...m, tools };
            }));
          } else {
            final = ev.text;
          }
        }
      } catch (err) {
        console.error('[ai] request failed', err);
      }

      // Finalize; drop an empty tool-free bubble (legacy "Working…" cleanup).
      setMessages((prev) => {
        const target = prev.find((m) => m.id === assistantId);
        const finished = prev.map((m) => {
          if (m.id !== assistantId) return m;
          return { ...m, text: final, pending: false };
        });
        const empty = final === '' && (target?.tools.length ?? 0) === 0;
        return empty ? finished.filter((m) => m.id !== assistantId) : finished;
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setLoadingLabel(null);
    }
  };

  /** The consent-gated download (explicit user activation ONLY). */
  const startDownloadFlow = async (): Promise<void> => {
    const ok = await builtin.startDownload();
    const req = pendingSendRef.current;
    if (ok) {
      setConsentDeclined(false);
      if (req) {
        pendingSendRef.current = null;
        await performSend(req); // proceed with the message the user sent
      }
    } else {
      trap(builtin.refresh()); // status area reflects reality
      if (req) {
        pendingSendRef.current = null;
        setDraft(req.question); // hand the draft back to the composer
      }
    }
  };

  const handleConsentAccept = (): void => {
    setConsentOpen(false);
    trap(startDownloadFlow());
  };

  const handleConsentDecline = (): void => {
    setConsentOpen(false);
    setConsentDeclined(true);
    pendingSendRef.current = null; // the draft never left the composer
  };

  const handleSend = async (): Promise<void> => {
    const question = draft.trim();
    if (!question || busyRef.current) return;
    // Resolve a 'checking' machine state first (its verdict decides consent).
    let { availability } = builtin;
    if (settingsRef.current.provider === 'builtin' && availability === 'checking') {
      availability = await builtin.refresh();
    }
    if (busyRef.current) return;

    // Pin the document/selection BEFORE any await: it decides the prompt
    // (whole-document vs selection-aware) and the pinned edit target.
    const docText = editor.getText();
    const { start, end } = editor.getSelection();
    const selected = docText.slice(start, end);
    const hasSelection = selected.trim() !== '';
    const pinnedRange: [number, number] | null = hasSelection ? [start, end] : null;
    refreshChip();

    // NEVER auto-download: a send while 'downloadable' opens the consent
    // dialog; the message is requeued and sent after an explicit Download.
    if (settingsRef.current.provider === 'builtin' && availability === 'downloadable') {
      pendingSendRef.current = { question, docText, pinnedRange };
      setConsentOpen(true);
      return;
    }

    await performSend({ question, docText, pinnedRange });
  };

  // Sync handlers for the RAC event props (promises must not leak as floats).
  const sendNow = (): void => {
    handleSend().catch((err) => console.error('[ai] request failed', err));
  };
  const downloadNow = (): void => {
    startDownloadFlow().catch((err) => console.error('[ai] request failed', err));
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendNow();
    }
  };

  const canAttempt = settings.provider === 'builtin'
    ? builtin.availability === 'available' || builtin.availability === 'downloadable'
    : isExternalReady(settings);
  const controlsDisabled = !canAttempt || busy;

  return (
    <I18nProvider locale={lang === 'fa' ? 'fa-IR' : 'en-US'}>
      <ModalOverlay ref={overlayRef} isOpen={open} isDismissable={false} className={styles.overlay}>
        <Modal className={styles.panel}>
          <Dialog aria-label={tt('aiTitle')} className={styles.inner}>
            <header className={styles.head}>
              <Heading slot="title" className={styles.title}>{tt('aiTitle')}</Heading>
              <Button
                onPress={() => setOpen(false)}
                aria-label={tt('aiClose')}
                className={styles.closeButton}
              >
                ×
              </Button>
            </header>

            <div className={styles.status} role="status">
              <StatusArea
                settings={settings}
                builtin={builtin}
                consentDeclined={consentDeclined}
                tt={tt}
                onDownload={downloadNow}
              />
            </div>

            <AiSettingsForm
              tt={tt}
              draft={settingsDraft}
              onDraftChange={setSettingsDraft}
              onApply={applySettingsDraft}
              directEdit={settings.directEdit === true}
              onDirectEditChange={handleDirectEditChange}
            />

            <div className={styles.messages} ref={messagesRef}>
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={message.role === 'user' ? styles.msgUser : styles.msgAssistant}
                >
                  {message.role === 'assistant' && <ToolActivity steps={message.tools} tt={tt} />}
                  <MessageBody
                    entry={message}
                    showLoading={loadingLabel !== null && index === messages.length - 1}
                    loadingLabel={loadingLabel}
                    tt={tt}
                  />
                </div>
              ))}
            </div>

            {chip.active && (
              <div className={styles.selChip}>
                {`${tt('aiSelectionChip')} · ${chip.length.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US')}`}
              </div>
            )}

            {loadingLabel !== null && (
              <div className={styles.loading} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                {loadingLabel}
              </div>
            )}

            <div className={styles.composer}>
              <TextArea
                aria-label={tt('aiInputPlaceholder')}
                placeholder={tt('aiInputPlaceholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={controlsDisabled}
                className={styles.input}
                onKeyDown={handleComposerKeyDown}
              />
              <Button
                onPress={sendNow}
                isDisabled={controlsDisabled || draft.trim() === ''}
                className={styles.sendButton}
              >
                {tt('aiSend')}
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>

      <ConsentDialog
        isOpen={consentOpen}
        tt={tt}
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
      />
    </I18nProvider>
  );
}
