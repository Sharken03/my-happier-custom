import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

import { resolveSessionPreloadTargets } from './resolveTopSessionPreloadTarget';

function sessionRow(id: string, serverId?: string, metadata: unknown = { path: '/tmp' }): SessionListViewItem {
    return {
        type: 'session',
        session: { id, metadata } as never,
        serverId,
    } as SessionListViewItem;
}

function headerRow(): SessionListViewItem {
    return { type: 'header', title: 'SESSIONS', headerKind: 'sessions' } as SessionListViewItem;
}

function folderRow(): SessionListViewItem {
    return { type: 'header', title: 'Work', headerKind: 'folder' } as SessionListViewItem;
}

describe('resolveSessionPreloadTargets', () => {
    it('takes the top chat rows in drawn order, skipping headers and folders', () => {
        expect(resolveSessionPreloadTargets([headerRow(), folderRow(), sessionRow('s1'), sessionRow('s2')], 5))
            .toEqual([
                { sessionId: 's1', serverId: null },
                { sessionId: 's2', serverId: null },
            ]);
    });

    it('stops at the limit, so the app never asks for more hidden chats than it can pay for', () => {
        const rows = [sessionRow('s1'), sessionRow('s2'), sessionRow('s3'), sessionRow('s4')];
        expect(resolveSessionPreloadTargets(rows, 2).map((target) => target.sessionId)).toEqual(['s1', 's2']);
        expect(resolveSessionPreloadTargets(rows, 0)).toEqual([]);
    });

    it('keeps the row server id', () => {
        expect(resolveSessionPreloadTargets([sessionRow('s1', 'srv')], 5)).toEqual([{ sessionId: 's1', serverId: 'srv' }]);
    });

    it('keeps the same session id of two servers as two targets', () => {
        expect(resolveSessionPreloadTargets([sessionRow('s1', 'a'), sessionRow('s1', 'b')], 5))
            .toEqual([
                { sessionId: 's1', serverId: 'a' },
                { sessionId: 's1', serverId: 'b' },
            ]);
    });

    it('keeps a chat drawn twice once: the stack would replace its preload rather than add one', () => {
        expect(resolveSessionPreloadTargets([sessionRow('s1', 'srv'), headerRow(), sessionRow('s1', 'srv')], 5))
            .toEqual([{ sessionId: 's1', serverId: 'srv' }]);
    });

    it('skips a hidden system session, which draws no row the reader can tap', () => {
        const hidden = sessionRow('sys', undefined, { hiddenSystemSession: true });
        expect(resolveSessionPreloadTargets([hidden, sessionRow('s1')], 5).map((target) => target.sessionId))
            .toEqual(['s1']);
    });

    it('skips the raw system-session flag shape and a row with no metadata at all', () => {
        const hidden = sessionRow('sys', undefined, { systemSessionV1: { hidden: true } });
        const unavailable = ({
            type: 'session',
            session: { id: 'gone', metadataUnavailable: true },
        } as unknown) as SessionListViewItem;
        expect(resolveSessionPreloadTargets([hidden, unavailable, sessionRow('s1')], 5).map((target) => target.sessionId))
            .toEqual(['s1']);
    });

    it('skips a blank session id', () => {
        expect(resolveSessionPreloadTargets([sessionRow('  '), sessionRow('s1')], 5).map((target) => target.sessionId))
            .toEqual(['s1']);
    });

    it('answers no targets for an empty, missing or header-only list', () => {
        expect(resolveSessionPreloadTargets(null, 5)).toEqual([]);
        expect(resolveSessionPreloadTargets(undefined, 5)).toEqual([]);
        expect(resolveSessionPreloadTargets([], 5)).toEqual([]);
        expect(resolveSessionPreloadTargets([headerRow()], 5)).toEqual([]);
    });
});
