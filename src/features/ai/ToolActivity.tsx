// Module: features/ai/ToolActivity — the visible agent activity inside an
// assistant message: one compact muted entry per tool call (tool name, the
// edit mode when present, status running → OK / refused). The chat is the
// audit trail — the list STAYS in the message (unlike legacy's transient
// per-bubble progress note). Semantic <ul> + aria-live="polite" per the UI-kit
// research recommendation (docs/uikit-research.md, tool-call activity row).

import type { AgentTool } from '../../lib/ai/agent';
import type { EditMode } from '../../lib/ai/edits';
import styles from './AiPanel.module.css';

/** View model of one agent tool call, built from the agent's tool events. */
export interface ToolCallView {
  id: number;
  tool: AgentTool;
  /** Present on edit_document calls — the mode is shown as a label. */
  mode?: EditMode;
  status: 'running' | 'ok' | 'refused';
}

interface ToolActivityProps {
  steps: ToolCallView[];
  tt: (key: string) => string;
}

const MODE_LABEL_KEYS: Record<EditMode, string> = {
  cursor: 'aiInsert',
  'replace-selection': 'aiReplaceSelection',
  append: 'aiAppend',
  'replace-document': 'aiReplaceDocument',
};

/** Compact muted list of the agent's tool calls for one assistant message. */
export default function ToolActivity({ steps, tt }: ToolActivityProps) {
  if (steps.length === 0) return null;
  return (
    <ul className={styles.toolList} aria-label={tt('aiToolActivity')} aria-live="polite">
      {steps.map((step) => (
        <li key={step.id} className={styles.toolItem} data-status={step.status}>
          <code className={styles.toolName}>{step.tool}</code>
          <span className={styles.toolDesc}>
            {step.tool === 'read_document' ? tt('aiToolRead') : tt('aiToolEdit')}
            {step.mode ? ` · ${tt(MODE_LABEL_KEYS[step.mode])}` : ''}
          </span>
          {step.status === 'running' ? (
            <span className={styles.toolStatus}>
              <span className={styles.spinner} aria-hidden="true" />
              {tt('aiToolRunning')}
            </span>
          ) : (
            <span className={styles.toolStatus} data-ok={step.status === 'ok'}>
              {step.status === 'ok' ? tt('aiToolOk') : tt('aiToolRefused')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
