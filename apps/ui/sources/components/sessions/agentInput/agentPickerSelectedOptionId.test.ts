import { describe, expect, it } from 'vitest';

import { resolveAgentPickerSelectedOptionId } from './agentPickerSelectedOptionId';

const RUNNING_ROW_ID = 'engine:codex';

describe('agent picker default selection', () => {
    it('never reads a view row as the selection just because a caller put it first', () => {
        expect(resolveAgentPickerSelectedOptionId({
            requestedOptionId: null,
            options: [{ id: 'favorite-models' }, { id: RUNNING_ROW_ID }, { id: 'builtInAgent:claude' }],
            currentAgentOptionIds: new Set([RUNNING_ROW_ID]),
        })).toBe(RUNNING_ROW_ID);
    });

    it('keeps the caller\'s explicit selection, on any row', () => {
        expect(resolveAgentPickerSelectedOptionId({
            requestedOptionId: 'builtInAgent:claude',
            options: [{ id: 'favorite-models' }, { id: RUNNING_ROW_ID }, { id: 'builtInAgent:claude' }],
            currentAgentOptionIds: new Set([RUNNING_ROW_ID]),
        })).toBe('builtInAgent:claude');

        expect(resolveAgentPickerSelectedOptionId({
            requestedOptionId: 'favorite-models',
            options: [{ id: 'favorite-models' }, { id: RUNNING_ROW_ID }],
            currentAgentOptionIds: new Set([RUNNING_ROW_ID]),
        })).toBe('favorite-models');
    });

    it('falls back to the first row when the composer owns no current-Agent row', () => {
        expect(resolveAgentPickerSelectedOptionId({
            requestedOptionId: null,
            options: [{ id: 'favorite-models' }, { id: 'builtInAgent:claude' }],
            currentAgentOptionIds: new Set<string>(),
        })).toBe('favorite-models');
    });

    it('has no selection to make in an empty picker', () => {
        expect(resolveAgentPickerSelectedOptionId({
            requestedOptionId: null,
            options: [],
            currentAgentOptionIds: new Set([RUNNING_ROW_ID]),
        })).toBeNull();
    });
});
