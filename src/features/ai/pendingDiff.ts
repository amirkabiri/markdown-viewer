// Module: features/ai/pendingDiff — the view model of a pending-diff card
// (spec §5.4): the structured proposal from the executor plus the resolution
// state the user drives (pending → applied/discarded, or error when the
// document moved too far for a safe apply). `docAtProposal` is the document
// reference captured when the card was created — the staleness witness for
// line-anchored (replace_range) applies.

import type { PendingDiffData } from '../../lib/ai/tool-results';

export type PendingDiffStatus = 'pending' | 'applied' | 'discarded' | 'error';

export interface PendingDiffView {
  id: number;
  /** The ToolActivity step this proposal belongs to (status moves together). */
  stepId: number;
  status: PendingDiffStatus;
  data: PendingDiffData;
  docAtProposal: string;
}
