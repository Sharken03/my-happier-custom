import * as React from 'react';

import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { useSetting } from '@/sync/domains/state/storage';
import { useSessionMessages } from '@/sync/store/hooks';
import { findToolCallsGroup } from './findToolCallsGroup';

/**
 * The calls of the group that starts at `anchorId`, re-resolved on every transcript change so calls
 * that arrive while the sheet is open show up. Reads the same grouping settings as the transcript
 * (`useChatListRootState`). Only the sheet route mounts this hook.
 */
export function useToolCallsGroup(sessionId: string, anchorId: string): Readonly<{
    isLoaded: boolean;
    calls: ToolCallMessage[] | null;
    /** The group's last call is the last message of the transcript. */
    isTranscriptTail: boolean;
}> {
    const groupingSetting = useSetting('transcriptGroupingMode');
    const strategySetting = useSetting('transcriptTurnToolCallsGroupStrategy');
    const groupingMode = groupingSetting === 'turns' ? 'turns' : 'linear';
    const toolCallsGroupStrategy = strategySetting === 'all_tools_in_turn' ? 'all_tools_in_turn' : 'consecutive_tools';
    const { messages, isLoaded } = useSessionMessages(sessionId);

    return React.useMemo(() => {
        const calls = findToolCallsGroup({ messagesOldestFirst: messages, anchorId, groupingMode, toolCallsGroupStrategy });
        const last = calls?.[calls.length - 1];
        return {
            isLoaded,
            calls,
            isTranscriptTail: last != null && messages[messages.length - 1]?.id === last.id,
        };
    }, [anchorId, groupingMode, isLoaded, messages, toolCallsGroupStrategy]);
}
