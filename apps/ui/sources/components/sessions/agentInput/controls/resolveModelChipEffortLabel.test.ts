import { describe, expect, it } from 'vitest';

import { resolveModelChipEffortLabel } from './resolveModelChipEffortLabel';

const effortOption = {
    id: 'reasoning_effort',
    name: 'Effort',
    type: 'select',
    currentValue: 'medium',
    options: [
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
    ],
};

const state: NonNullable<Parameters<typeof resolveModelChipEffortLabel>[0]['modelsState']> = {
    v: 1,
    provider: 'pi',
    updatedAt: 1,
    currentModelId: 'deepseek-router/deepseek-v4-pro',
    availableModels: [
        { id: 'deepseek-router/deepseek-v4-pro', name: 'DS Pro', modelOptions: [effortOption] },
        { id: 'openrouter-router/google/gemma-4-31b-it:free', name: 'Gemma 4 (free)', modelOptions: [] },
    ],
};

describe('resolveModelChipEffortLabel', () => {
    it('names the current effort of the selected model, and a user override wins', () => {
        expect(resolveModelChipEffortLabel({ modelsState: state, selectedModelId: null, overrides: null })).toBe('Medium');
        expect(resolveModelChipEffortLabel({
            modelsState: state,
            selectedModelId: 'deepseek-router/deepseek-v4-pro',
            overrides: { reasoning_effort: { value: 'high' } },
        })).toBe('High');
        expect(resolveModelChipEffortLabel({
            modelsState: state,
            selectedModelId: null,
            overrides: { reasoning_effort: { value: 'xhigh' } },
        })).toBe('Xhigh');
    });

    it('is null for a model without an effort option and without session models', () => {
        expect(resolveModelChipEffortLabel({
            modelsState: state,
            selectedModelId: 'openrouter-router/google/gemma-4-31b-it:free',
            overrides: null,
        })).toBeNull();
        expect(resolveModelChipEffortLabel({ modelsState: null, selectedModelId: null, overrides: null })).toBeNull();
    });

    it("reads agy's thinking level, which agy acp sends as the thought_level option", () => {
        const agyState: NonNullable<Parameters<typeof resolveModelChipEffortLabel>[0]['modelsState']> = {
            v: 1,
            provider: 'agy',
            updatedAt: 1,
            currentModelId: 'gemini-3.8-flash',
            availableModels: [{
                id: 'gemini-3.8-flash',
                name: 'Gemini 3.8 Flash',
                modelOptions: [{
                    id: 'thought_level',
                    name: 'Thinking Level',
                    category: 'thought_level',
                    type: 'select',
                    currentValue: 'high',
                    options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
                }],
            }],
        };
        expect(resolveModelChipEffortLabel({ modelsState: agyState, selectedModelId: null, overrides: null })).toBe('High');
        expect(resolveModelChipEffortLabel({
            modelsState: agyState,
            selectedModelId: null,
            overrides: { thought_level: { value: 'low' } },
        })).toBe('Low');
    });
});

