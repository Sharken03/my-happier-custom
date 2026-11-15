import { describe, expect, it } from 'vitest';

import {
    filterOpenReviewFindings,
    groupOpenReviewFindingsByFilePath,
    groupOpenReviewFindingsBySeverity,
    isOpenReviewFinding,
} from './filterOpenReviewFindings';
import type { ReviewFindingIndexEntry } from './reviewFindingIndexTypes';

function entry(overrides: {
    findingId: string;
    severity?: ReviewFindingIndexEntry['severity'];
    category?: ReviewFindingIndexEntry['category'];
    filePath?: string;
    title?: string;
    published?: boolean;
    resolutionState?: ReviewFindingIndexEntry['resolutionState'];
}): ReviewFindingIndexEntry {
    return {
        runId: 'run-1',
        findingId: overrides.findingId,
        severity: overrides.severity ?? 'medium',
        category: overrides.category ?? 'correctness',
        ...(overrides.filePath !== undefined ? { filePath: overrides.filePath } : {}),
        title: overrides.title ?? 'title',
        published: overrides.published ?? false,
        resolutionState: overrides.resolutionState ?? 'open',
        updatedAtMs: 1,
    };
}

describe('filterOpenReviewFindings', () => {
    it('treats unpublished and non-fixed/wontfix findings as open', () => {
        expect(isOpenReviewFinding(entry({ findingId: 'a', published: false, resolutionState: 'open' }))).toBe(true);
        expect(isOpenReviewFinding(entry({ findingId: 'b', published: false, resolutionState: 'applying' }))).toBe(true);
        expect(isOpenReviewFinding(entry({ findingId: 'c', published: false, resolutionState: 'still_present' }))).toBe(true);
        expect(isOpenReviewFinding(entry({ findingId: 'd', published: false, resolutionState: 'regressed' }))).toBe(true);
    });

    it('treats published, fixed, and wontfix findings as closed', () => {
        expect(isOpenReviewFinding(entry({ findingId: 'a', published: true, resolutionState: 'open' }))).toBe(false);
        expect(isOpenReviewFinding(entry({ findingId: 'b', published: false, resolutionState: 'fixed' }))).toBe(false);
        expect(isOpenReviewFinding(entry({ findingId: 'c', published: false, resolutionState: 'wontfix' }))).toBe(false);
    });

    it('filters to open findings only', () => {
        const entries = [
            entry({ findingId: 'a', resolutionState: 'open' }),
            entry({ findingId: 'b', resolutionState: 'fixed' }),
            entry({ findingId: 'c', published: true }),
            entry({ findingId: 'd', resolutionState: 'wontfix' }),
            entry({ findingId: 'e', resolutionState: 'applying' }),
        ];

        expect(filterOpenReviewFindings(entries).map((e) => e.findingId)).toEqual(['a', 'e']);
    });

    it('groups open findings by severity', () => {
        const entries = [
            entry({ findingId: 'a', severity: 'high' }),
            entry({ findingId: 'b', severity: 'high', resolutionState: 'fixed' }),
            entry({ findingId: 'c', severity: 'low' }),
        ];

        const grouped = groupOpenReviewFindingsBySeverity(entries);

        expect(grouped.high?.map((e) => e.findingId)).toEqual(['a']);
        expect(grouped.low?.map((e) => e.findingId)).toEqual(['c']);
    });

    it('groups open findings by file path and buckets file-less findings under empty string', () => {
        const entries = [
            entry({ findingId: 'a', filePath: 'src/a.ts' }),
            entry({ findingId: 'b', filePath: 'src/a.ts', resolutionState: 'fixed' }),
            entry({ findingId: 'c', filePath: 'src/b.ts' }),
            entry({ findingId: 'd' }),
        ];

        const grouped = groupOpenReviewFindingsByFilePath(entries);

        expect(grouped['src/a.ts'].map((e) => e.findingId)).toEqual(['a']);
        expect(grouped['src/b.ts'].map((e) => e.findingId)).toEqual(['c']);
        expect(grouped[''].map((e) => e.findingId)).toEqual(['d']);
    });
});
