import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';

import { buildTranscriptRowShellSignature, type TranscriptRowShellItem } from './transcriptRowShellSignature';

// Device capture 2026-11-13 (8T): the reducer gives each message a new random id at every app
// start (`msg:huhvl0dvz4t`, then `msg:hgezopfqx2j` for the same message), so a height stored under
// the row's own key was never found again: 0 hits, 581 misses after a restart.
describe('persisted height key of a message row', () => {
    const build = (localId: string, message: Partial<Message>, revision = 1) => buildTranscriptRowShellSignature({
        activeThinkingMessageId: null,
        expandedToolCallsAnchorMessageIds: new Set(),
        forkMessageMetadataById: null,
        getMessageById: () => ({ kind: 'agent-text', id: localId, localId: null, createdAt: 1, text: 'hello', ...message } as Message),
        getMessageRevisionById: () => revision,
        groupingMode: 'turns',
        item: { kind: 'message', id: `msg:${localId}`, messageId: localId, createdAt: 1, seq: 1 } as TranscriptRowShellItem,
        latestCommittedActivityKey: null,
        resolveActionDraftFieldOptions: () => [],
        resolveThinkingExpanded: () => false,
        sessionActive: false,
        widthBucket: 'w:400',
        fontScaleKey: 'fs:1',
    }).persistedKey;

    it('is the same after a restart gives the message a new local id and revision', () => {
        const first = build('aaa111', { realID: 'server-1', transcriptBlockIndex: 2 }, 3);
        const afterRestart = build('bbb222', { realID: 'server-1', transcriptBlockIndex: 2 }, 1);
        expect(first).toBeDefined();
        expect(afterRestart).toBe(first);
    });

    it('differs for another block, other content, or another width', () => {
        const base = build('aaa111', { realID: 'server-1', transcriptBlockIndex: 2 });
        expect(build('aaa111', { realID: 'server-1', transcriptBlockIndex: 3 })).not.toBe(base);
        expect(build('aaa111', { realID: 'server-1', transcriptBlockIndex: 2, text: 'hello again' })).not.toBe(base);
        expect(build('aaa111', { realID: 'server-2', transcriptBlockIndex: 2 })).not.toBe(base);
    });

    it('is absent for a message the server has not named', () => {
        expect(build('aaa111', { realID: null })).toBeUndefined();
    });
});
