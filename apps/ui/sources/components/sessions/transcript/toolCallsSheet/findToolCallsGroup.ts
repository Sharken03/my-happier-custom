import type { Message, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { buildChatListItems } from '@/components/sessions/chatListItems';

/**
 * Finds the tool-call group whose first call is `anchorId`, with the same grouping the transcript
 * list uses (`buildChatListItems`). Returns the group's calls in order, or null when no such
 * group exists (yet).
 */
export function findToolCallsGroup(params: Readonly<{
    messagesOldestFirst: readonly Message[];
    anchorId: string;
}>): ToolCallMessage[] | null {
    const messagesById: Record<string, Message> = {};
    for (const message of params.messagesOldestFirst) messagesById[message.id] = message;

    const items = buildChatListItems({
        messageIdsOldestFirst: params.messagesOldestFirst.map((message) => message.id),
        messagesById,
        pendingMessages: [],
        groupConsecutiveToolCalls: true,
    });

    for (const item of items) {
        if (item.kind !== 'tool-calls-group' || item.toolMessageIds[0] !== params.anchorId) continue;
        const calls: ToolCallMessage[] = [];
        for (const id of item.toolMessageIds) {
            const message = messagesById[id];
            if (message?.kind === 'tool-call') calls.push(message);
        }
        return calls.length > 0 ? calls : null;
    }
    return null;
}
