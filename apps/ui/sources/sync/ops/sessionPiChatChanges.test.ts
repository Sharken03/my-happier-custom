import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

const sessionRpcMock = vi.hoisted(() => vi.fn());

vi.mock('../runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: (params: unknown) => sessionRpcMock(params),
}));

import { sessionPiChatChangesDiff, sessionPiChatChangesList } from './sessionPiChatChanges';

const listedFile = { path: '/tmp/a.txt', created: false, tooLarge: false, deleted: false, added: 1, removed: 0, updatedAt: 5 };

describe('sessionPiChatChanges', () => {
    afterEach(() => sessionRpcMock.mockReset());

    it('lists the files through the session RPC', async () => {
        sessionRpcMock.mockResolvedValue({ ok: true, files: [listedFile] });
        await expect(sessionPiChatChangesList('s1')).resolves.toEqual([listedFile]);
        expect(sessionRpcMock).toHaveBeenCalledWith({
            sessionId: 's1',
            method: SESSION_RPC_METHODS.PI_CHAT_CHANGES_LIST,
            payload: {},
        });
    });

    it('returns null when the list call fails or the session has no handler', async () => {
        sessionRpcMock.mockRejectedValue(new Error('method not found'));
        await expect(sessionPiChatChangesList('s1')).resolves.toBeNull();
        sessionRpcMock.mockResolvedValue({ ok: false, error: 'not a Pi session' });
        await expect(sessionPiChatChangesList('s1')).resolves.toBeNull();
    });

    it('reads the before and after text of one file', async () => {
        const diff = { ok: true, path: '/tmp/a.txt', before: 'a\n', after: 'b\n', created: false, tooLarge: false, binary: false };
        sessionRpcMock.mockResolvedValue(diff);
        await expect(sessionPiChatChangesDiff('s1', '/tmp/a.txt')).resolves.toEqual(diff);
        expect(sessionRpcMock).toHaveBeenCalledWith({
            sessionId: 's1',
            method: SESSION_RPC_METHODS.PI_CHAT_CHANGES_DIFF,
            payload: { path: '/tmp/a.txt' },
        });
    });

    it('returns null when the diff call fails', async () => {
        sessionRpcMock.mockRejectedValue(new Error('offline'));
        await expect(sessionPiChatChangesDiff('s1', '/tmp/a.txt')).resolves.toBeNull();
    });
});
