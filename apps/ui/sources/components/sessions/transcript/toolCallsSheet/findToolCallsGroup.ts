import type { Message, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { buildChatListItems } from '@/components/sessions/chatListItems';
import {
    buildTranscriptTurns,
    type TranscriptTurnToolCallsGroupStrategy,
} from '@/components/sessions/transcript/turnGrouping/buildTranscriptTurns';

/**
 * Finds the tool-call group whose first call is `anchorId`, with the same grouping the transcript
 * uses: `buildTranscriptTurns` in 'turns' mode, `buildChatListItems` in 'linear' mode. Returns the
 * group's calls in order, or null when no such group exists (yet).
 */
export function findToolCallsGroup(params: Readonly<{
    messagesOldestFirst: readonly Message[];
    anchorId: string;
    groupingMode: 'linear' | 'turns';
    toolCallsGroupStrategy: TranscriptTurnToolCallsGroupStrategy;
}>): ToolCallMessage[] | null {
    const messagesById: Record<string, Message> = {};
    for (const message of params.messagesOldestFirst) messagesById[message.id] = message;
    const messageIdsOldestFirst = params.messagesOldestFirst.map((message) => message.id);

    const toolMessageIds = params.groupingMode === 'turns'
        ? findInTurns(messageIdsOldestFirst, messagesById, params.anchorId, params.toolCallsGroupStrategy)
        : findInLinearItems(messageIdsOldestFirst, messagesById, params.anchorId);
    if (!toolMessageIds) return null;

    const calls: ToolCallMessage[] = [];
    for (const id of toolMessageIds) {
        const message = messagesById[id];
        if (message?.kind === 'tool-call') calls.push(message);
    }
    return calls.length > 0 ? calls : null;
}

function findInTurns(
    messageIdsOldestFirst: string[],
    messagesById: Record<string, Message>,
    anchorId: string,
    toolCallsGroupStrategy: TranscriptTurnToolCallsGroupStrategy,
): readonly string[] | null {
    const turns = buildTranscriptTurns({ messageIdsOldestFirst, messagesById, groupToolCalls: true, toolCallsGroupStrategy });
    for (const turn of turns) {
        for (const entry of turn.content) {
            if (entry.kind === 'tool_calls' && entry.toolMessageIds[0] === anchorId) return entry.toolMessageIds;
        }
    }
    return null;
}

function findInLinearItems(
    messageIdsOldestFirst: string[],
    messagesById: Record<string, Message>,
    anchorId: string,
): readonly string[] | null {
    const items = buildChatListItems({ messageIdsOldestFirst, messagesById, pendingMessages: [], groupConsecutiveToolCalls: true });
    for (const item of items) {
        if (item.kind === 'tool-calls-group' && item.toolMessageIds[0] === anchorId) return item.toolMessageIds;
    }
    return null;
}
