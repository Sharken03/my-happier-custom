import * as React from 'react';

import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { useSetting } from '@/sync/domains/state/storage';
import { useSessionMessages } from '@/sync/store/hooks';
import { filterHiddenThinkingMessages } from '@/components/sessions/transcript/thinking/filterHiddenThinkingMessageIds';
import { findToolCallsGroup } from './findToolCallsGroup';

/**
 * The calls of the group that starts at `anchorId`, re-resolved on every transcript change so calls
 * that arrive while the sheet is open show up. Reads the same grouping and thinking settings as the
 * transcript (`useChatListRootState`). Only the sheet route mounts this hook.
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
    const thinkingDisplayMode = useSetting('sessionThinkingDisplayMode');
    const { messages, isLoaded } = useSessionMessages(sessionId);

    return React.useMemo(() => {
        // A thinking message between two calls ends a group of consecutive calls, so the hidden ones go first.
        const visibleMessages = filterHiddenThinkingMessages(messages, thinkingDisplayMode);
        const calls = findToolCallsGroup({ messagesOldestFirst: visibleMessages, anchorId, groupingMode, toolCallsGroupStrategy });
        const last = calls?.[calls.length - 1];
        return {
            isLoaded,
            calls,
            isTranscriptTail: last != null && visibleMessages[visibleMessages.length - 1]?.id === last.id,
        };
    }, [anchorId, groupingMode, isLoaded, messages, thinkingDisplayMode, toolCallsGroupStrategy]);
}
