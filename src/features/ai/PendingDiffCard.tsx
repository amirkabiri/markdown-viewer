// Module: features/ai/PendingDiffCard — one proposed edit awaiting the user's
// verdict in the chat thread (spec §5.4). Removed/added lines render bounded
// (MAX_DIFF_LINES_PER_SECTION per side, counts + hidden summary beyond); the
// resolution label is an aria-live region so the outcome is announced; Apply
// and Discard are real buttons (keyboard operable), retired once resolved.

import { Button } from 'react-aria-components';
import { boundDiffLines } from '../../lib/ai/tool-results';
import type { PendingDiffView } from './pendingDiff';
import styles from './AiPanel.module.css';

interface PendingDiffCardProps {
  diff: PendingDiffView;
  tt: (key: string) => string;
  onApply: () => void;
  onDiscard: () => void;
}

/** Localized "{n} more lines" (the {n} in the dictionary is replaced here). */
function moreLines(tt: (key: string) => string, hidden: number): string {
  return tt('aiDiffMore').replace('{n}', hidden.toLocaleString('en-US'));
}

/** The live-region label per card state. */
function statusLabelFor(status: PendingDiffView['status'], tt: (key: string) => string): string {
  if (status === 'applied') return tt('aiToolApplied');
  if (status === 'discarded') return tt('aiToolDiscarded');
  if (status === 'error') return tt('aiDiffChanged');
  return tt('aiToolPending');
}

/** Stable row keys without array indices: content + its occurrence number. */
function keyedLines(lines: string[]): { key: string; line: string }[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const nth = (seen.get(line) ?? 0) + 1;
    seen.set(line, nth);
    return { key: `${nth}:${line}`, line };
  });
}

export default function PendingDiffCard({
  diff, tt, onApply, onDiscard,
}: PendingDiffCardProps) {
  const resolved = diff.status !== 'pending';
  const removed = boundDiffLines(diff.data.removedText);
  const added = boundDiffLines(diff.data.addedText);
  const range = diff.data.startLine === diff.data.endLine
    ? `${tt('aiExcerptLines')} ${diff.data.startLine.toLocaleString('en-US')}`
    : `${tt('aiExcerptLines')} ${diff.data.startLine.toLocaleString('en-US')}–${diff.data.endLine.toLocaleString('en-US')}`;

  const statusLabel = statusLabelFor(diff.status, tt);

  return (
    <div className={styles.diffCard} role="group" aria-label={tt('aiDiffTitle')} data-status={diff.status}>
      <div className={styles.diffHead}>
        <code className={styles.toolName}>{diff.data.tool}</code>
        <span className={styles.diffRange}>{range}</span>
        <span className={styles.diffLive} aria-live="polite" data-status={diff.status}>
          {statusLabel}
        </span>
      </div>

      {removed.lines.length > 0 && (
        <ul
          className={`${styles.diffSection} ${styles.diffRemoved}`}
          aria-label={`${tt('aiDiffRemoved')} (${removed.lines.length + removed.hidden})`}
        >
          {keyedLines(removed.lines).map(({ key, line }) => (
            <li key={key}>{`− ${line}`}</li>
          ))}
          {removed.hidden > 0 && (
            <li className={styles.diffMore}>{moreLines(tt, removed.hidden)}</li>
          )}
        </ul>
      )}

      {added.lines.length > 0 && (
        <ul
          className={`${styles.diffSection} ${styles.diffAdded}`}
          aria-label={`${tt('aiDiffAdded')} (${added.lines.length + added.hidden})`}
        >
          {keyedLines(added.lines).map(({ key, line }) => (
            <li key={key}>{`+ ${line}`}</li>
          ))}
          {added.hidden > 0 && <li className={styles.diffMore}>{moreLines(tt, added.hidden)}</li>}
        </ul>
      )}

      {!resolved && (
        <div className={styles.diffActions}>
          <Button onPress={onApply} className={styles.diffApply}>{tt('aiDiffApply')}</Button>
          <Button onPress={onDiscard} className={styles.diffDiscard}>{tt('aiDiffDiscard')}</Button>
        </div>
      )}
    </div>
  );
}
