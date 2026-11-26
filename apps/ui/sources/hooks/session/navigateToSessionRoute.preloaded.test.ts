import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigateToSessionRoute } from './navigateToSessionRoute';
import { registerPreloadedSessionRoute, type PreloadedSessionRouteNavigation } from './sessionRoutePreloadRegistry';

const LIST = { key: 'index-1', name: 'index' };
const PRELOADED = { key: 'session-p', name: 'session/[id]/index', params: { id: 's1' } };
const cleanups: Array<() => void> = [];

function registerStack() {
    let state: unknown = { key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] };
    // The parent navigator routes the targeted RESET to the stack, which applies it.
    const dispatch = vi.fn((action: { payload: unknown }) => { state = action.payload; });
    const navigation: PreloadedSessionRouteNavigation = {
        getState: () => state,
        getParent: () => ({ dispatch }),
    };
    cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation }));
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

    it('navigates normally when the open carries extra route params', () => {
        const dispatch = registerStack();
        const navigate = vi.fn();
        const push = vi.fn();
        navigateToSessionRoute({ router: { navigate, push }, sessionId: 's1', query: { jumpSeq: 4 } });
        expect(dispatch).not.toHaveBeenCalled();
        expect(navigate.mock.calls.length + push.mock.calls.length).toBe(1);
    });
});
