import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

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

import {
    preloadSessionRoute,
    readLastOpenedSessionRoute,
    resetSessionRoutePreloadAtStartForTests,
    START_DATA_PREWARM_STAGGER_MS,
    useSessionRoutePreloadAtStart,
    useSessionRoutePreloadOnLeave,
} from './sessionRoutePreload';

const originalPlatform = Platform.OS;

describe('session route preload', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        focusState.focused = true;
        Platform.OS = 'android';
        resetSessionRoutePreloadAtStartForTests();
    });

    afterEach(() => {
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

    it('preloads the chat at the top of the list once, as soon as the list is ready at app start', async () => {
        const prefetch = vi.fn();
        const target = { sessionId: 's1', serverId: null };
        const first = await renderHook(() => useSessionRoutePreloadAtStart({ target, ready: true, prefetch }));
        // No delay: waiting for the app start to settle let the reader's tap arrive first.
        expect(prefetch).toHaveBeenCalledWith('/session/s1');
        await first.unmount();

        await renderHook(() => useSessionRoutePreloadAtStart({ target, ready: true, prefetch }));
        vi.runAllTimers();
        expect(prefetch).toHaveBeenCalledTimes(1);
    });

    it('waits while the list has no chat to offer, and preloads once it does', async () => {
        const prefetch = vi.fn();
        const target = { sessionId: 's1', serverId: null };
        const hook = await renderHook(
            (props: { ready: boolean }) => useSessionRoutePreloadAtStart({ target, ready: props.ready, prefetch }),
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
            target: { sessionId: 's1', serverId: null }, ready: true, prefetch,
        }));
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('does nothing at app start when no chat was opened before', async () => {
        const prefetch = vi.fn();
        await renderHook(() => useSessionRoutePreloadAtStart({ target: null, ready: true, prefetch }));
        vi.runAllTimers();
        expect(prefetch).not.toHaveBeenCalled();
    });

    it('warms the data of the next rows one at a time after the top chat, without preloading their routes', async () => {
        const prefetch = vi.fn();
        const prewarm = vi.fn();
        await renderHook(() => useSessionRoutePreloadAtStart({
            target: { sessionId: 's1', serverId: null },
            dataPrewarmTargets: [{ sessionId: 's2', serverId: 'srv' }, { sessionId: 's3', serverId: null }],
            ready: true,
            prefetch,
            prewarm,
        }));
        expect(prefetch).toHaveBeenCalledTimes(1);
        expect(prewarm).not.toHaveBeenCalled();

        vi.advanceTimersByTime(START_DATA_PREWARM_STAGGER_MS);
        expect(prewarm).toHaveBeenCalledTimes(1);
        expect(prewarm).toHaveBeenLastCalledWith('s2', 'srv');

        vi.advanceTimersByTime(START_DATA_PREWARM_STAGGER_MS);
        expect(prewarm).toHaveBeenLastCalledWith('s3', null);
        vi.runAllTimers();
        expect(prewarm).toHaveBeenCalledTimes(2);
        expect(prefetch).toHaveBeenCalledTimes(1);
    });

    it('stops warming the next rows once a chat is opened', async () => {
        const prewarm = vi.fn();
        await renderHook(() => useSessionRoutePreloadAtStart({
            target: { sessionId: 's1', serverId: null },
            dataPrewarmTargets: [{ sessionId: 's2', serverId: null }, { sessionId: 's3', serverId: null }],
            ready: true,
            prefetch: vi.fn(),
            prewarm,
        }));
        vi.advanceTimersByTime(START_DATA_PREWARM_STAGGER_MS);
        expect(prewarm).toHaveBeenCalledTimes(1);

        await renderHook(() => useSessionRoutePreloadOnLeave({
            sessionId: 's3', serverId: null, enabled: true, prefetch: vi.fn(),
        }));
        vi.runAllTimers();
        expect(prewarm).toHaveBeenCalledTimes(1);
    });
});

