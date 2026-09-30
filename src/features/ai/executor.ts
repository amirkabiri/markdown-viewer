// Module: features/ai/executor — the agent's hands (the v2 ToolExecutor):
// reads always granted; writes gated by the direct-edit permission (off ⇒ a
// structured READ_ONLY refusal), landing as either an immediate apply
// (small op, spec §5.4 auto-apply budget) or a PENDING diff the panel renders
// as a card. All DOM writes go through the FROZEN EditorApi.applyEdit
// mechanism (execCommand insertText → setRangeText), so native undo and
// autosave behave exactly like a user edit: one splice = one undo step.
//
// Line-number freshness: the executor keeps `basisDoc` — the document as of
// the model's most recent read/search/outline (or the send). replace_range
// re-validates against it at apply time; a document that moved ⇒ structured
// STALE_RANGE error, never a corrupt edit. Writes deliberately do NOT refresh
// the basis: after editing, the model must re-read before using line numbers.

import type { AgentTool, AgentToolCall, ToolExecutor } from '../../lib/ai/agent';
import { parseSearchReplace } from '../../lib/ai/agent';
import {
  AUTO_APPLY_MAX_LINES,
  countLines,
  documentOutline,
  formatDocumentRead,
  formatOutlineResult,
  formatSearchResult,
  readDocumentLines,
  searchDocument,
} from '../../lib/ai/tool-results';
import type { PendingDiffData, ToolOutcome } from '../../lib/ai/tool-results';
import { planReplaceRange, planReplaceText } from '../../lib/ai/edits';
import type { ReplaceTextOccurrence, SpanReplacePlan } from '../../lib/ai/edits';
import type { EditorApi } from '../editor/api';

export interface ExecutorOptions {
  /** The direct-edit setting — the agent's write permission. */
  directEdit: boolean;
}

const READ_ONLY_REFUSAL: ToolOutcome = {
  status: 'refused',
  code: 'READ_ONLY',
  message: 'write access is disabled (direct editing is off)',
  hint: 'do not retry — include the suggested text directly in your Markdown reply',
};

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value : null;
}

/** Lines a diff card reports for one side (no phantom trailing line). */
function diffLines(text: string): string[] {
  if (text === '') return [];
  return text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
}

/** The changed-line budget (spec §5.4): N = 20 removed+added lines. A 10-line
 *  SEARCH/REPLACE stays one fluent in-editor edit; bigger lands as a card. */
function isSmallOp(removedText: string, addedText: string): boolean {
  return diffLines(removedText).length + diffLines(addedText).length <= AUTO_APPLY_MAX_LINES;
}

/**
 * Creates the v2 tool executor over the frozen editor contract. One instance
 * per send: its line-number basis starts at the pinned document and is
 * refreshed by every read-shaped call.
 */
export function createToolExecutor(editor: EditorApi, opts: ExecutorOptions): ToolExecutor {
  const basis: { current: string } = { current: editor.getText() };

  function applySpan(plan: SpanReplacePlan): boolean {
    return editor.applyEdit('replace-selection', plan.replacement, [plan.start, plan.end]);
  }

  /** Pending diff data + payload message for one planned splice. */
  function asPending(
    tool: AgentTool,
    doc: string,
    plan: SpanReplacePlan,
  ): ToolOutcome {
    const removedText = doc.slice(plan.start, plan.end);
    const addedText = plan.replacement;
    const removed = diffLines(removedText).length;
    const added = diffLines(addedText).length;
    const where = plan.startLine === plan.endLine
      ? `line ${plan.startLine}`
      : `lines ${plan.startLine}-${plan.endLine}`;
    return {
      status: 'pending',
      message: `proposed replacing ${where} (${removed} removed / ${added} added)${
        plan.matchCount > 1 ? ` — ${plan.matchCount} occurrences` : ''}`,
      diff: {
        tool,
        startLine: plan.startLine,
        endLine: plan.endLine,
        startOffset: plan.start,
        endOffset: plan.end,
        removedText,
        addedText,
      },
    };
  }

  /** Applied outcome for one planned splice (already applied). */
  function asApplied(plan: SpanReplacePlan): ToolOutcome {
    const where = plan.startLine === plan.endLine
      ? `line ${plan.startLine}`
      : `lines ${plan.startLine}-${plan.endLine}`;
    return {
      status: 'applied',
      message: `replaced ${where}${
        plan.matchCount > 1 ? ` (${plan.matchCount} occurrences)` : ''}`,
    };
  }

  return {
    execute(call: AgentToolCall): ToolOutcome {
      const doc = editor.getText();
      switch (call.tool) {
        case 'read_document': {
          const read = readDocumentLines(
            doc,
            numberArg(call.args, 'offset', 1),
            numberArg(call.args, 'limit', 400),
          );
          // The read's line numbers are the new coordinate system.
          basis.current = doc;
          return { status: 'ok', message: formatDocumentRead(read) };
        }
        case 'search_document': {
          const pattern = stringArg(call.args, 'pattern') ?? '';
          const result = searchDocument(doc, pattern, {
            regex: call.args.regex === true,
            maxResults: numberArg(call.args, 'maxResults', 20),
          });
          if (result.status === 'error') {
            return {
              status: 'error',
              code: result.code,
              message: 'the search failed',
              hint: result.hint,
            };
          }
          // Search results carry line numbers — they re-anchor the basis.
          basis.current = doc;
          return { status: 'ok', message: formatSearchResult(result, pattern, call.args.regex === true) };
        }
        case 'document_outline': {
          basis.current = doc;
          return {
            status: 'ok',
            message: formatOutlineResult(documentOutline(doc), countLines(doc)),
          };
        }
        case 'insert_at_cursor': {
          if (!opts.directEdit) return READ_ONLY_REFUSAL;
          const text = stringArg(call.args, 'text') ?? '';
          return editor.applyEdit('cursor', text)
            ? { status: 'applied', message: `inserted ${diffLines(text).length} line(s) at the caret` }
            : {
              status: 'error', code: 'CANCELLED', message: 'the insert was cancelled', hint: 'do not retry; include the text in your reply',
            };
        }
        case 'replace_text': {
          if (!opts.directEdit) return READ_ONLY_REFUSAL;
          const parts = parseSearchReplace(call.body);
          if (parts === null) {
            return {
              status: 'error',
              code: 'BAD_BODY',
              message: 'the block has no parseable SEARCH/REPLACE sections',
              hint: 'emit one ```qalam block with a JSON header line, then <<<<<<< SEARCH / ======= / >>>>>>> REPLACE',
            };
          }
          const occurrence: ReplaceTextOccurrence = call.args.occurrence === 'all' ? 'all' : 'first';
          const plan = planReplaceText(doc, parts.search, parts.replacement, occurrence);
          if (plan.status === 'error') {
            return {
              status: 'error',
              code: plan.code,
              message: plan.code === 'NOT_FOUND'
                ? 'the SEARCH text was not found in the document'
                : 'the SEARCH block is empty',
              hint: plan.hint,
              nearestLines: plan.nearestLines,
            };
          }
          if (isSmallOp(doc.slice(plan.plan.start, plan.plan.end), plan.plan.replacement)) {
            return applySpan(plan.plan)
              ? asApplied(plan.plan)
              : {
                status: 'error', code: 'CANCELLED', message: 'the edit was cancelled', hint: 'do not retry; include the text in your reply',
              };
          }
          return asPending(call.tool, doc, plan.plan);
        }
        case 'replace_range': {
          if (!opts.directEdit) return READ_ONLY_REFUSAL;
          const plan = planReplaceRange(
            doc,
            basis.current,
            numberArg(call.args, 'startLine', 0),
            numberArg(call.args, 'endLine', 0),
            call.body,
          );
          if (plan.status === 'error') {
            return {
              status: 'error',
              code: plan.code,
              message: plan.code === 'STALE_RANGE'
                ? 'line numbers are out of date — the document changed since your last read'
                : 'the line range is invalid',
              hint: plan.hint,
            };
          }
          if (isSmallOp(doc.slice(plan.plan.start, plan.plan.end), plan.plan.replacement)) {
            return applySpan(plan.plan)
              ? asApplied(plan.plan)
              : {
                status: 'error', code: 'CANCELLED', message: 'the edit was cancelled', hint: 'do not retry; include the text in your reply',
              };
          }
          return asPending(call.tool, doc, plan.plan);
        }
        case 'replace_document': {
          if (!opts.directEdit) return READ_ONLY_REFUSAL;
          const text = call.body !== '' ? call.body : (stringArg(call.args, 'text') ?? '');
          // Stays behind the editor's own confirm dialog (frozen applyEdit).
          return editor.applyEdit('replace-document', text)
            ? { status: 'applied', message: `replaced the whole document (${countLines(text)} lines)` }
            : {
              status: 'error', code: 'CANCELLED', message: 'the user declined the replace-document confirmation', hint: 'propose a smaller edit (replace_text) instead',
            };
        }
        default:
          return {
            status: 'error',
            code: 'BAD_BODY',
            message: 'unknown tool',
            hint: 'use one of the seven documented tools',
          };
      }
    },
  };
}

/* ---------------- pending-card resolution (the panel's Apply) ---------------- */

export interface ApplicableDiff {
  data: PendingDiffData;
  /** The document as captured when the card was proposed. */
  docAtProposal: string;
}

export type ApplyDiffResult = { applied: true } | { applied: false; reason: 'changed' };

/**
 * Applies a pending diff at click time, re-verifying against the LIVE
 * document: a content-anchored diff re-anchors when the text moved (the
 * whitespace-tolerant planner gets a second chance); a line-anchored diff is
 * refused with `changed` when the document is not the one the range was
 * validated against — stale cards never corrupt the document.
 */
export function applyPendingDiff(editor: EditorApi, diff: ApplicableDiff): ApplyDiffResult {
  const { data } = diff;
  const doc = editor.getText();
  if (data.tool === 'replace_range' && doc !== diff.docAtProposal) {
    return { applied: false, reason: 'changed' };
  }
  let start = data.startOffset;
  let end = data.endOffset;
  if (doc.slice(start, end) !== data.removedText) {
    // The text moved since the proposal — re-anchor by content.
    if (data.tool === 'replace_range') return { applied: false, reason: 'changed' };
    const replan = planReplaceText(doc, data.removedText, data.addedText, 'first');
    if (replan.status !== 'ok') return { applied: false, reason: 'changed' };
    start = replan.plan.start;
    end = replan.plan.end;
  }
  return editor.applyEdit('replace-selection', data.addedText, [start, end])
    ? { applied: true }
    : { applied: false, reason: 'changed' };
}
