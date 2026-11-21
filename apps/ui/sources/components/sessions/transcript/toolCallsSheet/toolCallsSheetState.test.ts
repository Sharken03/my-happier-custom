import { describe, expect, it } from 'vitest';

import { createToolCallsSheetState, resolveToolCallsSheetBack, selectToolCall } from './toolCallsSheetState';

describe('toolCallsSheetState', () => {
    it('opens in list mode for several calls and in detail mode for one', () => {
        expect(createToolCallsSheetState(['a', 'b']).selectedId).toBeNull();
        expect(createToolCallsSheetState(['a']).selectedId).toBe('a');
    });

    it('closes on back from the list', () => {
        expect(resolveToolCallsSheetBack(createToolCallsSheetState(['a', 'b']), 2)).toEqual({ kind: 'close' });
    });

    it('goes from detail to the list first when the group has several calls', () => {
        const state = selectToolCall(createToolCallsSheetState(['a', 'b']), 'b');
        expect(resolveToolCallsSheetBack(state, 2)).toEqual({ kind: 'show_list', state: { selectedId: null } });
    });

    it('closes on back from a single-call detail', () => {
        expect(resolveToolCallsSheetBack(createToolCallsSheetState(['a']), 1)).toEqual({ kind: 'close' });
    });

    it('goes to the list when calls arrived after a direct open', () => {
        expect(resolveToolCallsSheetBack(createToolCallsSheetState(['a']), 2)).toEqual({
            kind: 'show_list',
            state: { selectedId: null },
        });
    });
});
