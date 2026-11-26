import type { Message } from '@/sync/domains/messages/messageTypes';

/**
 * True when the loaded messages hold at least one user prompt.
 */
export function hasLoadedUserMessage(messagesById: Readonly<Record<string, Message | undefined>>): boolean {
    for (const message of Object.values(messagesById)) {
        if (message?.kind === 'user-text') return true;
    }
    return false;
}

/**
 * Native initial fill: count a loaded page as progress although the content height did not grow.
 * A long agent turn collapses its tool events into one row, so older pages do not add height,
 * and the fill stopped before the user's last prompt was loaded. `no_more` and the absolute
 * fill deadline still stop the loop.
 */
export function shouldContinueInitialFillToUserMessage(params: Readonly<{
    enabled: boolean;
    pageAddedMessages: boolean;
    hasUserMessage: boolean;
}>): boolean {
    return params.enabled && params.pageAddedMessages && !params.hasUserMessage;
}

/**
 * Native Legend renderer: true when the rows overflow the viewport.
 * Legend pads short content up to the viewport (`alignItemsAtEnd`), so its `contentLength` is
 * never below `scrollLength`. Only a length above the viewport means the list can scroll.
 * Returns null when Legend has not measured the viewport yet.
 */
export function isLegendContentOverflowing(state: Readonly<{
    contentLength: number;
    scrollLength: number;
}> | null | undefined): boolean | null {
    if (!state) return null;
    const { contentLength, scrollLength } = state;
    if (!Number.isFinite(contentLength) || !Number.isFinite(scrollLength)) return null;
    if (contentLength <= 0 || scrollLength <= 0) return null;
    return contentLength > scrollLength + 1;
}
