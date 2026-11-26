import { describe, expect, it } from 'vitest';

import {
    areSessionMetadataStabilityEqual,
    buildSessionMetadataStabilitySignature,
} from './sessionMetadataStability';

const base: any = {
    path: '/repo',
    host: 'phone',
    flavor: 'pi',
    summary: { text: 'Fix the parser', updatedAt: 1 },
    readStateV1: { sessionSeq: 4, pendingActivityAt: 10 },
    sessionModelsV1: { current: 'm1', available: [{ id: 'm1' }, { id: 'm2' }], updatedAt: 5 },
    tags: ['a', 'b'],
};

const cases: Array<[string, any, any]> = [
    ['same reference', base, base],
    ['both missing', null, undefined],
    ['one missing', base, null],
    ['equal copy', base, structuredClone(base)],
    ['read state only', base, { ...base, readStateV1: { sessionSeq: 9, pendingActivityAt: 99 } }],
    ['nested updatedAt only', base, { ...base, summary: { text: 'Fix the parser', updatedAt: 2 } }],
    ['nested text change', base, { ...base, summary: { text: 'Other', updatedAt: 1 } }],
    ['models change', base, { ...base, sessionModelsV1: { ...base.sessionModelsV1, current: 'm2' } }],
    ['key order differs', { a: 1, b: { x: 1, y: 2 } }, { b: { y: 2, x: 1 }, a: 1 }],
    ['added key', base, { ...base, extra: 1 }],
    ['undefined vs missing', { a: 1, b: undefined }, { a: 1 }],
    ['null vs missing', { a: 1, b: null }, { a: 1 }],
    ['array order differs', base, { ...base, tags: ['b', 'a'] }],
    ['top-level updatedAt counts', { updatedAt: 1 }, { updatedAt: 2 }],
];

describe('areSessionMetadataStabilityEqual', () => {
    it.each(cases)('agrees with the stability signature: %s', (_name, prev, next) => {
        const expected = buildSessionMetadataStabilitySignature(prev) === buildSessionMetadataStabilitySignature(next);
        expect(areSessionMetadataStabilityEqual(prev, next)).toBe(expected);
        expect(areSessionMetadataStabilityEqual(next, prev)).toBe(expected);
    });
});

describe('buildSessionMetadataStabilitySignature cache', () => {
    it('reuses the signature for the same metadata object and recomputes for a new one', () => {
        const metadata = { path: '/tmp/a', host: 'h', name: 'one' } as any;
        const first = buildSessionMetadataStabilitySignature(metadata);
        expect(buildSessionMetadataStabilitySignature(metadata)).toBe(first);
        const next = buildSessionMetadataStabilitySignature({ ...metadata, name: 'two' } as any);
        expect(next).not.toBe(first);
        expect(next).toContain('two');
    });
});
