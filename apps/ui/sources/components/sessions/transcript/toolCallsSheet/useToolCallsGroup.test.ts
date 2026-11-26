import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import type { Message } from '@/sync/domains/messages/messageTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    messages: [] as unknown[],
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useSetting: (key: string) => state.settings[key],
}));
vi.mock('@/sync/store/hooks', () => ({
    useSessionMessages: () => ({ messages: state.messages, isLoaded: true }),
}));

function user(id: string, createdAt: number): Message {
    return { kind: 'user-text', id, localId: null, createdAt, text: id } as Message;
}

function tool(id: string, createdAt: number): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        tool: { name: 'Bash', state: 'completed', input: {}, createdAt, startedAt: createdAt, completedAt: createdAt, description: null, result: 'ok' },
        children: [],
    } as unknown as Message;
}

function agentText(id: string, createdAt: number, isThinking: boolean): Message {
    return { kind: 'agent-text', id, localId: null, createdAt, text: id, isThinking } as Message;
}

async function renderGroup(anchorId: string) {
    const { useToolCallsGroup } = await import('./useToolCallsGroup');
    const hook = await renderHook(() => useToolCallsGroup('s1', anchorId));
    const group = hook.getCurrent();
    return { ids: group.calls?.map((call) => call.id) ?? null, isTranscriptTail: group.isTranscriptTail };
}

describe('useToolCallsGroup', () => {
    beforeEach(() => {
        state.settings = {
            transcriptGroupingMode: 'turns',
            transcriptTurnToolCallsGroupStrategy: 'consecutive_tools',
            sessionThinkingDisplayMode: 'hidden',
        };
        state.messages = [
            user('u1', 1),
            agentText('k1', 2, true),
            tool('t1', 3),
            agentText('k2', 4, true),
            tool('t2', 5),
            agentText('k3', 6, true),
            tool('t3', 7),
        ];
    });

    it.each(['turns', 'linear'])('finds all calls between hidden thinking messages in %s mode, as the transcript does', async (mode) => {
        state.settings.transcriptGroupingMode = mode;
        expect((await renderGroup('t1')).ids).toEqual(['t1', 't2', 't3']);
    });

    it('splits the group at thinking messages that the transcript shows', async () => {
        state.settings.sessionThinkingDisplayMode = 'inline';
        expect((await renderGroup('t1')).ids).toEqual(['t1']);
    });

    it('splits the group at a visible agent message', async () => {
        state.messages = [user('u1', 1), tool('t1', 2), agentText('a1', 3, false), tool('t2', 4)];
        expect((await renderGroup('t1')).ids).toEqual(['t1']);
    });

    it('keeps the last group at the transcript tail when a hidden thinking message follows it', async () => {
        state.messages = [...state.messages, agentText('k4', 8, true)];
        expect(await renderGroup('t1')).toEqual({ ids: ['t1', 't2', 't3'], isTranscriptTail: true });
    });
});
