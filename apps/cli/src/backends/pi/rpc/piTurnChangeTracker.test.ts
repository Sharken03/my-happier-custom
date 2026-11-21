import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PiTurnChangeTracker, readPiEditPatch, readTextBeforeWrite, toCanonicalPiFileToolCall } from './piTurnChangeTracker';

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

describe('PiTurnChangeTracker with the edit result', () => {
    const patch = '--- /work/chat/a.md\n+++ /work/chat/a.md\n@@ -1,2 +1,2 @@\n line\n-old\n+new';

    it('reads the patch from the edit result details', () => {
        expect(readPiEditPatch({ content: [], details: { diff: 'x', patch } })).toBe(patch);
        expect(readPiEditPatch({ content: [] })).toBeNull();
        expect(readPiEditPatch(null)).toBeNull();
    });

    it("gives the turn Pi's own diff for an edit and for an edit of several snippets", () => {
        const tracker = new PiTurnChangeTracker();
        tracker.beginTurn();
        tracker.observePiToolCall({ callId: 'c1', toolName: 'edit', args: { path: 'a.md', edits: [{ oldText: 'old', newText: 'new' }] }, cwd: CWD });
        tracker.observeToolResult({ callId: 'c1', isError: false, result: { unifiedDiff: patch } });
        tracker.observePiToolCall({ callId: 'c2', toolName: 'edit', args: { path: 'b.md', edits: [{ oldText: 'p', newText: 'q' }, { oldText: 'r', newText: 's' }] }, cwd: CWD });
        tracker.observeToolResult({ callId: 'c2', isError: false, result: { unifiedDiff: patch.replaceAll('a.md', 'b.md') } });
        const turn = tracker.completeTurn({ sessionId: 's1', status: 'completed' });
        expect(turn?.files.map((file) => [file.filePath, file.unifiedDiff])).toEqual([
            ['/work/chat/a.md', patch],
            ['/work/chat/b.md', patch.replaceAll('a.md', 'b.md')],
        ]);
    });
});
