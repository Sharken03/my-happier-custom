import * as React from 'react';

import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { useSessionMessages } from '@/sync/store/hooks';
import { findToolCallsGroup } from './findToolCallsGroup';

/**
 * The calls of the group that starts at `anchorId`, re-resolved on every transcript change so calls
 * that arrive while the sheet is open show up. Only the sheet route mounts this hook.
 */
export function useToolCallsGroup(sessionId: string, anchorId: string): Readonly<{
    isLoaded: boolean;
    calls: ToolCallMessage[] | null;
    /** The group's last call is the last message of the transcript. */
    isTranscriptTail: boolean;
}> {
    const { messages, isLoaded } = useSessionMessages(sessionId);

    return React.useMemo(() => {
        const calls = findToolCallsGroup({ messagesOldestFirst: messages, anchorId });
        const last = calls?.[calls.length - 1];
        return {
            isLoaded,
            calls,
            isTranscriptTail: last != null && messages[messages.length - 1]?.id === last.id,
        };
    }, [anchorId, isLoaded, messages]);
}
