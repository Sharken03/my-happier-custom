/**
 * List/detail state of the Tool calls sheet. `selectedId` is the call shown in detail mode, or
 * null while the list shows.
 */
export type ToolCallsSheetState = Readonly<{ selectedId: string | null }>;

/** A group with exactly one call opens straight in detail mode. */
export function createToolCallsSheetState(callIds: readonly string[]): ToolCallsSheetState {
    return { selectedId: callIds.length === 1 ? callIds[0] : null };
}

export function selectToolCall(_state: ToolCallsSheetState, callId: string): ToolCallsSheetState {
    return { selectedId: callId };
}

export type ToolCallsSheetBackResult =
    | Readonly<{ kind: 'close' }>
    | Readonly<{ kind: 'show_list'; state: ToolCallsSheetState }>;

/**
 * Back from the list closes the sheet. Back from a detail goes to the list, except when the group
 * still has one call: then the list would show a single row, so back closes the sheet.
 */
export function resolveToolCallsSheetBack(state: ToolCallsSheetState, callCount: number): ToolCallsSheetBackResult {
    if (state.selectedId === null || callCount <= 1) return { kind: 'close' };
    return { kind: 'show_list', state: { selectedId: null } };
}
