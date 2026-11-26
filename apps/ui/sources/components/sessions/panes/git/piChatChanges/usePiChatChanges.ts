import * as React from 'react';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';

import { getStorage } from '@/sync/domains/state/storageStore';
import { sessionPiChatChangesList } from '@/sync/ops/sessionPiChatChanges';

import { NO_PI_CHAT_CHANGES_LIST, samePiChatChangesList, type PiChatChangesList } from './piChatChanges';

/**
 * The files a Pi chat changed outside git, and the paths it changed in other git repos, for the
 * open git pane.
 * It asks once when `enabled` becomes true, again each time `refreshKey` changes (the git
 * snapshot's fetch time), and keeps re-polling on its own interval so changed files show up
 * even when the repo has no commits or no git changes (then `fetchedAt` never updates and
 * `refreshKey` stays stale). Polling runs whenever this is a Pi session, regardless of
 * `enabled` — `enabled` only gates whether results are returned, not whether they are fetched.
 * Only Pi sessions have the RPC; other sessions get no files and no call.
 * A failed call keeps the last list.
 */
const PI_CHAT_CHANGES_POLL_INTERVAL_MS = 5_000;

export function usePiChatChanges(params: Readonly<{
    sessionId: string;
    enabled: boolean;
    refreshKey: number | null;
}>): PiChatChangesList {
    const { sessionId, enabled, refreshKey } = params;
    const isPi = getStorage()((state) => resolveAgentIdFromSessionMetadata(state.sessions[sessionId]?.metadata ?? null) === 'pi');
    const [state, setState] = React.useState<Readonly<{ sessionId: string; list: PiChatChangesList }>>(
        () => ({ sessionId, list: NO_PI_CHAT_CHANGES_LIST }),
    );

    const fetch = React.useCallback(() => {
        if (!isPi) return;
        void sessionPiChatChangesList(sessionId).then((list) => {
            if (!list) return;
            setState((previous) => (
                previous.sessionId === sessionId && samePiChatChangesList(previous.list, list)
                    ? previous
                    : { sessionId, list }
            ));
        });
    }, [isPi, sessionId]);

    // Fetch on mount and whenever `refreshKey` changes (e.g. a new SCM snapshot).
    React.useEffect(() => {
        fetch();
        // `refreshKey` is intentionally a dependency: a new snapshot should trigger an
        // immediate re-fetch on top of the periodic polling below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetch, refreshKey]);

    // Independent polling: re-fetch on a fixed interval regardless of `enabled` and
    // regardless of `refreshKey`. `enabled` only gates the return value, not the fetch,
    // so changes outside the repo show up even when the SCM snapshot is null or stale.
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelledRef = React.useRef(false);
    React.useEffect(() => {
        if (!isPi) return;
        let running = false;
        const run = async () => {
            if (cancelledRef.current || running) return;
            running = true;
            await fetch();
            running = false;
            if (cancelledRef.current) return;
            timerRef.current = setTimeout(run, PI_CHAT_CHANGES_POLL_INTERVAL_MS);
        };
        timerRef.current = setTimeout(run, PI_CHAT_CHANGES_POLL_INTERVAL_MS);
        return () => {
            cancelledRef.current = true;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isPi, fetch]);

    return isPi && enabled && state.sessionId === sessionId ? state.list : NO_PI_CHAT_CHANGES_LIST;
}
