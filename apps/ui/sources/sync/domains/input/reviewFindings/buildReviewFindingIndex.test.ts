import { describe, expect, it } from 'vitest';

import type { ReviewFindingsV1, ReviewFindingsV2 } from '@happier-dev/protocol';

import { buildReviewFindingIndex } from './buildReviewFindingIndex';

const minimalRunRef = {
    runId: 'run-1',
    callId: 'call-1',
    backendId: 'pi',
};

const minimalV1 = {
    runRef: minimalRunRef,
    summary: 'summary',
    findings: [],
    generatedAtMs: 1000,
} satisfies ReviewFindingsV1;

const minimalV2 = {
    runRef: minimalRunRef,
    summary: 'summary',
    overviewMarkdown: '# overview',
    findings: [],
    questions: [],
    assumptions: [],
    generatedAtMs: 1000,
} satisfies ReviewFindingsV2;

const locatedFinding = {
    id: 'f1',
    title: 'Use of dangerous API',
    severity: 'high',
    category: 'security',
    summary: 'summary',
    filePath: 'src/a.ts',
    startLine: 10,
} as const;

const locatedFindingWithOverlays: ReviewFindingsV2 = {
    ...minimalV2,
    findings: [locatedFinding],
    publication: {
        findings: [{ id: 'f1', published: true, publishedAtMs: 2000 }],
    },
    resolution: {
        findings: [{ id: 'f1', state: 'fixed', updatedAtMs: 3000 }],
    },
};

describe('buildReviewFindingIndex', () => {
    it('maps a v2 payload with publication and resolution overlays', () => {
        const entries = buildReviewFindingIndex(locatedFindingWithOverlays, 'run-1');

        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({
            runId: 'run-1',
            findingId: 'f1',
            severity: 'high',
            category: 'security',
            filePath: 'src/a.ts',
            startLine: 10,
            title: 'Use of dangerous API',
            published: true,
            resolutionState: 'fixed',
            updatedAtMs: 3000,
        });
    });

    it('indexes findings without overlays as unpublished and implicitly open', () => {
        const entries = buildReviewFindingIndex({ ...minimalV2, findings: [locatedFinding] }, 'run-1');

        expect(entries[0].published).toBe(false);
        expect(entries[0].resolutionState).toBe('open');
        expect(entries[0].updatedAtMs).toBe(1000);
    });

    it('falls back to publishedAtMs when resolution carries no updatedAtMs', () => {
        const payload: ReviewFindingsV2 = {
            ...minimalV2,
            findings: [locatedFinding],
            publication: {
                findings: [{ id: 'f1', published: true, publishedAtMs: 2000 }],
            },
            resolution: {
                findings: [{ id: 'f1', state: 'applying' }],
            },
        };

        const entries = buildReviewFindingIndex(payload, 'run-1');

        expect(entries[0].resolutionState).toBe('applying');
        expect(entries[0].published).toBe(true);
        expect(entries[0].updatedAtMs).toBe(2000);
    });

    it('indexes a v1 payload with no overlays', () => {
        const payload: ReviewFindingsV1 = { ...minimalV1, findings: [locatedFinding] };

        const entries = buildReviewFindingIndex(payload, 'run-1');

        expect(entries[0].published).toBe(false);
        expect(entries[0].resolutionState).toBe('open');
        expect(entries[0].updatedAtMs).toBe(1000);
    });

    it('omits filePath and startLine when the finding has no location', () => {
        const finding = {
            id: 'f2',
            title: 'No location',
            severity: 'low',
            category: 'style',
            summary: 'summary',
        } as const;

        const entries = buildReviewFindingIndex({ ...minimalV2, findings: [finding] }, 'run-1');

        expect(entries[0].filePath).toBeUndefined();
        expect(entries[0].startLine).toBeUndefined();
    });
});
