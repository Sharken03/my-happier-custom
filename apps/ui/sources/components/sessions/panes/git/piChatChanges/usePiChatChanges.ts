import * as React from 'react';
import type { PiChatChangesFile } from '@happier-dev/protocol';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';

import { getStorage } from '@/sync/domains/state/storageStore';
import { sessionPiChatChangesList } from '@/sync/ops/sessionPiChatChanges';

import { NO_PI_CHAT_CHANGES, samePiChatChangesFiles } from './piChatChanges';

/**
 * The files a Pi chat changed outside git, for the open git pane. It asks once when `enabled`
 * becomes true and again each time `refreshKey` changes (the git snapshot's fetch time), so it
 * adds no polling of its own. Only Pi sessions have the RPC; other sessions get no files and no call.
 * A failed call keeps the last list.
 */
export function usePiChatChanges(params: Readonly<{
    sessionId: string;
    enabled: boolean;
    refreshKey: number | null;
}>): readonly PiChatChangesFile[] {
    const { sessionId, enabled, refreshKey } = params;
    const isPi = getStorage()((state) => resolveAgentIdFromSessionMetadata(state.sessions[sessionId]?.metadata ?? null) === 'pi');
    const [state, setState] = React.useState<Readonly<{ sessionId: string; files: readonly PiChatChangesFile[] }>>(
        () => ({ sessionId, files: NO_PI_CHAT_CHANGES }),
    );

    React.useEffect(() => {
        if (!isPi || !enabled) return;
        let cancelled = false;
        void sessionPiChatChangesList(sessionId).then((files) => {
            if (cancelled || !files) return;
            setState((previous) => (
                previous.sessionId === sessionId && samePiChatChangesFiles(previous.files, files)
                    ? previous
                    : { sessionId, files }
            ));
        });
        return () => { cancelled = true; };
    }, [enabled, isPi, refreshKey, sessionId]);

    return isPi && state.sessionId === sessionId ? state.files : NO_PI_CHAT_CHANGES;
}
