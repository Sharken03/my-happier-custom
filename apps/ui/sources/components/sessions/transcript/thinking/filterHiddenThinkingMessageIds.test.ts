import { describe, expect, it } from 'vitest';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { filterHiddenThinkingMessageIds } from './filterHiddenThinkingMessageIds';

function agentText(id: string, isThinking: boolean): Message {
    return { kind: 'agent-text', id, localId: null, createdAt: 1, text: 't', isThinking } as unknown as Message;
}

function tool(id: string): Message {
    return { kind: 'tool-call', id, localId: null, createdAt: 1, tool: { name: 'Bash' }, children: [] } as unknown as Message;
}

const messagesById: Record<string, Message> = {
    a: agentText('a', false),
    t1: agentText('t1', true),
    b: tool('b'),
    t2: agentText('t2', true),
    c: tool('c'),
};
const ids = ['a', 't1', 'b', 't2', 'c'];

describe('filterHiddenThinkingMessageIds', () => {
    it('drops thinking messages when the display mode is hidden', () => {
        const result = filterHiddenThinkingMessageIds({ messageIdsOldestFirst: ids, messagesById, thinkingDisplayMode: 'hidden', forkBoundaryBeforeMessageIds: null });
        expect(result.messageIdsOldestFirst).toEqual(['a', 'b', 'c']);
    });

    it('returns the same arrays when the display mode shows thinking', () => {
        const result = filterHiddenThinkingMessageIds({ messageIdsOldestFirst: ids, messagesById, thinkingDisplayMode: 'inline', forkBoundaryBeforeMessageIds: null });
        expect(result.messageIdsOldestFirst).toBe(ids);
    });

    it('returns the same array when no thinking message is present', () => {
        const plain = ['a', 'b', 'c'];
        const result = filterHiddenThinkingMessageIds({ messageIdsOldestFirst: plain, messagesById, thinkingDisplayMode: 'hidden', forkBoundaryBeforeMessageIds: null });
        expect(result.messageIdsOldestFirst).toBe(plain);
    });

    it('moves a fork boundary from a hidden message to the next visible message', () => {
        const boundaries = new Set(['t1']);
        const result = filterHiddenThinkingMessageIds({ messageIdsOldestFirst: ids, messagesById, thinkingDisplayMode: 'hidden', forkBoundaryBeforeMessageIds: boundaries });
        expect([...(result.forkBoundaryBeforeMessageIds ?? [])]).toEqual(['b']);
    });
});
