import { describe, expect, it } from 'vitest';

import { parseReviewPublishRequestV1, ReviewPublishRequestV1Schema } from './reviewPublishRequestV1.js';

const baseRequest = {
  sourceRunRef: {
    runId: 'run_1',
    callId: 'call_1',
    backendId: 'pi',
  },
  findingIds: ['f1'],
  publishedFindings: [{
    id: 'f1',
    title: 'Untrusted input reaches the command line',
    severity: 'high',
    category: 'security',
    filePath: 'src/run.ts',
    startLine: 12,
    summary: 'A caller-supplied value is interpolated into a spawned command.',
  }],
} as const;

describe('ReviewPublishRequestV1Schema', () => {
  it('parses an existing publish request without a pullRequestNumber', () => {
    expect(parseReviewPublishRequestV1(baseRequest)).toMatchObject(baseRequest);
  });

  it('parses a publish request with an explicit pullRequestNumber', () => {
    const parsed = parseReviewPublishRequestV1({
      ...baseRequest,
      pullRequestNumber: 42,
    });

    expect(parsed?.pullRequestNumber).toBe(42);
  });

  it('rejects a non-positive pullRequestNumber', () => {
    expect(ReviewPublishRequestV1Schema.safeParse({
      ...baseRequest,
      pullRequestNumber: 0,
    }).success).toBe(false);

    expect(ReviewPublishRequestV1Schema.safeParse({
      ...baseRequest,
      pullRequestNumber: -1,
    }).success).toBe(false);
  });

  it('rejects a non-integer pullRequestNumber', () => {
    expect(ReviewPublishRequestV1Schema.safeParse({
      ...baseRequest,
      pullRequestNumber: 1.5,
    }).success).toBe(false);
  });
});
