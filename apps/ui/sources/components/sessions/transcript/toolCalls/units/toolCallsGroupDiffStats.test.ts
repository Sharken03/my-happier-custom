import { describe, expect, it } from 'vitest';

import { computeToolCallsGroupDiffStats } from './toolCallsGroupDiffStats';

describe('computeToolCallsGroupDiffStats', () => {
    it('counts an Edit by changed lines, ignoring common lines', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'Edit', input: { old_string: 'a\nb\nc', new_string: 'a\nB\nB2\nc' } },
        ])).toEqual({ added: 2, removed: 1 });
    });

    it('sums the edits of a MultiEdit', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'MultiEdit', input: { file_path: 'x', edits: [
                { old_string: 'a', new_string: 'b' },
                { old_string: 'c\nd', new_string: '' },
            ] } },
        ])).toEqual({ added: 1, removed: 3 });
    });

    it('counts all lines of a Write as added', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'write', input: { file_path: 'x', content: 'one\ntwo\n' } },
        ])).toEqual({ added: 2, removed: 0 });
    });

    it('counts + and - lines of patch text without file headers', () => {
        const patchText = ['*** Begin Patch', '*** Update File: a', '@@', '-old', '+new', '+more', '*** End Patch'].join('\n');
        expect(computeToolCallsGroupDiffStats([{ name: 'apply_patch', input: { patchText } }]))
            .toEqual({ added: 2, removed: 1 });
        expect(computeToolCallsGroupDiffStats([{ name: 'Patch', input: { diff: '--- a\n+++ b\n-x\n+y' } }]))
            .toEqual({ added: 1, removed: 1 });
    });

    it('skips errored calls and other tools', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'Edit', input: { old_string: 'a', new_string: 'b' }, state: 'error' } as any,
            { name: 'Bash', input: { command: '+x' } },
            { name: 'Edit', input: null },
        ])).toEqual({ added: 0, removed: 0 });
    });
});
