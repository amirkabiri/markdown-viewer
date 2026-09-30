// Module: features/ai/ToolActivity — the visible agent activity inside an
// assistant message: one compact muted entry per tool call (tool name, the
// v2 op label, and the per-op status machine: running → pending → applied /
// discarded, or running → ok / refused / error). The chat is the audit
// trail — the list STAYS in the message (unlike legacy's transient per-bubble
// progress note). Semantic <ul> + aria-live="polite" per the UI-kit research
// recommendation (docs/uikit-research.md, tool-call activity row).

import type { AgentTool } from '../../lib/ai/agent';
import type { ToolOutcome } from '../../lib/ai/tool-results';
import styles from './AiPanel.module.css';

/** Per-op status: running while executing; ok for reads; writes end applied /
 *  discarded (after the card verdict), pending (card open), refused (read-only)
 *  or error (structured failure). */
export type ToolCallStatus = 'running' | 'ok' | 'refused' | 'error' | 'pending' | 'applied' | 'discarded';

/** View model of one agent tool call, built from the agent's tool events. */
export interface ToolCallView {
  id: number;
  tool: AgentTool;
  status: ToolCallStatus;
}

interface ToolActivityProps {
  steps: ToolCallView[];
  tt: (key: string) => string;
}

/** The tool-result outcome → the activity row's status. */
export function statusForOutcome(outcome: ToolOutcome): ToolCallStatus {
  if (outcome.status === 'error') return 'error';
  if (outcome.status === 'refused') return 'refused';
  if (outcome.status === 'pending') return 'pending';
  if (outcome.status === 'applied') return 'applied';
  return 'ok';
}

/** One label per v2 op (spec §5.3 — gerund phrases, EN/FA in dictionaries). */
const OP_LABEL_KEYS: Record<AgentTool, string> = {
  read_document: 'aiToolRead',
  search_document: 'aiToolSearch',
  document_outline: 'aiToolOutline',
  replace_text: 'aiToolReplaceText',
  insert_at_cursor: 'aiToolInsert',
  replace_range: 'aiToolRange',
  replace_document: 'aiToolReplaceDoc',
};

const STATUS_LABEL_KEYS: Record<Exclude<ToolCallStatus, 'running'>, string> = {
  ok: 'aiToolOk',
  refused: 'aiToolRefused',
  error: 'aiToolError',
  pending: 'aiToolPending',
  applied: 'aiToolApplied',
  discarded: 'aiToolDiscarded',
};

/** Compact muted list of the agent's tool calls for one assistant message. */
export default function ToolActivity({ steps, tt }: ToolActivityProps) {
  if (steps.length === 0) return null;
  return (
    <ul className={styles.toolList} aria-label={tt('aiToolActivity')} aria-live="polite">
      {steps.map((step) => (
        <li key={step.id} className={styles.toolItem} data-status={step.status}>
          <code className={styles.toolName}>{step.tool}</code>
          <span className={styles.toolDesc}>{tt(OP_LABEL_KEYS[step.tool])}</span>
          {step.status === 'running' ? (
            <span className={styles.toolStatus}>
              <span className={styles.spinner} aria-hidden="true" />
              {tt('aiToolRunning')}
            </span>
          ) : (
            <span className={styles.toolStatus} data-ok={step.status === 'ok'}>
              {tt(STATUS_LABEL_KEYS[step.status])}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
