import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PiChatChangesFile } from '@happier-dev/protocol';
import { renderScreen } from '@/dev/testkit';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';

// The session RPC transport is the boundary; the ops module and the section run for real.
const sessionRpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: (params: unknown) => sessionRpcMock(params),
}));

import { PiChatChangesSection } from './PiChatChangesSection';

function file(overrides: Partial<PiChatChangesFile> = {}): PiChatChangesFile {
    return { path: '/tmp/x.txt', created: false, tooLarge: false, deleted: false, added: 1, removed: 1, updatedAt: 1, ...overrides };
}

const rowTestId = (path: string) => `scm-change-row-${toTestIdSafeValue(path)}`;

async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PiChatChangesSection', () => {
    afterEach(() => sessionRpcMock.mockReset());

    it('shows nothing when the chat changed no files outside git', async () => {
        const screen = await renderScreen(<PiChatChangesSection sessionId="s1" files={[]} />);
        expect(screen.findByTestId('pi-chat-changes-section')).toBeNull();
    });

    it('lists each file and shows the before and after text on tap', async () => {
        sessionRpcMock.mockResolvedValue({ ok: true, path: '/tmp/x.txt', before: 'a\n', after: 'b\n', created: false, tooLarge: false, binary: false });
        const screen = await renderScreen(<PiChatChangesSection sessionId="s1" files={[file(), file({ path: '/tmp/new.txt', created: true })]} />);
        expect(screen.findByTestId(rowTestId('/tmp/x.txt'))).not.toBeNull();
        expect(screen.findByTestId(rowTestId('/tmp/new.txt'))).not.toBeNull();

        await screen.pressByTestIdAsync(rowTestId('/tmp/x.txt'));
        await flush();
        expect(screen.findAllByProps({ testID: 'pi-chat-change-diff:/tmp/x.txt', oldText: 'a\n', newText: 'b\n' }).length).toBeGreaterThan(0);
    });

    it('shows a short note instead of a diff for a file that is too large', async () => {
        sessionRpcMock.mockResolvedValue({ ok: true, path: '/tmp/x.txt', before: null, after: null, created: false, tooLarge: true, binary: false });
        const screen = await renderScreen(<PiChatChangesSection sessionId="s1" files={[file({ tooLarge: true })]} />);
        await screen.pressByTestIdAsync(rowTestId('/tmp/x.txt'));
        await flush();
        expect(screen.findAllByProps({ testID: 'pi-chat-change-diff:/tmp/x.txt' })).toHaveLength(0);
        expect(screen.findByTestId('pi-chat-change-note:/tmp/x.txt')).not.toBeNull();
    });
});
