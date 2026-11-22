import { describe, expect, it } from 'vitest';

import {
    countFavoriteModelUse,
    sortFavoriteModelSelectionsByUse,
    type FavoriteModelSelectionV1,
} from './favoriteModelSelections';

const pi = { backendTargetKey: 'agent:pi', builtInAgentId: 'pi' };

describe('countFavoriteModelUse', () => {
    const favorites: FavoriteModelSelectionV1[] = [
        { backendTargetKey: 'agent:pi', builtInAgentId: 'pi', modelId: 'openrouter/a' },
        { backendTargetKey: 'agent:pi', builtInAgentId: 'pi', modelId: 'openrouter/b', useCount: 2 },
        { backendTargetKey: 'agent:claude', builtInAgentId: 'claude', modelId: 'openrouter/a' },
    ];

    it('adds one use to the favorite of the same backend and model', () => {
        const next = countFavoriteModelUse({ favorites, backend: pi, modelId: 'openrouter/b' });
        expect(next?.map((favorite) => favorite.useCount)).toEqual([undefined, 3, undefined]);
        expect(countFavoriteModelUse({ favorites, backend: pi, modelId: 'openrouter/a' })?.[0]?.useCount).toBe(1);
    });

    it('returns null when no favorite matches', () => {
        expect(countFavoriteModelUse({ favorites, backend: pi, modelId: 'openrouter/c' })).toBeNull();
        expect(countFavoriteModelUse({ favorites, backend: pi, modelId: 'default' })).toBeNull();
        expect(countFavoriteModelUse({ favorites, backend: pi, modelId: null })).toBeNull();
    });
});

describe('sortFavoriteModelSelectionsByUse', () => {
    it('puts the most used first and keeps the order of equal counts', () => {
        const favorites: FavoriteModelSelectionV1[] = [
            { backendTargetKey: 'agent:pi', modelId: 'a', useCount: 1 },
            { backendTargetKey: 'agent:pi', modelId: 'b' },
            { backendTargetKey: 'agent:pi', modelId: 'c', useCount: 5 },
            { backendTargetKey: 'agent:pi', modelId: 'd', useCount: 1 },
        ];
        expect(sortFavoriteModelSelectionsByUse(favorites).map((favorite) => favorite.modelId)).toEqual(['c', 'a', 'd', 'b']);
    });

    it('returns the same list when no favorite has a use', () => {
        const favorites: FavoriteModelSelectionV1[] = [{ backendTargetKey: 'agent:pi', modelId: 'a' }];
        expect(sortFavoriteModelSelectionsByUse(favorites)).toBe(favorites);
    });
});
