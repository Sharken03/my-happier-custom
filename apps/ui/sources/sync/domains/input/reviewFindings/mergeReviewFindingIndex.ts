import type { ReviewFindingIndex, ReviewFindingIndexEntry } from './reviewFindingIndexTypes';

/**
 * Additively merges one run's entries into the index for a workspace cache key.
 * The given run's prior entries are replaced (a run is a full snapshot); runs
 * not in `retainedRunIds` are dropped. The input is never mutated.
 *
 * `retainedRunIds` is deliberately about *retention*, not liveness: a completed
 * review run's findings are the ones that matter most, so passing only the ids
 * of currently running runs would drop exactly the finished reviews. Pass every
 * run whose findings should stay indexed (running and retained).
 */
export function mergeReviewFindingIndex(params: Readonly<{
    current: ReviewFindingIndex;
    workspaceCacheKey: string;
    runId: string;
    entries: readonly ReviewFindingIndexEntry[];
    retainedRunIds: ReadonlySet<string>;
}>): ReviewFindingIndex {
    const key = String(params.workspaceCacheKey ?? '').trim();
    if (!key) return params.current;

    const existing = params.current[key] ?? [];

    const nextEntries: ReviewFindingIndexEntry[] = [];
    for (const entry of existing) {
        if (entry.runId === params.runId) continue;
        if (!params.retainedRunIds.has(entry.runId)) continue;
        nextEntries.push(entry);
    }
    if (params.retainedRunIds.has(params.runId)) {
        nextEntries.push(...params.entries);
    }

    const next: Record<string, readonly ReviewFindingIndexEntry[]> = { ...params.current };
    if (nextEntries.length > 0) {
        next[key] = nextEntries;
    } else {
        delete next[key];
    }
    return next;
}
