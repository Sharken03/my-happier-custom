import { describe, expect, it } from 'vitest';

import type { NormalizedMessage } from '../typesRaw';
import { createReducer, reducer } from './reducer';

/**
 * An async `pi-subagents` run answers its `subagent` call at once ("Detached", `details.asyncId`,
 * no results). The CLI sends the call's real result when the run ends. That result replaces the
 * launch answer, as for Claude's async agents.
 */
const CALL_ID = 'call-58a97946';

function subagentCall(): NormalizedMessage {
    return {
        id: 'msg-subagent-call',
        localId: null,
        createdAt: 1_000,
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-call',
            id: CALL_ID,
            name: 'subagent',
            input: { agent: 'scout', task: 'Fix the parser', async: true },
            description: null,
            uuid: 'uuid-subagent-call',
            parentUUID: null,
        }],
    };
}

function result(id: string, createdAt: number, content: unknown): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'tool-result', tool_use_id: CALL_ID, content, is_error: false, uuid: `uuid-${id}`, parentUUID: null }],
    };
}

const LAUNCH = { content: 'Async: scout [run-1]\n\nDetached.', details: { mode: 'single', results: [], asyncId: 'run-1' } };
const FINAL = {
    content: 'Fixed the parser',
    details: { runId: 'run-1', state: 'complete', results: [{ sessionFile: '/s.jsonl' }], happierDiffStats: { added: 2, removed: 1 } },
};

function readTool(state: ReturnType<typeof createReducer>) {
    const messageId = state.toolIdToMessageId.get(CALL_ID);
    return messageId ? state.messages.get(messageId)?.tool ?? null : null;
}

describe('transcript reducer — async pi-subagents launch', () => {
    it('lets the run\'s final result replace the launch answer once', () => {
        const state = createReducer();
        reducer(state, [subagentCall()]);
        reducer(state, [result('msg-launch', 1_003, LAUNCH)]);
        expect(readTool(state)?.result).toEqual(LAUNCH);

        reducer(state, [result('msg-final', 60_000, FINAL)]);
        expect(readTool(state)?.result).toEqual(FINAL);
        expect(readTool(state)?.completedAt).toBe(60_000);

        // The final result is not a launch answer, so a later result cannot replace it.
        reducer(state, [result('msg-late', 90_000, { content: 'other', details: {} })]);
        expect(readTool(state)?.result).toEqual(FINAL);
    });
});
