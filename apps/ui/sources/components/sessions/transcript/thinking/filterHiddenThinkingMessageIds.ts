import type { Message } from '@/sync/domains/messages/messageTypes';

function isHiddenThinkingMessage(message: Message | undefined): boolean {
    return message?.kind === 'agent-text' && message.isThinking === true;
}

/**
 * In the hidden thinking mode a thinking message paints nothing (see MessageView), so it must not
 * become a list row. An empty row still lays out at 1 px, and each new hidden row moves the
 * followed tail by that amount.
 *
 * Returns the input arrays unchanged when nothing is removed, so the item builders keep their caches.
 * A fork boundary on a removed message moves to the next visible message.
 */
export function filterHiddenThinkingMessageIds(params: Readonly<{
    messageIdsOldestFirst: string[];
    messagesById: Readonly<Record<string, Message>>;
    thinkingDisplayMode: unknown;
    forkBoundaryBeforeMessageIds: ReadonlySet<string> | null | undefined;
}>): { messageIdsOldestFirst: string[]; forkBoundaryBeforeMessageIds: ReadonlySet<string> | null | undefined } {
    const unchanged = {
        messageIdsOldestFirst: params.messageIdsOldestFirst,
        forkBoundaryBeforeMessageIds: params.forkBoundaryBeforeMessageIds,
    };
    if (params.thinkingDisplayMode !== 'hidden') return unchanged;
    if (!params.messageIdsOldestFirst.some((id) => isHiddenThinkingMessage(params.messagesById[id]))) return unchanged;

    const boundaries = params.forkBoundaryBeforeMessageIds;
    const visibleIds: string[] = [];
    const visibleBoundaries = boundaries?.size ? new Set<string>() : null;
    let boundaryPending = false;
    for (const id of params.messageIdsOldestFirst) {
        boundaryPending ||= boundaries?.has(id) === true;
        if (isHiddenThinkingMessage(params.messagesById[id])) continue;
        visibleIds.push(id);
        if (boundaryPending) visibleBoundaries?.add(id);
        boundaryPending = false;
    }
    return {
        messageIdsOldestFirst: visibleIds,
        forkBoundaryBeforeMessageIds: visibleBoundaries ?? boundaries,
    };
}

/** The messages the transcript shows, with the same rule as `filterHiddenThinkingMessageIds`. */
export function filterHiddenThinkingMessages(messages: readonly Message[], thinkingDisplayMode: unknown): readonly Message[] {
    if (thinkingDisplayMode !== 'hidden') return messages;
    return messages.filter((message) => !isHiddenThinkingMessage(message));
}
