import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readTextBeforeWrite, toCanonicalPiFileToolCall } from './piTurnChangeTracker';

const CWD = '/work/chat';

describe('toCanonicalPiFileToolCall', () => {
    it('makes a write an Edit from the text before the call to the content', () => {
        const call = toCanonicalPiFileToolCall({
            toolName: 'write',
            args: { path: 'notes.md', content: 'new' },
            cwd: CWD,
            readTextBeforeWrite: () => 'old',
        });
        expect(call).toEqual({ toolName: 'Edit', args: { file_path: '/work/chat/notes.md', old_string: 'old', new_string: 'new' } });
    });

    it('shows the whole content as added when the file already holds the content', () => {
        const call = toCanonicalPiFileToolCall({
            toolName: 'write',
            args: { path: '/abs/notes.md', content: 'same' },
            cwd: CWD,
            readTextBeforeWrite: () => 'same',
        });
        expect(call).toEqual({ toolName: 'Edit', args: { file_path: '/abs/notes.md', old_string: '', new_string: 'same' } });
    });

    it('keeps the Write placeholder when the old text is not available', () => {
        const call = toCanonicalPiFileToolCall({
            toolName: 'write',
            args: { path: 'big.bin', content: 'x' },
            cwd: CWD,
            readTextBeforeWrite: () => null,
        });
        expect(call).toEqual({ toolName: 'Write', args: { file_path: '/work/chat/big.bin' } });
    });

    it('keeps the Write placeholder when the call has no content', () => {
        expect(toCanonicalPiFileToolCall({ toolName: 'write', args: { path: 'a.md' }, cwd: CWD, readTextBeforeWrite: () => '' }))
            .toEqual({ toolName: 'Write', args: { file_path: '/work/chat/a.md' } });
    });
});

describe('readTextBeforeWrite', () => {
    it('reads an existing file and gives "" for a new one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pi-write-'));
        const file = join(dir, 'a.md');
        expect(readTextBeforeWrite(file)).toBe('');
        writeFileSync(file, 'hello');
        expect(readTextBeforeWrite(file)).toBe('hello');
    });
});
