import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    registerPreloadedSessionRoute,
    takePreloadedSessionRoute,
    type PreloadedSessionRouteNavigation,
} from './sessionRoutePreloadRegistry';

type Route = { key: string; name: string; params?: Record<string, string> };
type StackState = { key: string; index: number; routes: Route[]; preloadedRoutes: Route[] };
type ResetAction = { type: string; target?: string; payload: StackState };

const LIST: Route = { key: 'index-1', name: 'index' };
const PRELOADED: Route = { key: 'session-p', name: 'session/[id]/index', params: { id: 's1' } };

/**
 * A stack as a preloaded screen sees it: its own navigation is a placeholder that cannot
 * dispatch (React Navigation throws), and the parent navigator routes a targeted action to the
 * stack, which applies a RESET aimed at it.
 */
function createStack(initial: StackState, options: Readonly<{ stackHandlesReset?: boolean }> = {}) {
    let state = initial;
    const dispatched: ResetAction[] = [];
    const navigation: PreloadedSessionRouteNavigation = {
        getState: () => state,
        getParent: () => ({
            dispatch: (action: ResetAction) => {
                dispatched.push(action);
                if (options.stackHandlesReset !== false && action.type === 'RESET' && action.target === state.key) {
                    state = action.payload;
                }
            },
        }),
    };
    return { navigation, dispatched, getState: () => state };
}

const originalPlatform = Platform.OS;
const cleanups: Array<() => void> = [];

describe('preloaded session route registry', () => {
    beforeEach(() => {
        Platform.OS = 'android';
    });

    afterEach(() => {
        while (cleanups.length > 0) cleanups.pop()?.();
        Platform.OS = originalPlatform;
    });

    it('shows the preloaded route with its own key, so the rendered screen is shown and not mounted again', () => {
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(true);
        expect(stack.getState()).toEqual({ key: 'stack-1', index: 1, routes: [LIST, PRELOADED], preloadedRoutes: [] });
    });

    it('does nothing for a chat that has no preloaded route', () => {
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s2')).toBe(false);
        expect(stack.dispatched).toEqual([]);
    });

    it('does nothing after the preloaded screen unregisters', () => {
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] });
        registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation })();

        expect(takePreloadedSessionRoute('s1')).toBe(false);
        expect(stack.dispatched).toEqual([]);
    });

    it('does nothing when the stack no longer holds the preloaded route', () => {
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(false);
        expect(stack.dispatched).toEqual([]);
    });

    it('leaves an open session screen to the normal in-place switch on native', () => {
        const open: Route = { key: 'session-o', name: 'session/[id]/index', params: { id: 's0' } };
        const stack = createStack({ key: 'stack-1', index: 1, routes: [LIST, open], preloadedRoutes: [PRELOADED] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(false);
        expect(stack.dispatched).toEqual([]);
    });

    it('pushes the preloaded route over earlier visits on web, which keep their history entries', () => {
        Platform.OS = 'web';
        const earlier: Route = { key: 'session-o', name: 'session/[id]/index', params: { id: 's0' } };
        const stack = createStack({ key: 'stack-1', index: 1, routes: [LIST, earlier], preloadedRoutes: [PRELOADED] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(true);
        expect(stack.getState()).toEqual({ key: 'stack-1', index: 2, routes: [LIST, earlier, PRELOADED], preloadedRoutes: [] });
    });

    it('reports a stack that did not take the route, so the open navigates normally', () => {
        const stack = createStack(
            { key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] },
            { stackHandlesReset: false },
        );
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(false);
    });
});
