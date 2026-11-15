import { describe, expect, it } from 'vitest';

import { ReviewFindingSchema } from './ReviewFinding.js';

const baseFinding = {
  id: 'f1',
  title: 'Untrusted input reaches the command line',
  severity: 'high',
  category: 'security',
  filePath: 'src/run.ts',
  startLine: 12,
  summary: 'A caller-supplied value is interpolated into a spawned command.',
} as const;

describe('ReviewFindingSchema', () => {
  it('parses a finding without line hash fields (existing payload)', () => {
    expect(ReviewFindingSchema.parse(baseFinding)).toMatchObject(baseFinding);
  });

  it('parses a finding with a line hash and its algorithm', () => {
    const parsed = ReviewFindingSchema.parse({
      ...baseFinding,
      lineHash: 'lh1:28c4a85114b7a7b9',
      lineHashAlgorithm: 'line-content-hash-v1',
    });

    expect(parsed.lineHash).toBe('lh1:28c4a85114b7a7b9');
    expect(parsed.lineHashAlgorithm).toBe('line-content-hash-v1');
  });

  it('parses a finding with only a line hash algorithm absent the hash and vice versa', () => {
    expect(ReviewFindingSchema.parse({
      ...baseFinding,
      lineHash: 'lh1:28c4a85114b7a7b9',
    }).lineHash).toBe('lh1:28c4a85114b7a7b9');

    expect(ReviewFindingSchema.parse({
      ...baseFinding,
      lineHashAlgorithm: 'line-content-hash-v1',
    }).lineHashAlgorithm).toBe('line-content-hash-v1');
  });
});
