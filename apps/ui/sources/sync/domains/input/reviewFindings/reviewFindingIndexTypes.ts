import type { ReviewFinding, ReviewResolutionState } from '@happier-dev/protocol';

export type ReviewFindingSeverity = ReviewFinding['severity'];
export type ReviewFindingCategory = ReviewFinding['category'];

/**
 * One indexed finding. This is the client-side projection of a single finding
 * from a run's `review_findings.v1|v2` structured meta; it carries only the
 * fields the UI needs to list open findings per workspace.
 *
 * `published` comes from the v2 `publication` overlay (`false` when absent).
 * `resolutionState` comes from the v2 `resolution` overlay (`'open'` when
 * absent). `updatedAtMs` is the most recent state change we can derive, in
 * order of precedence: the resolution entry's `updatedAtMs`, then the
 * publication entry's `publishedAtMs` (when published), then the payload's
 * `generatedAtMs`.
 */
export type ReviewFindingIndexEntry = Readonly<{
    runId: string;
    findingId: string;
    severity: ReviewFindingSeverity;
    category: ReviewFindingCategory;
    filePath?: string;
    startLine?: number;
    title: string;
    published: boolean;
    resolutionState: ReviewResolutionState;
    updatedAtMs: number;
}>;

/**
 * Per-workspace-cache-key index of findings. Lives next to
 * `reviewCommentsDraftsByWorkspaceCacheKey` so the two are reachable together.
 */
export type ReviewFindingIndex = Readonly<Record<string, readonly ReviewFindingIndexEntry[]>>;
