import { describe, expect, it } from 'vitest';

import { mergeReviewFindingIndex } from './mergeReviewFindingIndex';
import type { ReviewFindingIndex, ReviewFindingIndexEntry } from './reviewFindingIndexTypes';

const KEY = 'server-1:machine-1:/repo';

function entry(runId: string, findingId: string): ReviewFindingIndexEntry {
    return {
        runId,
        findingId,
        severity: 'medium',
        category: 'correctness',
        title: 'title',
        published: false,
        resolutionState: 'open',
        updatedAtMs: 1,
    };
}

describe('mergeReviewFindingIndex', () => {
    it('additively merges a new run while preserving existing runs', () => {
        const current: ReviewFindingIndex = {
            [KEY]: [entry('run-1', 'a'), entry('run-1', 'b'), entry('run-2', 'c')],
        };

        const result = mergeReviewFindingIndex({
            current,
            workspaceCacheKey: KEY,
            runId: 'run-3',
            entries: [entry('run-3', 'd')],
            retainedRunIds: new Set(['run-1', 'run-2', 'run-3']),
        });

        expect(result[KEY]?.map((e) => `${e.runId}:${e.findingId}`)).toEqual([
            'run-1:a',
            'run-1:b',
            'run-2:c',
            'run-3:d',
        ]);
    });

    it('replaces the given run\u2019s prior entries', () => {
        const current: ReviewFindingIndex = {
            [KEY]: [entry('run-1', 'old-1'), entry('run-1', 'old-2'), entry('run-2', 'c')],
        };

        const result = mergeReviewFindingIndex({
            current,
            workspaceCacheKey: KEY,
            runId: 'run-1',
            entries: [entry('run-1', 'new-1')],
            retainedRunIds: new Set(['run-1', 'run-2']),
        });

        expect(result[KEY]?.map((e) => e.findingId)).toEqual(['c', 'new-1']);
    });

    it('removes entries of runs no longer retained', () => {
        const current: ReviewFindingIndex = {
            [KEY]: [entry('run-1', 'a'), entry('run-2', 'c')],
        };

        const result = mergeReviewFindingIndex({
            current,
            workspaceCacheKey: KEY,
            runId: 'run-1',
            entries: [entry('run-1', 'a')],
            retainedRunIds: new Set(['run-1']),
        });

        expect(result[KEY]?.map((e) => e.findingId)).toEqual(['a']);
    });

    it('drops the key when no entries remain for the workspace', () => {
        const current: ReviewFindingIndex = {
            [KEY]: [entry('run-1', 'a')],
            'other-key': [entry('run-1', 'b')],
        };

        const result = mergeReviewFindingIndex({
            current,
            workspaceCacheKey: KEY,
            runId: 'run-1',
            entries: [],
            retainedRunIds: new Set(['run-2']),
        });

        expect(result[KEY]).toBeUndefined();
        expect(result['other-key']).toHaveLength(1);
    });

    it('never mutates the input index', () => {
        const originalEntries = [entry('run-1', 'a')];
        const current: ReviewFindingIndex = { [KEY]: originalEntries };

        const result = mergeReviewFindingIndex({
            current,
            workspaceCacheKey: KEY,
            runId: 'run-1',
            entries: [entry('run-1', 'b')],
            retainedRunIds: new Set(['run-1']),
        });

        expect(result).not.toBe(current);
        expect(result[KEY]).not.toBe(originalEntries);
        expect(current[KEY]).toBe(originalEntries);
        expect(current[KEY]?.map((e) => e.findingId)).toEqual(['a']);
    });

    it('returns the input unchanged for a blank workspace cache key', () => {
        const current: ReviewFindingIndex = { [KEY]: [entry('run-1', 'a')] };

        const result = mergeReviewFindingIndex({
            current,
            workspaceCacheKey: '   ',
            runId: 'run-2',
            entries: [entry('run-2', 'b')],
            retainedRunIds: new Set(['run-1', 'run-2']),
        });

        expect(result).toBe(current);
    });
});
