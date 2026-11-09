import { describe, expect, it } from 'vitest';

import { favoriteModelValuesForScope, toggleFavoriteModelKey } from './AgentInputEngineDetail';

describe('model favorites', () => {
    it('reads only the given agent\'s favorites, and model values may contain colons and slashes', () => {
        const keys = ['pi:deepseek-router/deepseek-v4-pro', 'claude:claude-opus-5-5', 'pi:openrouter-router/google/gemma-4-31b-it:free'];
        expect([...favoriteModelValuesForScope(keys, 'pi')]).toEqual([
            'deepseek-router/deepseek-v4-pro',
            'openrouter-router/google/gemma-4-31b-it:free',
        ]);
    });

    it('adds a model that is not a favorite and removes one that is', () => {
        const added = toggleFavoriteModelKey(['claude:claude-opus-5-5'], 'pi', 'deepseek-router/deepseek-flash');
        expect(added).toEqual(['claude:claude-opus-5-5', 'pi:deepseek-router/deepseek-flash']);
        expect(toggleFavoriteModelKey(added, 'pi', 'deepseek-router/deepseek-flash')).toEqual(['claude:claude-opus-5-5']);
    });
});
