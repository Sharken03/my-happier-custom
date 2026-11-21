import { describe, expect, it } from 'vitest';

import type { PiChatChangesFile } from '@happier-dev/protocol';
import type { ScmStatusFiles } from '@/scm/scmStatusFiles';

import {
    addPiChatChangeCounts,
    NO_PI_CHAT_CHANGES,
    readPiChatChangesFiles,
    samePiChatChangesFiles,
    toPiChatChangeRow,
} from './piChatChanges';

function file(overrides: Partial<PiChatChangesFile> = {}): PiChatChangesFile {
    return {
        path: '/data/tmp/notes.txt',
        created: false,
        tooLarge: false,
        deleted: false,
        added: 3,
        removed: 1,
        updatedAt: 1000,
        ...overrides,
    };
}

const statusFiles: ScmStatusFiles = {
    includedFiles: [],
    pendingFiles: [],
    branch: 'main',
    totalIncluded: 1,
    totalPending: 2,
};

describe('readPiChatChangesFiles', () => {
    it('returns the files of a valid list response', () => {
        const files = [file(), file({ path: '/x/new.txt', created: true })];
        expect(readPiChatChangesFiles({ ok: true, files })).toEqual(files);
    });

    it('returns null for an error response or a response that does not match the schema', () => {
        expect(readPiChatChangesFiles({ ok: false, error: 'no store' })).toBeNull();
        expect(readPiChatChangesFiles({ ok: true, files: [{ path: 1 }] })).toBeNull();
        expect(readPiChatChangesFiles(undefined)).toBeNull();
    });

    it('returns the shared empty list when the chat changed nothing', () => {
        expect(readPiChatChangesFiles({ ok: true, files: [] })).toBe(NO_PI_CHAT_CHANGES);
    });
});

describe('toPiChatChangeRow', () => {
    it('makes a modified row with the path, file name and line counts', () => {
        expect(toPiChatChangeRow(file())).toMatchObject({
            fileName: 'notes.txt',
            filePath: '/data/tmp/notes.txt',
            fullPath: '/data/tmp/notes.txt',
            status: 'modified',
            linesAdded: 3,
            linesRemoved: 1,
        });
    });

    it('marks created and deleted files', () => {
        expect(toPiChatChangeRow(file({ created: true })).status).toBe('added');
        expect(toPiChatChangeRow(file({ deleted: true })).status).toBe('deleted');
    });
});

describe('addPiChatChangeCounts', () => {
    it('counts created files as added, modified as pending, excludes deleted from pending', () => {
        const merged = addPiChatChangeCounts(statusFiles, [
            file({ path: '/a', created: true }),
            file({ path: '/b' }),
            file({ path: '/c', deleted: true }),
        ]);
        expect(merged).toMatchObject({ branch: 'main', totalIncluded: 2, totalPending: 3 });
    });

    it('excludes only-deleted files from pending entirely', () => {
        const merged = addPiChatChangeCounts(statusFiles, [
            file({ path: '/a', deleted: true }),
            file({ path: '/b', deleted: true }),
        ]);
        expect(merged).toMatchObject({ branch: 'main', totalIncluded: 1, totalPending: 2 });
    });

    it('keeps the same object when there are no files, and null stays null', () => {
        expect(addPiChatChangeCounts(statusFiles, NO_PI_CHAT_CHANGES)).toBe(statusFiles);
        expect(addPiChatChangeCounts(null, [file()])).toBeNull();
    });
});

describe('samePiChatChangesFiles', () => {
    it('compares the files field by field', () => {
        expect(samePiChatChangesFiles([file()], [file()])).toBe(true);
        expect(samePiChatChangesFiles([file()], [file({ added: 4 })])).toBe(false);
        expect(samePiChatChangesFiles([file()], [file(), file({ path: '/y' })])).toBe(false);
    });
});
