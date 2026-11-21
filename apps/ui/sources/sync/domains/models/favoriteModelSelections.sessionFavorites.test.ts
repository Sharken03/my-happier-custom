import { describe, expect, it } from 'vitest';

import {
    buildFavoriteModelBackendIdentityForEntry,
    resolveFavoriteModelValuesForBackend,
    type FavoriteModelSelectionV1,
} from './favoriteModelSelections';

const piBackend = {
    backendTargetKey: 'builtInAgent:pi',
    providerAgentId: 'pi',
    builtInAgentId: 'pi',
    configuredBackendId: null,
};

describe('session model favorites', () => {
    it('reads the current Agent\'s favorites only, ignoring other Agents and the "default" sentinel', () => {
        const favorites: FavoriteModelSelectionV1[] = [
            { backendTargetKey: 'builtInAgent:pi', modelId: 'deepseek-router/deepseek-v4-pro' },
            { backendTargetKey: 'builtInAgent:pi', modelId: 'default' },
            { backendTargetKey: 'builtInAgent:pi', modelId: 'deepseek-router/deepseek-flash' },
            { backendTargetKey: 'builtInAgent:pi', modelId: 'deepseek-router/deepseek-flash' },
            { backendTargetKey: 'builtInAgent:claude', modelId: 'claude-opus-5-5' },
        ];

        expect([...resolveFavoriteModelValuesForBackend({ favorites, backend: piBackend })])
            .toEqual(['deepseek-router/deepseek-v4-pro', 'deepseek-router/deepseek-flash']);
    });

    it('finds a configured ACP backend\'s favorites by its backend id', () => {
        const favorites: FavoriteModelSelectionV1[] = [
            {
                backendTargetKey: 'acpBackend:work',
                modelId: 'kimi-code/k3.1-pro',
                configuredBackendId: 'work',
            },
        ];

        expect([...resolveFavoriteModelValuesForBackend({
            favorites,
            backend: {
                backendTargetKey: 'acpBackend:work',
                configuredBackendId: 'work',
            },
        })]).toEqual(['kimi-code/k3.1-pro']);
    });

    it('builds the identity of a catalog entry from its own target, not from the provider it runs', () => {
        expect(buildFavoriteModelBackendIdentityForEntry({
            targetKey: 'acpBackend:work',
            providerAgentId: 'claude',
            builtInAgentId: null,
            target: { kind: 'configuredAcpBackend', backendId: 'work' },
        })).toEqual({
            backendTargetKey: 'acpBackend:work',
            providerAgentId: 'claude',
            builtInAgentId: null,
            configuredBackendId: 'work',
        });

        expect(buildFavoriteModelBackendIdentityForEntry({
            targetKey: 'builtInAgent:pi',
            providerAgentId: 'pi',
            builtInAgentId: 'pi',
            target: { kind: 'builtInAgent', agentId: 'pi' },
        })).toEqual(piBackend);
    });
});
