import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseReviewFindingsV2, ReviewFindingsV2Schema } from '../src/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'reviewFindingsV2.minimal.json'), 'utf8')) as unknown;

describe('pi-review ReviewFindingsV2 mirror', () => {
  it('accepts the shared minimal fixture', () => {
    const parsed = parseReviewFindingsV2(fixture);
    expect(parsed).not.toBeNull();
    expect(parsed?.runRef.backendId).toBe('pi');
    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.questions).toEqual([]); // defaults applied
    expect(parsed?.assumptions).toEqual([]);
  });

  it('accepts a payload with optional overlays (passthrough semantics)', () => {
    const withExtras = {
      ...(fixture as Record<string, unknown>),
      publication: { findings: [{ id: 'f-1', published: true }] },
      resolution: { findings: [{ id: 'f-1', state: 'fixed' }] },
      customExtra: 'survives',
    };
    expect(parseReviewFindingsV2(withExtras)?.publication).toBeDefined();
  });

  it('rejects a payload missing runRef.runId', () => {
    const broken = {
      ...(fixture as Record<string, unknown>),
      runRef: { callId: 'call-1', backendId: 'pi' },
    };
    expect(ReviewFindingsV2Schema.safeParse(broken).success).toBe(false);
    expect(parseReviewFindingsV2(broken)).toBeNull();
  });

  it('rejects a payload missing findings[].id', () => {
    const broken = {
      ...(fixture as Record<string, unknown>),
      findings: [{ title: 'T', severity: 'low', category: 'maintainability', summary: 'S' }],
    };
    expect(ReviewFindingsV2Schema.safeParse(broken).success).toBe(false);
    expect(parseReviewFindingsV2(broken)).toBeNull();
  });

  it('rejects a finding with an invalid severity enum value', () => {
    const broken = {
      ...(fixture as Record<string, unknown>),
      findings: [{ id: 'f-1', title: 'T', severity: 'banana', category: 'maintainability', summary: 'S' }],
    };
    expect(parseReviewFindingsV2(broken)).toBeNull();
  });
});
