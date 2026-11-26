import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A tool-calls group inside a child's transcript opens inline, whatever the account setting says.
 *
 * The Tool calls sheet resolves a group from the session's MAIN transcript (`useToolCallsGroup` →
 * `findToolCallsGroup`). A sidechain call is not in that transcript, so the sheet found no group,
 * closed itself, and the tap on "Ran 5 commands, read 1 file" looked like it did nothing. The
 * sidechain list therefore pins the open mode to 'inline'; this test is the wiring that carries it.
 */

const chainTranscriptListProps = vi.hoisted(() => ({
    latest: null as any,
}));

vi.mock('@/components/sessions/transcript/ChainTranscriptList', () => ({
    ChainTranscriptList: (props: Record<string, unknown>) => {
        chainTranscriptListProps.latest = props;
        return React.createElement('ChainTranscriptList', props);
    },
}));

vi.mock('@/hooks/session/useEnsureSidechainsLoaded', () => ({
    useEnsureSidechainsLoaded: () => ({
        status: 'loaded',
        entries: [],
        bySidechainId: {},
        pendingCount: 0,
        loadedCount: 1,
    }),
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        loadOlderSidechainMessages: vi.fn(async () => ({ loaded: 0, hasMore: false, status: 'no_more' })),
    },
}));

describe('SidechainTranscriptBody group open mode', () => {
    it('pins the sidechain list to inline group expansion', async () => {
        const { SidechainTranscriptBody } = await import('./SidechainTranscriptBody');
        chainTranscriptListProps.latest = null;

        await renderScreen(
            <SidechainTranscriptBody
                sessionId="session-1"
                sidechainId="tool-call-1"
                messages={[]}
                metadata={null}
                interaction={{ canSendMessages: false, canApprovePermissions: false }}
                hydrationStatusTestID="sidechain-hydration"
            />,
        );

        expect(chainTranscriptListProps.latest?.toolCallsGroupOpenMode).toBe('inline');
    });
});
