import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    registerPreloadedSessionRoute,
    takePreloadedSessionRoute,
    type PreloadedSessionRouteNavigation,
} from './sessionRoutePreloadRegistry';

type Route = { key: string; name: string; params?: Record<string, string> };
type StackState = { key: string; index: number; routes: Route[]; preloadedRoutes: Route[] };

const LIST: Route = { key: 'index-1', name: 'index' };
const PRELOADED: Route = { key: 'session-p', name: 'session/[id]/index', params: { id: 's1' } };

function createStack(state: StackState) {
    const dispatched: unknown[] = [];
    const navigation: PreloadedSessionRouteNavigation = {
        getState: () => state,
        dispatch: (action) => { dispatched.push(action); },
    };
    return { navigation, dispatched };
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

    it('takes the preloaded route with its own key, so the rendered screen is shown and not mounted again', () => {
        const { navigation, dispatched } = createStack({
            key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED],
        });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(true);
        expect(dispatched).toEqual([{
            type: 'RESET',
            target: 'stack-1',
            payload: { key: 'stack-1', index: 1, routes: [LIST, PRELOADED], preloadedRoutes: [] },
        }]);
    });

    it('does nothing for a chat that has no preloaded route', () => {
        const { navigation, dispatched } = createStack({
            key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED],
        });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation }));

        expect(takePreloadedSessionRoute('s2')).toBe(false);
        expect(dispatched).toEqual([]);
    });

    it('does nothing after the preloaded screen unregisters', () => {
        const { navigation, dispatched } = createStack({
            key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [PRELOADED],
        });
        registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation })();

        expect(takePreloadedSessionRoute('s1')).toBe(false);
        expect(dispatched).toEqual([]);
    });

    it('does nothing when the stack no longer holds the preloaded route', () => {
        const { navigation, dispatched } = createStack({
            key: 'stack-1', index: 0, routes: [LIST], preloadedRoutes: [],
        });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(false);
        expect(dispatched).toEqual([]);
    });

    it('leaves an open session screen to the normal in-place switch on native', () => {
        const open: Route = { key: 'session-o', name: 'session/[id]/index', params: { id: 's0' } };
        const { navigation, dispatched } = createStack({
            key: 'stack-1', index: 1, routes: [LIST, open], preloadedRoutes: [PRELOADED],
        });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(false);
        expect(dispatched).toEqual([]);
    });

    it('pushes the preloaded route over earlier visits on web, which keep their history entries', () => {
        Platform.OS = 'web';
        const earlier: Route = { key: 'session-o', name: 'session/[id]/index', params: { id: 's0' } };
        const { navigation, dispatched } = createStack({
            key: 'stack-1', index: 1, routes: [LIST, earlier], preloadedRoutes: [PRELOADED],
        });
        cleanups.push(registerPreloadedSessionRoute({ sessionId: 's1', routeKey: 'session-p', navigation }));

        expect(takePreloadedSessionRoute('s1')).toBe(true);
        expect(dispatched).toEqual([{
            type: 'RESET',
            target: 'stack-1',
            payload: { key: 'stack-1', index: 2, routes: [LIST, earlier, PRELOADED], preloadedRoutes: [] },
        }]);
    });

});
