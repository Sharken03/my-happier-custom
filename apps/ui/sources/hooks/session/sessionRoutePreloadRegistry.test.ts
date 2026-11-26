import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    dropPreloadedSessionRoutes,
    registerPreloadedSessionRoute,
    sessionRoutePreloadKey,
    takePreloadedSessionRoute,
    type PreloadedSessionRouteNavigation,
} from './sessionRoutePreloadRegistry';

type Route = { key: string; name: string; params?: Record<string, string> };
type StackState = { key: string; index: number; routes: Route[]; preloadedRoutes: Route[] };
type ResetAction = Parameters<NonNullable<ReturnType<PreloadedSessionRouteNavigation["getParent"]>>["dispatch"]>[0];

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
            dispatch: (action) => {
                dispatched.push(action);
                if (options.stackHandlesReset !== false && action.type === 'RESET' && action.target === state.key) {
                    state = action.payload as StackState;
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

    it('keeps the same session id of two servers apart, so one server does not take the other\'s chat', () => {
        const otherServer: Route = { key: 'session-p-b', name: 'session/[id]/index', params: { id: 's1', serverId: 'b' } };
        const stack = createStack({
            key: 'stack-1',
            index: 0,
            routes: [LIST],
            preloadedRoutes: [{ ...PRELOADED, params: { id: 's1', serverId: 'a' } }, otherServer],
        });
        cleanups.push(registerPreloadedSessionRoute({
            sessionId: 's1', serverId: 'a', routeKey: 'session-p', navigation: stack.navigation,
        }));
        cleanups.push(registerPreloadedSessionRoute({
            sessionId: 's1', serverId: 'b', routeKey: 'session-p-b', navigation: stack.navigation,
        }));

        expect(sessionRoutePreloadKey({ sessionId: 's1', serverId: 'a' }))
            .not.toBe(sessionRoutePreloadKey({ sessionId: 's1', serverId: 'b' }));
        expect(takePreloadedSessionRoute('s1', 'b')).toBe(true);
        expect(stack.getState().routes.map((route) => route.key)).toEqual([LIST.key, 'session-p-b']);
        expect(stack.getState().preloadedRoutes.map((route) => route.key)).toEqual(['session-p']);
    });

    it('reaches a route that registered without a server when the open knows the server', () => {
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(takePreloadedSessionRoute('s1', 'srv')).toBe(true);
    });
});

describe('dropping a preloaded session route', () => {
    beforeEach(() => {
        Platform.OS = 'android';
    });

    afterEach(() => {
        while (cleanups.length > 0) cleanups.pop()?.();
    });

    it('prunes only the hidden route of the chat that left the list', () => {
        const keep: Route = { key: 'session-k', name: 'session/[id]/index', params: { id: 's2' } };
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED, keep] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's2', routeKey: 'session-k', navigation: stack.navigation }));

        expect(dropPreloadedSessionRoutes([{ sessionId: 's1', serverId: null }])).toBe(true);
        expect(stack.getState().preloadedRoutes.map((route) => route.key)).toEqual(['session-k']);
        // The presented route does not move: a drop is not a navigation.
        expect(stack.getState().routes).toEqual([LIST]);
        expect(stack.getState().index).toBe(0);
    });

    it('drops several chats in one action, so five preloads prune back to one', () => {
        const second: Route = { key: 'session-q', name: 'session/[id]/index', params: { id: 's3' } };
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED, second] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's3', routeKey: 'session-q', navigation: stack.navigation }));

        expect(dropPreloadedSessionRoutes([
            { sessionId: 's1', serverId: null },
            { sessionId: 's3', serverId: null },
        ])).toBe(true);
        expect(stack.dispatched).toHaveLength(1);
        expect(stack.getState().preloadedRoutes).toEqual([]);
    });

    it('does nothing for a chat that holds no preloaded route', () => {
        const stack = createStack({ key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED] });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation: stack.navigation }));

        expect(dropPreloadedSessionRoutes([{ sessionId: 's2', serverId: null }])).toBe(false);
        expect(stack.dispatched).toEqual([]);
    });
});
