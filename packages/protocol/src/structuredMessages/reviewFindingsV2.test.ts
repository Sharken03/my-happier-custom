import { describe, expect, it } from 'vitest';

import {
  mergeReviewResolutionUpdate,
  parseReviewFindingsV2,
  ReviewFindingsV2Schema,
} from './reviewFindingsV2.js';
import { parseReviewFindingsV1, ReviewFindingsV1Schema } from './reviewFindingsV1.js';

const baseV2 = {
  runRef: { runId: 'run_1', callId: 'call_1', backendId: 'pi' },
  summary: 'Ok',
  overviewMarkdown: 'Overview',
  findings: [{ id: 'f1', title: 'T', severity: 'high', category: 'correctness', summary: 'S' }],
  questions: [],
  assumptions: [],
  generatedAtMs: 1,
};

const v1Payload = {
  runRef: { runId: 'run_1', callId: 'call_1', backendId: 'pi' },
  summary: 'Ok',
  findings: [{ id: 'f1', title: 'T', severity: 'high', category: 'correctness', summary: 'S' }],
  generatedAtMs: 1,
};

describe('ReviewFindingsV2 resolution overlay', () => {
  it('parses a payload without a resolution overlay', () => {
    expect(parseReviewFindingsV2(baseV2)?.resolution).toBeUndefined();
  });

  it('parses a payload with a partial resolution overlay', () => {
    const parsed = parseReviewFindingsV2({
      ...baseV2,
      resolution: {
        findings: [{ id: 'f1', state: 'fixed' }],
      },
    });
    expect(parsed?.resolution?.findings).toEqual([{ id: 'f1', state: 'fixed' }]);
  });

  it('rejects an invalid resolution state', () => {
    expect(ReviewFindingsV2Schema.safeParse({
      ...baseV2,
      resolution: { findings: [{ id: 'f1', state: 'banana' }] },
    }).success).toBe(false);
  });

  it('rejects a resolution entry without an id', () => {
    expect(ReviewFindingsV2Schema.safeParse({
      ...baseV2,
      resolution: { findings: [{ state: 'fixed' }] },
    }).success).toBe(false);
  });

  it('merge helper is additive and idempotent', () => {
    const payload = parseReviewFindingsV2({
      ...baseV2,
      resolution: { findings: [{ id: 'f1', state: 'open' }] },
    })!;

    const merged = mergeReviewResolutionUpdate(payload, { state: 'fixed', findingIds: ['f2'] });
    const states = new Map(merged.resolution!.findings.map((f) => [f.id, f.state]));
    expect(states.get('f1')).toBe('open'); // untouched
    expect(states.get('f2')).toBe('fixed'); // added

    const again = mergeReviewResolutionUpdate(merged, { state: 'fixed', findingIds: ['f2'] });
    expect(again.resolution?.findings).toEqual(merged.resolution?.findings);
  });

  it('merge helper overwrites existing entries for the same ids', () => {
    const payload = parseReviewFindingsV2({
      ...baseV2,
      resolution: { findings: [{ id: 'f1', state: 'open' }] },
    })!;
    const merged = mergeReviewResolutionUpdate(payload, { state: 'wontfix', findingIds: ['f1'] });
    expect(merged.resolution?.findings).toEqual([{ id: 'f1', state: 'wontfix' }]);
  });

  it('leaves v1 payloads unaffected', () => {
    expect(ReviewFindingsV1Schema.safeParse(v1Payload).success).toBe(true);
    expect(parseReviewFindingsV1(v1Payload)?.summary).toBe('Ok');
  });
});
