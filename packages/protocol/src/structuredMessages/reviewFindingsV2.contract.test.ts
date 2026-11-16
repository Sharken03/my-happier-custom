import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseReviewFindingsV2 } from './reviewFindingsV2.js';

/**
 * The `pi-review` Pi package ships outside this monorepo and cannot import protocol, so it carries its own
 * mirror of this schema. That mirror is only safe if something fails when the two drift, which is what this
 * test is for: it parses the package's own fixture with THIS schema.
 *
 * The fixture is the shared contract. If a field becomes required here, the fixture stops parsing and this
 * fails, instead of the divergence showing up as a review payload Happier silently rejects in production.
 */
describe('pi-review fixture is a valid review_findings.v2 payload', () => {
  const fixturePath = join(
    __dirname,
    '..', '..', '..', '..',
    'packages', 'pi-review', 'test', 'reviewFindingsV2.minimal.json',
  );

  it('parses the pi-review minimal fixture', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const parsed = parseReviewFindingsV2(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.runRef).toMatchObject({ runId: 'run-1', callId: 'call-1', backendId: 'pi' });
    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.findings[0]).toMatchObject({ id: 'f-1', severity: 'low', category: 'maintainability' });
  });
});
