import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

import { resolveSessionPreloadTargets } from './resolveTopSessionPreloadTarget';

function resolveTopSessionPreloadTarget(rows: readonly SessionListViewItem[] | null | undefined) {
    return resolveSessionPreloadTargets(rows, 1)[0] ?? null;
}

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

describe('resolveTopSessionPreloadTarget', () => {
    it('takes the first chat row, skipping headers', () => {
        expect(resolveTopSessionPreloadTarget([headerRow(), sessionRow('s1'), sessionRow('s2')]))
            .toEqual({ sessionId: 's1', serverId: null });
    });

    it('keeps the row server id', () => {
        expect(resolveTopSessionPreloadTarget([sessionRow('s1', 'srv')])).toEqual({ sessionId: 's1', serverId: 'srv' });
    });

    it('skips a hidden system session, which draws no row the reader can tap', () => {
        const hidden = sessionRow('sys', undefined, { hiddenSystemSession: true });
        expect(resolveTopSessionPreloadTarget([hidden, sessionRow('s1')])?.sessionId).toBe('s1');
    });

    it('skips the raw system-session flag shape and a row with no metadata at all', () => {
        const hidden = sessionRow('sys', undefined, { systemSessionV1: { hidden: true } });
        const unavailable = ({
            type: 'session',
            session: { id: 'gone', metadataUnavailable: true },
        } as unknown) as SessionListViewItem;
        expect(resolveTopSessionPreloadTarget([hidden, unavailable, sessionRow('s1')])?.sessionId).toBe('s1');
    });

    it('skips a blank session id', () => {
        expect(resolveTopSessionPreloadTarget([sessionRow('  '), sessionRow('s1')])?.sessionId).toBe('s1');
    });

    it('answers null for an empty, missing or header-only list', () => {
        expect(resolveTopSessionPreloadTarget(null)).toBeNull();
        expect(resolveTopSessionPreloadTarget(undefined)).toBeNull();
        expect(resolveTopSessionPreloadTarget([])).toBeNull();
        expect(resolveTopSessionPreloadTarget([headerRow()])).toBeNull();
    });
});

describe('resolveSessionPreloadTargets', () => {
    it('takes the first chat rows in list order, up to the limit, with the same skips as the top row', () => {
        const hidden = sessionRow('sys', undefined, { hiddenSystemSession: true });
        const rows = [headerRow(), sessionRow('s1'), hidden, sessionRow('s2', 'srv'), sessionRow('s3'), sessionRow('s4')];
        expect(resolveSessionPreloadTargets(rows, 3)).toEqual([
            { sessionId: 's1', serverId: null },
            { sessionId: 's2', serverId: 'srv' },
            { sessionId: 's3', serverId: null },
        ]);
        expect(resolveSessionPreloadTargets(null, 3)).toEqual([]);
    });
});
