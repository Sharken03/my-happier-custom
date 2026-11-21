import { describe, expect, it } from 'vitest';

import { mergeTurnChangeSets } from './mergeTurnChangeSets.js';
import { combineTextChanges, hasUnifiedDiffLineChanges, TEXT_CHANGE_SNIPPET_SEPARATOR } from './textChanges.js';
import type { FileChangeEvidence, TurnChangeSet } from './types.js';

const FILE = '/home/u/chats/c1/plan.md';
const PLACEHOLDER = [`diff --git a${FILE} b${FILE}`, `--- a${FILE}`, `+++ b${FILE}`, '@@ -0,0 +0,0 @@', '# Write'].join('\n');
const REAL_DIFF = [`--- a${FILE}`, `+++ b${FILE}`, '@@ -1 +1 @@', '-old line', '+new line'].join('\n');

function turn(turnId: string, file: Partial<FileChangeEvidence>): TurnChangeSet {
  return {
    sessionId: 's1',
    turnId,
    seqRange: { startSeqInclusive: 1, endSeqInclusive: 1 },
    status: 'completed',
    files: [{ filePath: FILE, changeKind: 'modified', source: 'provider_tool', confidence: 'exact', provider: 'pi', ...file }],
    provider: 'pi',
    derivedAt: 1,
  };
}

function mergedFile(...turns: TurnChangeSet[]) {
  return mergeTurnChangeSets({ sessionId: 's1', turns }).files[0]!;
}

describe('hasUnifiedDiffLineChanges', () => {
  it('is false for a placeholder and true for a diff that changes lines', () => {
    expect(hasUnifiedDiffLineChanges(PLACEHOLDER)).toBe(false);
    expect(hasUnifiedDiffLineChanges(`diff --git a${FILE} b${FILE}`)).toBe(false);
    expect(hasUnifiedDiffLineChanges(null)).toBe(false);
    expect(hasUnifiedDiffLineChanges(REAL_DIFF)).toBe(true);
  });
});

describe('combineTextChanges', () => {
  it('chains whole-file changes', () => {
    expect(combineTextChanges({ oldText: '', newText: 'a' }, { oldText: 'a', newText: 'ab' })).toEqual({ oldText: '', newText: 'ab' });
  });

  it('applies an edit snippet to the whole file text it occurs in once', () => {
    expect(combineTextChanges({ oldText: '', newText: 'one two three' }, { oldText: 'two', newText: '2' }))
      .toEqual({ oldText: '', newText: 'one 2 three' });
  });

  it('keeps unrelated snippets next to each other with a separator line', () => {
    const sep = `\n${TEXT_CHANGE_SNIPPET_SEPARATOR}\n`;
    expect(combineTextChanges({ oldText: 'x1', newText: 'y1' }, { oldText: 'x2', newText: 'y2' }))
      .toEqual({ oldText: `x1${sep}x2`, newText: `y1${sep}y2` });
  });
});

describe('mergeTurnChangeSets file evidence', () => {
  it('drops a placeholder diff when a later turn has the text change', () => {
    const file = mergedFile(
      turn('t1', { unifiedDiff: PLACEHOLDER }),
      turn('t2', { oldText: 'a', newText: 'b' }),
    );
    expect(file.unifiedDiff).toBeNull();
    expect(file).toMatchObject({ oldText: 'a', newText: 'b', turns: ['t1', 't2'] });
  });

  it('does not let a later placeholder hide an earlier real diff', () => {
    const file = mergedFile(turn('t1', { unifiedDiff: REAL_DIFF }), turn('t2', { unifiedDiff: PLACEHOLDER }));
    expect(file.unifiedDiff).toBe(REAL_DIFF);
  });

  it('does not let a later placeholder hide an earlier text change', () => {
    const file = mergedFile(turn('t1', { oldText: 'a', newText: 'b' }), turn('t2', { unifiedDiff: PLACEHOLDER }));
    expect(file.unifiedDiff).toBeNull();
    expect(file).toMatchObject({ oldText: 'a', newText: 'b' });
  });

  it('never pairs the old snippet of one edit with the new snippet of another', () => {
    const file = mergedFile(turn('t1', { oldText: 'x1', newText: 'y1' }), turn('t2', { oldText: 'x2', newText: 'y2' }));
    expect(file.oldText).toContain('x2');
    expect(file.newText).toContain('y1');
  });

  it('keeps a placeholder when nothing better exists', () => {
    expect(mergedFile(turn('t1', { unifiedDiff: PLACEHOLDER })).unifiedDiff).toBe(PLACEHOLDER);
  });
});
