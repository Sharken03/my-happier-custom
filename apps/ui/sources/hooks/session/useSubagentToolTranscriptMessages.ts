import * as React from 'react';

import { useSidechainTranscriptMessages } from '@/components/sessions/transcript/sidechain/useSidechainTranscriptMessages';
import { resolveToolTranscriptSidechainId } from '@/components/tools/shell/views/resolveToolTranscriptSidechainId';
import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';

const EMPTY_MESSAGES: readonly Message[] = [];

/**
 * The messages a subagent tool call shows, read from the live sidechain.
 *
 * `message.children` is the sidechain projection as it stood when the owning tool message was last
 * published. That snapshot is enough for a finished child, and it is not enough for one that keeps
 * working: a running subagent, and the older pages the app fetches after the parent was published,
 * append to the reducer's sidechain without republishing the parent message. A surface that reads
 * only the snapshot therefore stops growing, has nothing to scroll, and shows the child's last
 * entry while the rest of its transcript sits in the reducer unread.
 *
 * The reducer's sidechain is the live owner of those records — it is what the details pane already
 * reads through `useSidechainTranscriptMessages` — so the hosts read it here too. The snapshot stays
 * as the fallback for the moment before the sidechain has anything to show, and so that a host's
 * provider-specific filtering still receives the same list it always did.
 */
export function useSubagentToolTranscriptMessages(params: Readonly<{
    sessionId: string;
    tool: ToolCall | null | undefined;
    fallback: readonly Message[] | undefined;
}>): readonly Message[] {
    const { fallback, sessionId, tool } = params;
    const sidechainId = React.useMemo(() => {
        if (!tool) return '';
        return resolveToolTranscriptSidechainId({
            tool,
            normalizedToolName: tool.name,
        }) ?? '';
    }, [tool]);

    const liveMessages = useSidechainTranscriptMessages({ sessionId, sidechainId });
    const fallbackMessages = fallback ?? EMPTY_MESSAGES;
    return liveMessages.length > 0 ? liveMessages : fallbackMessages;
}
