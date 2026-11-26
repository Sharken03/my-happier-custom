import { describe, expect, it } from 'vitest';

import { parseSessionConfigOptionsState, parseSessionModelsState } from './schema';

function modelsState(updatedAt: number) {
    return {
        v: 1,
        provider: 'pi',
        updatedAt,
        currentModelId: 'model-a',
        availableModels: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
    };
}

describe('session control schema parse cache', () => {
    it('returns the same parsed models state for the same raw metadata object', () => {
        const raw = modelsState(10);
        const first = parseSessionModelsState(raw);
        expect(first?.availableModels.map((model) => model.id)).toEqual(['model-a', 'model-b']);
        expect(parseSessionModelsState(raw)).toBe(first);
    });

    it('parses again when the metadata value is a new object', () => {
        const first = parseSessionModelsState(modelsState(10));
        const second = parseSessionModelsState(modelsState(20));
        expect(second).not.toBe(first);
        expect(second?.updatedAt).toBe(20);
    });

    it('keeps invalid values invalid and parses non-object values without a cache', () => {
        const invalid = { v: 2 };
        expect(parseSessionModelsState(invalid)).toBeNull();
        expect(parseSessionModelsState(invalid)).toBeNull();
        expect(parseSessionModelsState(undefined)).toBeNull();
        expect(parseSessionModelsState('x')).toBeNull();
    });

    it('caches config options state by raw object as well', () => {
        const raw = { v: 1, provider: 'pi', updatedAt: 5, configOptions: [] };
        const first = parseSessionConfigOptionsState(raw);
        expect(parseSessionConfigOptionsState(raw)).toBe(first);
    });
});
