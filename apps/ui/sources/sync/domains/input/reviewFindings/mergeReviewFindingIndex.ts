import type { ReviewFindingIndex, ReviewFindingIndexEntry } from './reviewFindingIndexTypes';

/**
 * Additively merges one run's entries into the index for a workspace cache key.
 * The given run's prior entries are replaced (a run is a full snapshot); runs
 * not in `liveRunIds` are dropped. The input is never mutated.
 */
export function mergeReviewFindingIndex(params: Readonly<{
    current: ReviewFindingIndex;
    workspaceCacheKey: string;
    runId: string;
    entries: readonly ReviewFindingIndexEntry[];
    liveRunIds: ReadonlySet<string>;
}>): ReviewFindingIndex {
    const key = String(params.workspaceCacheKey ?? '').trim();
    if (!key) return params.current;

    const existing = params.current[key] ?? [];

    const nextEntries: ReviewFindingIndexEntry[] = [];
    for (const entry of existing) {
        if (entry.runId === params.runId) continue;
        if (!params.liveRunIds.has(entry.runId)) continue;
        nextEntries.push(entry);
    }
    if (params.liveRunIds.has(params.runId)) {
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
