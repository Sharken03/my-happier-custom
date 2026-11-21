import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/sync', () => ({ sync: {} }));

import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';

import { collectSubagentSidechainIds } from './useLoadAllSubagentSidechains';

function toolCall(id: string, name: string, children: Message[] = []): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        tool: { id, name, input: {}, state: 'completed' } as unknown as ToolCall,
        children,
    };
}

describe('collectSubagentSidechainIds', () => {
    it('collects subagent calls at every depth and skips other tools', () => {
        const nested = toolCall('inner', 'Task', [toolCall('e', 'Edit')]);
        const outer = toolCall('outer', 'Agent', [toolCall('r', 'Read'), nested]);
        expect(collectSubagentSidechainIds([toolCall('b', 'Bash'), outer])).toEqual(['outer', 'inner']);
    });
});
