import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from '../typesRaw';
import { createReducer, reducer } from './reducer';

/**
 * The CLI sends a tool's stream chunks and its final result with the same local id, so the server
 * keeps one row: first it holds a chunk, then the final result ("message-updated"). The app sees
 * both versions under one message id. The final version must complete the tool.
 */
const CALL_ID = 'call-bc6fa26c';

function subagentCall(): NormalizedMessage {
    return {
        id: 'msg-call',
        localId: null,
        createdAt: 1_000,
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-call',
            id: CALL_ID,
            name: 'subagent',
            input: { agent: 'worker', task: 'Create a.txt' },
            description: null,
            uuid: 'uuid-call',
            parentUUID: null,
        }],
    };
}

function resultRow(createdAt: number, content: unknown): NormalizedMessage {
    return {
        id: 'msg-result-row',
        localId: 'acp_tr_v1_result',
        createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'tool-result', tool_use_id: CALL_ID, content, is_error: false, uuid: 'uuid-result', parentUUID: null }],
    };
}

function readTool(state: ReturnType<typeof createReducer>) {
    const messageId = state.toolIdToMessageId.get(CALL_ID);
    return messageId ? state.messages.get(messageId)?.tool ?? null : null;
}

describe('transcript reducer — tool result row revisions', () => {
    it('completes the tool when the row changes from a stream chunk to the final result', () => {
        const state = createReducer();
        reducer(state, [subagentCall()]);
        reducer(state, [resultRow(2_000, { _stream: true, stdoutChunk: 'working' })]);
        expect(readTool(state)?.state).toBe('running');

        const final = { content: 'Created a.txt', details: { runId: 'run-1', results: [{}] } };
        reducer(state, [resultRow(2_000, final)]);
        expect(readTool(state)?.state).toBe('completed');
        expect(readTool(state)?.result).toMatchObject(final);
    });

    it('does not apply the same final result twice', () => {
        const state = createReducer();
        reducer(state, [subagentCall()]);
        const final = { content: 'Created a.txt', details: {} };
        reducer(state, [resultRow(2_000, final)]);
        const completedAt = readTool(state)?.completedAt;
        expect(reducer(state, [resultRow(2_000, final)]).messages).toHaveLength(0);
        expect(readTool(state)?.completedAt).toBe(completedAt);
    });
});
