import { describe, expect, it } from 'vitest';

import type { ReducerMessage } from '@/sync/reducer/reducer';

import { collectRunningToolRepairTargets } from './collectRunningToolRepairTargets';

function toolMessage(params: { id: string; realID: string | null; seq: number | null; state: 'running' | 'completed' }): ReducerMessage {
    return {
        id: params.id,
        realID: params.realID,
        seq: params.seq,
        localId: null,
        createdAt: 1,
        role: 'agent',
        text: null,
        event: null,
        tool: {
            id: `call-${params.id}`,
            name: 'SubAgent',
            state: params.state,
            input: {},
            createdAt: 1,
            startedAt: 1,
            completedAt: params.state === 'completed' ? 2 : null,
            description: null,
            result: undefined,
        },
    };
}

describe('collectRunningToolRepairTargets', () => {
    it('targets the tool-call rows of running tools only', () => {
        const messages = new Map<string, ReducerMessage>([
            ['a', toolMessage({ id: 'a', realID: 'row-477', seq: 477, state: 'running' })],
            ['b', toolMessage({ id: 'b', realID: 'row-459', seq: 459, state: 'completed' })],
            ['c', toolMessage({ id: 'c', realID: 'row-681', seq: 681, state: 'running' })],
            ['d', toolMessage({ id: 'd', realID: null, seq: 700, state: 'running' })],
        ]);

        expect(collectRunningToolRepairTargets({ messages })).toEqual({
            minSeq: 477,
            messageIds: ['row-477', 'row-681'],
            messageSeqs: { 'row-477': 477, 'row-681': 681 },
        });
    });

    it('returns null when no tool is running', () => {
        const messages = new Map<string, ReducerMessage>([
            ['b', toolMessage({ id: 'b', realID: 'row-459', seq: 459, state: 'completed' })],
        ]);

        expect(collectRunningToolRepairTargets({ messages })).toBeNull();
    });
});
