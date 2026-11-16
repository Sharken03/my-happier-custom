import { describe, expect, it } from 'vitest';

import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';

import {
    collectToolCallsGroupDiffTools,
    computeToolCallMessageDiffStats,
    computeToolCallsGroupDiffStats,
    readSubagentResultDiffStats,
} from './toolCallsGroupDiffStats';

function toolCall(id: string, name: string, input: unknown, children: Message[] = [], result?: unknown): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        tool: { name, input, state: 'completed', result } as unknown as ToolCall,
        children,
    };
}

describe('computeToolCallsGroupDiffStats', () => {
    it('counts an Edit by changed lines, ignoring common lines', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'Edit', input: { old_string: 'a\nb\nc', new_string: 'a\nB\nB2\nc' } },
        ])).toEqual({ added: 2, removed: 1 });
    });

    it('sums the edits of a MultiEdit', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'MultiEdit', input: { file_path: 'x', edits: [
                { old_string: 'a', new_string: 'b' },
                { old_string: 'c\nd', new_string: '' },
            ] } },
        ])).toEqual({ added: 1, removed: 3 });
    });

    it('counts all lines of a Write as added', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'write', input: { file_path: 'x', content: 'one\ntwo\n' } },
        ])).toEqual({ added: 2, removed: 0 });
    });

    it('counts + and - lines of patch text without file headers', () => {
        const patchText = ['*** Begin Patch', '*** Update File: a', '@@', '-old', '+new', '+more', '*** End Patch'].join('\n');
        expect(computeToolCallsGroupDiffStats([{ name: 'apply_patch', input: { patchText } }]))
            .toEqual({ added: 2, removed: 1 });
        expect(computeToolCallsGroupDiffStats([{ name: 'Patch', input: { diff: '--- a\n+++ b\n-x\n+y' } }]))
            .toEqual({ added: 1, removed: 1 });
    });

    it('skips errored calls and other tools', () => {
        expect(computeToolCallsGroupDiffStats([
            { name: 'Edit', input: { old_string: 'a', new_string: 'b' }, state: 'error' } as any,
            { name: 'Bash', input: { command: '+x' } },
            { name: 'Edit', input: null },
        ])).toEqual({ added: 0, removed: 0 });
    });

    it('counts the edits of a subagent call through its children', () => {
        const subagent = toolCall('agent', 'Agent', { prompt: 'fix' }, [
            { kind: 'agent-text', id: 't', localId: null, createdAt: 0, text: 'ok' } as unknown as Message,
            toolCall('e1', 'Edit', { old_string: 'a', new_string: 'b' }),
            toolCall('w1', 'Write', { content: 'x\ny' }),
        ]);
        const tools = collectToolCallsGroupDiffTools([toolCall('r', 'Read', { file_path: 'x' }), subagent]);
        expect(tools.map((tool) => tool.name)).toEqual(['Read', 'Agent', 'Edit', 'Write']);
        expect(computeToolCallsGroupDiffStats(tools)).toEqual({ added: 3, removed: 1 });
    });

    it('reads the CLI count from a subagent result', () => {
        const result = { content: 'done', details: { happierDiffStats: { added: 4, removed: 1 } } };
        expect(readSubagentResultDiffStats({ name: 'SubAgent', result })).toEqual({ added: 4, removed: 1 });
        expect(readSubagentResultDiffStats({ name: 'Edit', result })).toBeNull();
        expect(readSubagentResultDiffStats({ name: 'SubAgent', result: { details: { happierDiffStats: { added: -1, removed: 0 } } } })).toBeNull();
        expect(readSubagentResultDiffStats({ name: 'SubAgent', result: 'text' })).toBeNull();
    });

    it('uses the CLI count of a subagent and does not add its children again', () => {
        const children = [toolCall('e1', 'Edit', { old_string: 'a', new_string: 'b' })];
        const counted = toolCall('agent', 'SubAgent', {}, children, { details: { happierDiffStats: { added: 7, removed: 2 } } });
        expect(computeToolCallMessageDiffStats(counted)).toEqual({ added: 7, removed: 2 });
        const uncounted = toolCall('agent2', 'SubAgent', {}, children, { content: 'done' });
        expect(computeToolCallMessageDiffStats(uncounted)).toEqual({ added: 1, removed: 1 });
    });
});
