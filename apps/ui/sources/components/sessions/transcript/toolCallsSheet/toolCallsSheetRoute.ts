/**
 * The route of the Tool calls sheet: one sheet per group of tool calls. The anchor is the
 * message id of the first tool call in the group; the sheet finds the group again from it.
 */
export function toolCallsSheetHref(sessionId: string, anchorMessageId: string): string {
    return `/session/${encodeURIComponent(sessionId)}/toolCalls/${encodeURIComponent(anchorMessageId)}`;
}
