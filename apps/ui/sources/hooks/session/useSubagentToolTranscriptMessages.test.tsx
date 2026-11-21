import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import { storage } from '@/sync/domains/state/storageStore';
import * as testkit from '@/dev/testkit';

import { useSubagentToolTranscriptMessages } from './useSubagentToolTranscriptMessages';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

const SESSION_ID = 'session-1';
const TOOL_ID = 'tool_subagent_1';

/**
 * The subagent transcript a running child keeps appending to.
 *
 * `message.children` is the sidechain projection as it stood when the owning tool message was last
 * published: the tool view and the tool-calls sheet used to read it as the transcript, so a child
 * that kept working stopped growing on screen — no new text, nothing to scroll — while the reducer
 * held the rest. The reducer's sidechain is the live owner (the details pane already read it), so
 * these pin that the hosts read it too.
 */

function subagentCall(id: string): NormalizedMessage {
    return {
        id: `message_${id}`,
        localId: null,
        createdAt: 1000,
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-call',
            id,
            name: 'subagent',
            input: { agent: 'reviewer', task: 'Verify the claims' },
            description: null,
            uuid: id,
            parentUUID: null,
        }],
    };
}

function sidechainText(id: string, text: string, createdAt: number): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt,
        role: 'agent',
        isSidechain: true,
        sidechainId: TOOL_ID,
        content: [{ type: 'text', text, uuid: id, parentUUID: null }],
    } as unknown as NormalizedMessage;
}

function seedSession(reducerState: ReturnType<typeof createReducer>, reducerVersion: number): void {
    storage.setState((state) => ({
        ...state,
        sessionMessages: {
            ...state.sessionMessages,
            [SESSION_ID]: {
                ...(state.sessionMessages[SESSION_ID] ?? {}),
                reducerState,
                reducerVersion,
            } as any,
        },
    }));
}

function snapshotMessage(text: string): Message {
    return {
        id: `snapshot_${text}`,
        localId: null,
        createdAt: 900,
        kind: 'agent-text',
        text,
    };
}

const TOOL = {
    id: TOOL_ID,
    name: 'subagent',
    state: 'running',
    input: { agent: 'reviewer' },
    createdAt: 1000,
    startedAt: 1000,
    completedAt: null,
    description: null,
    result: null,
} as unknown as ToolCall;

describe('useSubagentToolTranscriptMessages', () => {
    let previousStorageState: ReturnType<typeof storage.getState>;

    beforeEach(() => {
        previousStorageState = storage.getState();
    });

    afterEach(() => {
        testkit.standardCleanup();
        storage.setState(previousStorageState);
    });

    function renderHost(fallback: readonly Message[]) {
        return testkit.renderHook(() => useSubagentToolTranscriptMessages({
            sessionId: SESSION_ID,
            tool: TOOL,
            fallback,
        }));
    }

    it('reads the live sidechain instead of the snapshot published with the tool message', async () => {
        const reducerState = createReducer();
        reducer(reducerState, [subagentCall(TOOL_ID)]);
        reducer(reducerState, [
            sidechainText('child_1', 'I will verify each claim.', 2000),
            sidechainText('child_2', 'Claim one holds.', 3000),
        ]);
        seedSession(reducerState, 1);

        const host = await renderHost([snapshotMessage('I will verify each claim.')]);
        const messages = host.getCurrent();

        expect(messages.map((message) => message.kind === 'agent-text' ? message.text : null)).toEqual([
            'I will verify each claim.',
            'Claim one holds.',
        ]);
    });

    it('grows when the child keeps writing after the parent message was published', async () => {
        const reducerState = createReducer();
        reducer(reducerState, [subagentCall(TOOL_ID)]);
        reducer(reducerState, [sidechainText('child_1', 'Reading the sources.', 2000)]);
        seedSession(reducerState, 1);

        const host = await renderHost([snapshotMessage('Reading the sources.')]);
        expect(host.getCurrent()).toHaveLength(1);

        reducer(reducerState, [sidechainText('child_2', 'Found a mismatch.', 3000)]);
        await act(async () => {
            storage.setState((state) => ({
                ...state,
                sessionMessages: {
                    ...state.sessionMessages,
                    [SESSION_ID]: { ...state.sessionMessages[SESSION_ID]!, reducerVersion: 2 } as any,
                },
            }));
        });

        expect(host.getCurrent()).toHaveLength(2);
    });

    it('falls back to the snapshot while the sidechain has nothing to show', async () => {
        seedSession(createReducer(), 0);
        const fallback = [snapshotMessage('Only the snapshot is here')];

        const host = await renderHost(fallback);

        expect(host.getCurrent()).toBe(fallback);
    });
});
