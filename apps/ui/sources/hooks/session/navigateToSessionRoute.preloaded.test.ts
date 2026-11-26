import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigateToSessionRoute } from './navigateToSessionRoute';
import { registerPreloadedSessionRoute, type PreloadedSessionRouteNavigation } from './sessionRoutePreloadRegistry';

const LIST = { key: 'index-1', name: 'index' };
const PRELOADED = { key: 'session-p', name: 'session/[id]/index', params: { id: 's1' } };
const cleanups: Array<() => void> = [];

type Route = { key: string; name: string; params?: Record<string, string> };

function registerStack(serverId: string | null = null, preloaded: Route = PRELOADED) {
    let state: unknown = { key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [preloaded] };
    // The parent navigator routes the targeted RESET to the stack, which applies it.
    const dispatch = vi.fn((action: { payload: unknown }) => { state = action.payload; });
    const navigation: PreloadedSessionRouteNavigation = {
        getState: () => state,
        getParent: () => ({ dispatch }),
    };
    cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', serverId, routeKey: preloaded.key, navigation }));
    return dispatch;
}

afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.(); });

describe('opening a session that has a preloaded route', () => {
    it('shows the preloaded route instead of navigating to a new one', () => {
        const dispatch = registerStack();
        const navigate = vi.fn();
        const push = vi.fn();
        navigateToSessionRoute({ router: { navigate, push }, sessionId: 's1' });
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(navigate.mock.calls.length + push.mock.calls.length).toBe(0);
    });

    it('shows the route preloaded for the server the open resolved', () => {
        const otherServer: Route = { key: 'session-p-b', name: 'session/[id]/index', params: { id: 's1', serverId: 'b' } };
        let state: unknown = { key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED, otherServer] };
        const dispatch = vi.fn((action: { payload: unknown }) => { state = action.payload; });
        const navigation: PreloadedSessionRouteNavigation = {
            getState: () => state,
            getParent: () => ({ dispatch }),
        };
        cleanups.push(registerPreloadedSessionRoute({
            sessionId: 's1', serverId: 'a', routeKey: PRELOADED.key, navigation,
        }));
        cleanups.push(registerPreloadedSessionRoute({
            sessionId: 's1', serverId: 'b', routeKey: otherServer.key, navigation,
        }));

        navigateToSessionRoute({ router: { navigate: vi.fn(), push: vi.fn() }, sessionId: 's1', serverId: 'b' });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const shown = (state as { routes: Route[] }).routes;
        expect(shown[shown.length - 1]?.key).toBe('session-p-b');
    });

    it('navigates normally when the open carries extra route params', () => {
        const dispatch = registerStack();
        const navigate = vi.fn();
        const push = vi.fn();
        navigateToSessionRoute({ router: { navigate, push }, sessionId: 's1', query: { jumpSeq: 4 } });
        expect(dispatch).not.toHaveBeenCalled();
        expect(navigate.mock.calls.length + push.mock.calls.length).toBe(1);
    });
});
