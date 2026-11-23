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

import { preloadSessionRoute, useSessionRoutePreloadOnLeave } from './sessionRoutePreload';

const originalPlatform = Platform.OS;

describe('session route preload', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        focusState.focused = true;
        Platform.OS = 'android';
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
});
