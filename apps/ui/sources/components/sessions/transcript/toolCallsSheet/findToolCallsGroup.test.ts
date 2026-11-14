import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';
import { findToolCallsGroup } from './findToolCallsGroup';

function user(id: string, createdAt: number): Message {
    return { kind: 'user-text', id, localId: null, createdAt, text: id } as Message;
}

function tool(id: string, createdAt: number, name = 'Bash'): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        tool: { name, state: 'completed', input: {}, createdAt, startedAt: createdAt, completedAt: createdAt, description: null, result: 'ok' },
        children: [],
    } as unknown as Message;
}

function agentText(id: string, createdAt: number): Message {
    return { kind: 'agent-text', id, localId: null, createdAt, text: id } as Message;
}

describe('findToolCallsGroup', () => {
    it('returns the calls of the group that starts at the anchor', () => {
        const messages = [user('u1', 1), tool('t1', 2), tool('t2', 3), agentText('a1', 4), tool('t3', 5)];
        const group = findToolCallsGroup({ messagesOldestFirst: messages, anchorId: 't1' });
        expect(group?.map((m) => m.id)).toEqual(['t1', 't2']);
    });

    it('shows calls that arrive later', () => {
        const before = [user('u1', 1), tool('t1', 2)];
        const after = [...before, tool('t2', 3)];
        expect(findToolCallsGroup({ messagesOldestFirst: before, anchorId: 't1' })?.length).toBe(1);
        expect(findToolCallsGroup({ messagesOldestFirst: after, anchorId: 't1' })?.length).toBe(2);
    });


    it('returns null for an unknown anchor or an anchor that is not the first call', () => {
        const messages = [user('u1', 1), tool('t1', 2), tool('t2', 3)];
        expect(findToolCallsGroup({ messagesOldestFirst: messages, anchorId: 'nope' })).toBeNull();
        expect(findToolCallsGroup({ messagesOldestFirst: messages, anchorId: 't2' })).toBeNull();
    });
});
