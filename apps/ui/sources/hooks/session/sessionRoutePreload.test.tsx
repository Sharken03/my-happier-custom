import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import type { SessionPreloadTarget } from './resolveTopSessionPreloadTarget';
import {
    PRELOAD_STAGGER_MS,
    preloadSessionRoute,
    readLastOpenedSessionRoute,
    resetSessionRoutePreloadAtStartForTests,
    useSessionRoutePreloadAtStart,
    useSessionRoutePreloadOnLeave,
} from './sessionRoutePreload';
import {
    registerPreloadedSessionRoute,
    sessionRoutePreloadKey,
    type PreloadedSessionRouteNavigation,
} from './sessionRoutePreloadRegistry';

const focusState = vi.hoisted(() => ({ focused: true }));

vi.mock('@react-navigation/native', async () => {
    const React = await import('react');
    return {
        useFocusEffect: (effect: () => void) => {
            React.useEffect(() => {
                if (focusState.focused) effect();
            }, [effect]);
        },
    };
});

vi.mock('expo-router', () => ({ router: { prefetch: vi.fn() } }));

type StackRoute = { key: string; name: string; params?: Record<string, string> };
type StackState = { key: string; index: number; routes: StackRoute[]; preloadedRoutes: StackRoute[] };

const cleanups: Array<() => void> = [];

/** A stack as a preloaded screen sees it, holding the given hidden session routes. */
function registerStack(preloadedRoutes: StackRoute[]) {
    let state: StackState = { key: 'stack-1', index: 0, routes: [{ key: 'index-1', name: 'index' }], preloadedRoutes };
    const resetPayloads: Array<{ preloadedRoutes?: ReadonlyArray<StackRoute> }> = [];
    const navigation: PreloadedSessionRouteNavigation = {
        getState: () => state,
        getParent: () => ({
            dispatch: (action) => {
                if (action.target !== state.key) return;
                state = action.payload as StackState;
                resetPayloads.push(action.payload);
            },
        }),
    };
    return { navigation, resetPayloads, getState: () => state };
}

function target(sessionId: string, serverId: string | null = null): SessionPreloadTarget {
    return { sessionId, serverId };
}

const originalPlatform = Platform.OS;

describe('session route preload', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        focusState.focused = true;
        Platform.OS = 'android';
        resetSessionRoutePreloadAtStartForTests();
    });

    afterEach(() => {
        while (cleanups.length > 0) cleanups.pop()?.();
        standardCleanup();
        vi.useRealTimers();
        Platform.OS = originalPlatform;
    });

    it('prefetches the server-scoped session href', () => {
        const prefetch = vi.fn();
        expect(preloadSessionRoute({ sessionId: 's1', serverId: 'srv', prefetch })).toBe(true);
        expect(prefetch).toHaveBeenCalledWith('/session/s1?serverId=srv');
        expect(preloadSessionRoute({ sessionId: '  ', serverId: null, prefetch })).toBe(false);
        expect(prefetch).toHaveBeenCalledTimes(1);
    });

    it('preloads the chat again a moment after its focused screen unmounts', async () => {
        const prefetch = vi.fn();
        const hook = await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: null, enabled: true, prefetch,
        }));
        await hook.unmount();
        expect(prefetch).not.toHaveBeenCalled();
        vi.runAllTimers();
        expect(prefetch).toHaveBeenCalledWith('/session/s1');
    });

    it('does not preload a screen that never had focus', async () => {
        focusState.focused = false;
        const prefetch = vi.fn();
        const hook = await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: null, enabled: true, prefetch,
        }));
        await hook.unmount();
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('does nothing when the setting is off', async () => {
        const prefetch = vi.fn();
        const off = await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: null, enabled: false, prefetch,
        }));
        await off.unmount();
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('also preloads on web, where a left entry unmounts its content', async () => {
        Platform.OS = 'web';
        const prefetch = vi.fn();
        const hook = await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: 'srv', enabled: true, prefetch,
        }));
        await hook.unmount();
        vi.runAllTimers();
        expect(prefetch).toHaveBeenCalledWith('/session/s1?serverId=srv');
    });

    it('remembers the chat that had focus, so the next app start can preload it', async () => {
        await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: 'srv', enabled: true, prefetch: vi.fn(),
        }));
        expect(readLastOpenedSessionRoute()).toEqual({ sessionId: 's1', serverId: 'srv' });
    });

    it('does not remember a chat when the setting is off', async () => {
        await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: null, enabled: false, prefetch: vi.fn(),
        }));
        expect(readLastOpenedSessionRoute()).toBeNull();
    });

    it('preloads the first chat of the list once, as soon as the list is ready at app start', async () => {
        const prefetch = vi.fn();
        const targets = [target('s1')];
        const first = await renderHook(() => useSessionRoutePreloadAtStart({ targets, ready: true, prefetch }));
        // No delay: waiting for the app start to settle let the reader's tap arrive first.
        expect(prefetch).toHaveBeenCalledWith('/session/s1');
        await first.unmount();

        await renderHook(() => useSessionRoutePreloadAtStart({ targets, ready: true, prefetch }));
        vi.runAllTimers();
        expect(prefetch).toHaveBeenCalledTimes(1);
    });

    it('preloads the rest of the list one at a time, so five hidden chats never render at once', async () => {
        const prefetch = vi.fn();
        const targets = [target('s1'), target('s2'), target('s3'), target('s4'), target('s5')];
        const hook = await renderHook(() => useSessionRoutePreloadAtStart({ targets, ready: true, prefetch }));
        expect(prefetch.mock.calls.map((call) => call[0])).toEqual(['/session/s1']);

        // One hidden chat costs up to 1.5 s of JS: the next one waits for the previous to settle.
        vi.advanceTimersByTime(PRELOAD_STAGGER_MS - 1);
        expect(prefetch).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(prefetch.mock.calls.map((call) => call[0])).toEqual(['/session/s1', '/session/s2']);

        vi.runAllTimers();
        expect(prefetch.mock.calls.map((call) => call[0])).toEqual([
            '/session/s1',
            '/session/s2',
            '/session/s3',
            '/session/s4',
            '/session/s5',
        ]);
        await hook.unmount();
    });

    it('never keeps more than five chats preloaded, however many rows the list offers', async () => {
        const prefetch = vi.fn();
        const targets = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((sessionId) => target(sessionId));
        const hook = await renderHook(() => useSessionRoutePreloadAtStart({ targets, ready: true, prefetch }));
        vi.runAllTimers();

        expect(prefetch).toHaveBeenCalledTimes(5);
        expect(prefetch).toHaveBeenLastCalledWith('/session/s5');
        await hook.unmount();
    });

    it('preloads the same chat of two servers once each', async () => {
        const prefetch = vi.fn();
        const targets = [target('s1', 'a'), target('s1', 'b')];
        const hook = await renderHook(() => useSessionRoutePreloadAtStart({ targets, ready: true, prefetch }));
        vi.runAllTimers();

        expect(prefetch.mock.calls.map((call) => call[0])).toEqual(['/session/s1?serverId=a', '/session/s1?serverId=b']);
        await hook.unmount();
    });

    it('drops the preload of a chat that left the list, so the stack keeps five at most', async () => {
        const prefetch = vi.fn();
        const stack = registerStack([{ key: 'session-1', name: 'session/[id]/index', params: { id: 's1' } }]);
        cleanups.push(registerPreloadedSessionRoute({
            sessionId: 's1', serverId: null, routeKey: 'session-1', navigation: stack.navigation,
        }));
        const hook = await renderHook(
            (props: { targets: SessionPreloadTarget[] }) => useSessionRoutePreloadAtStart({
                targets: props.targets, ready: true, prefetch,
            }),
            { initialProps: { targets: [target('s1'), target('s2')] } },
        );
        expect(prefetch.mock.calls.map((call) => call[0])).toEqual(['/session/s1']);

        await hook.rerender({ targets: [target('s2')] });

        expect(stack.resetPayloads).toHaveLength(1);
        expect(stack.resetPayloads[0]?.preloadedRoutes).toEqual([]);
        // What is still shown must not move: a drop only prunes the hidden routes.
        expect(stack.getState().routes).toEqual([{ key: 'index-1', name: 'index' }]);
        expect(stack.getState().index).toBe(0);
        expect(prefetch.mock.calls.map((call) => call[0])).toEqual(['/session/s1', '/session/s2']);
        await hook.unmount();
    });

    it('drops the hidden twin of the chat that just took focus', async () => {
        const stack = registerStack([{ key: 'session-1', name: 'session/[id]/index', params: { id: 's1' } }]);
        cleanups.push(registerPreloadedSessionRoute({
            sessionId: 's1', serverId: null, routeKey: 'session-1', navigation: stack.navigation,
        }));

        // A tap that lands before the preloaded screen registered leaves the hidden route behind:
        // taking it finds nothing, so the twin is still in preloadedRoutes when the chat gets focus.
        const hook = await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's1', serverId: null, enabled: true, prefetch: vi.fn(),
        }));

        expect(stack.resetPayloads).toHaveLength(1);
        expect(stack.resetPayloads[0]?.preloadedRoutes).toEqual([]);
        await hook.unmount();
    });

    it('waits while the list has no chat to offer, and preloads once it does', async () => {
        const prefetch = vi.fn();
        const targets = [target('s1')];
        const hook = await renderHook(
            (props: { ready: boolean }) => useSessionRoutePreloadAtStart({ targets, ready: props.ready, prefetch }),
            { initialProps: { ready: false } },
        );
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();

        await hook.rerender({ ready: true });
        expect(prefetch).toHaveBeenCalledTimes(1);

        // A later list rebuild must not preload the same chat again.
        await hook.rerender({ ready: false });
        await hook.rerender({ ready: true });
        vi.runAllTimers();
        expect(prefetch).toHaveBeenCalledTimes(1);
    });

    it('skips the start preload once a chat has been opened, which preloads itself on leave', async () => {
        const prefetch = vi.fn();
        await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's2', serverId: null, enabled: true, prefetch: vi.fn(),
        }));
        await renderHook(() => useSessionRoutePreloadAtStart({
            targets: [target('s1')], ready: true, prefetch,
        }));
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('does not open a hidden chat for a list that offers none', async () => {
        const prefetch = vi.fn();
        await renderHook(() => useSessionRoutePreloadAtStart({ targets: [], ready: true, prefetch }));
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('keys a preloaded route by its chat and server, so two servers do not collide', () => {
        expect(sessionRoutePreloadKey({ sessionId: 's1', serverId: 'a' }))
            .not.toBe(sessionRoutePreloadKey({ sessionId: 's1', serverId: 'b' }));
        expect(sessionRoutePreloadKey({ sessionId: 's1' })).toBe(sessionRoutePreloadKey({ sessionId: 's1', serverId: null }));
    });
});
