import { describe, expect, it } from 'vitest';

import { countReplacementLines, countToolCallDiffLines, readHappierDiffStats } from './diffLineStats.js';

describe('countToolCallDiffLines', () => {
  it('counts a Pi edit with a list of edits', () => {
    expect(
      countToolCallDiffLines('edit', {
        path: '/a.ts',
        edits: [
          { oldText: 'a\nb\nc\n', newText: 'a\nB\nc\n' },
          { oldText: '', newText: 'x\ny\n' },
        ],
      }),
    ).toEqual({ added: 3, removed: 1 });
  });

  it('counts a Claude edit and a write', () => {
    expect(countToolCallDiffLines('Edit', { old_string: 'one\ntwo', new_string: 'one\nthree\nfour' })).toEqual({ added: 2, removed: 1 });
    expect(countToolCallDiffLines('write', { content: 'a\nb\n' })).toEqual({ added: 2, removed: 0 });
  });

  it('counts patch text without file headers and other tools as zero', () => {
    expect(countToolCallDiffLines('apply_patch', { patch: '--- a/x\n+++ b/x\n@@\n-old\n+new\n+more\n' })).toEqual({ added: 2, removed: 1 });
    expect(countToolCallDiffLines('read', { path: '/a.ts' })).toEqual({ added: 0, removed: 0 });
  });

  it('ignores lines common to both texts', () => {
    expect(countReplacementLines('a\nb\n', 'b\na\n')).toEqual({ added: 0, removed: 0 });
  });
});

describe('readHappierDiffStats', () => {
  it('reads a valid count and rejects an invalid one', () => {
    expect(readHappierDiffStats({ happierDiffStats: { added: 4, removed: 1 } })).toEqual({ added: 4, removed: 1 });
    expect(readHappierDiffStats({ happierDiffStats: { added: -1, removed: 1 } })).toBeNull();
    expect(readHappierDiffStats({})).toBeNull();
  });
});
