import { Platform } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { navigateToSessionRoute } from './navigateToSessionRoute';

const originalPlatform = Platform.OS;
afterEach(() => { Platform.OS = originalPlatform; });

describe('session route history', () => {
    it('pushes each web session visit, including a revisit, for browser Back/Forward', () => {
        Platform.OS = 'web';
        const { state, spies } = createExpoRouterMock();
        for (const sessionId of ['history-a', 'history-b', 'history-a']) {
            navigateToSessionRoute({ router: state.router, sessionId });
        }
        const calls = spies.push.mock.calls as unknown as Array<[string, { dangerouslySingular?: () => string | undefined }]>;
        expect(calls.map((call) => call[0])).toEqual([
            '/session/history-a',
            '/session/history-b',
            '/session/history-a',
        ]);
        // A visit must not use the per-chat id the preloads rely on: a push carrying it moves an
        // earlier visit of the same chat instead of appending one, which loses its history entry.
        for (const call of calls) {
            expect(call[1].dangerouslySingular?.()).toBeUndefined();
        }
        expect(spies.navigate).not.toHaveBeenCalled();
    });

    it.each(['ios', 'android'] as const)('keeps the singular session stack on %s', (platform) => {
        Platform.OS = platform;
        const navigate = vi.fn();
        const push = vi.fn();
        navigateToSessionRoute({ router: { navigate, push }, sessionId: 'history-a' });
        expect(navigate).toHaveBeenCalledWith('/session/history-a', expect.any(Object));
        expect(navigate.mock.calls[0]?.[1]?.dangerouslySingular()).toBe('session');
        expect(push).not.toHaveBeenCalled();
    });
});
