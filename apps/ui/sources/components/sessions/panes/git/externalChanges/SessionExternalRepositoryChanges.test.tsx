import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const messagesState = vi.hoisted(() => ({ value: [] as unknown[] }));
const statusMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/domains/state/storage', () => ({
    useSessionMessages: () => ({ messages: messagesState.value, isLoaded: true }),
}));
vi.mock('@/sync/ops', () => ({
    sessionScmStatusSnapshot: statusMock,
    sessionScmDiffFile: vi.fn(async () => ({ success: true, diff: '' })),
}));

import { SessionExternalRepositoryChanges } from './SessionExternalRepositoryChanges';

function editCall(filePath: string) {
    return {
        kind: 'tool-call',
        id: filePath,
        localId: null,
        createdAt: 1,
        tool: { name: 'Edit', state: 'completed', input: { file_path: filePath }, createdAt: 1, startedAt: 1, completedAt: 2, description: null },
        children: [],
    };
}

const ownSnapshot = {
    projectKey: 'm:/home/u/chat',
    fetchedAt: 1,
    repo: { isRepo: true, rootPath: '/home/u/chat' },
    entries: [],
} as any;

async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('SessionExternalRepositoryChanges', () => {
    afterEach(() => {
        messagesState.value = [];
        statusMock.mockReset();
    });

    it('lists edits in other repos from tool calls and Pi paths without a session change set', async () => {
        messagesState.value = [editCall('/home/u/tools/ops/turns'), editCall('/home/u/chat/own.txt')];
        statusMock.mockImplementation(async (_sessionId: string, request: { cwd: string }) => ({
            success: true,
            snapshot: { repo: { isRepo: true, rootPath: '/home/u/tools' }, entries: [{ path: 'ops/turns' }, { path: 'ops/sub.md' }] },
            cwd: request.cwd,
        }));

        const screen = await renderScreen(
            <SessionExternalRepositoryChanges
                sessionId="s1"
                sessionChangeSet={null}
                scmSnapshot={ownSnapshot}
                extraPaths={['/home/u/tools/ops/sub.md']}
            />,
        );
        await flush();

        expect(screen.findByTestId('session-external-change:/home/u/tools/ops/turns')).not.toBeNull();
        expect(screen.findByTestId('session-external-change:/home/u/tools/ops/sub.md')).not.toBeNull();
        expect(screen.findByTestId('session-external-change:/home/u/chat/own.txt')).toBeNull();
        // Both files are in one folder, so one status call finds the repository.
        expect(statusMock).toHaveBeenCalledTimes(1);
    });

    it('shows nothing when the chat changed no file outside its repository', async () => {
        messagesState.value = [editCall('/home/u/chat/own.txt')];
        const screen = await renderScreen(
            <SessionExternalRepositoryChanges sessionId="s1" sessionChangeSet={null} scmSnapshot={ownSnapshot} />,
        );
        await flush();

        expect(screen.findByTestId('session-external-repository-changes')).toBeNull();
        expect(statusMock).not.toHaveBeenCalled();
    });
});
