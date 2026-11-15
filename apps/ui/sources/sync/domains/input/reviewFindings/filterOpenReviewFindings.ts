import type { ReviewFindingIndexEntry, ReviewFindingSeverity } from './reviewFindingIndexTypes';

/**
 * Open = not published AND not resolved as `fixed` or `wontfix`. Every other
 * resolution state (`open`, `applying`, `still_present`, `regressed`) is still
 * open work.
 */
export function isOpenReviewFinding(entry: ReviewFindingIndexEntry): boolean {
    return !entry.published
        && entry.resolutionState !== 'fixed'
        && entry.resolutionState !== 'wontfix';
}

export function filterOpenReviewFindings(
    entries: readonly ReviewFindingIndexEntry[],
): readonly ReviewFindingIndexEntry[] {
    return entries.filter(isOpenReviewFinding);
}

export type ReviewFindingsBySeverity = Readonly<
    Partial<Record<ReviewFindingSeverity, readonly ReviewFindingIndexEntry[]>>
>;

export function groupOpenReviewFindingsBySeverity(
    entries: readonly ReviewFindingIndexEntry[],
): ReviewFindingsBySeverity {
    const grouped: Partial<Record<ReviewFindingSeverity, ReviewFindingIndexEntry[]>> = {};
    for (const entry of filterOpenReviewFindings(entries)) {
        const next = grouped[entry.severity] ?? [];
        grouped[entry.severity] = [...next, entry];
    }
    return grouped;
}

export type ReviewFindingsByFilePath = Readonly<Record<string, readonly ReviewFindingIndexEntry[]>>;

/**
 * Groups open findings by file path. Findings without a location are bucketed
 * under the empty string so none are dropped by the grouping.
 */
export function groupOpenReviewFindingsByFilePath(
    entries: readonly ReviewFindingIndexEntry[],
): ReviewFindingsByFilePath {
    const grouped: Record<string, ReviewFindingIndexEntry[]> = {};
    for (const entry of filterOpenReviewFindings(entries)) {
        const filePath = entry.filePath ?? '';
        const next = grouped[filePath] ?? [];
        grouped[filePath] = [...next, entry];
    }
    return grouped;
}
