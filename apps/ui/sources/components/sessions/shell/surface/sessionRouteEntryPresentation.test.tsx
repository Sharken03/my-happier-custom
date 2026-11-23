import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const navigationState = vi.hoisted(() => ({ pathname: '/session/s1', focused: true }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: { OS: 'web', select: (value: any) => value?.web ?? value?.default ?? null },
    });
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: () => navigationState.pathname }).module;
});
const stackState = vi.hoisted(() => ({ preloadedKeys: [] as string[], listeners: new Set<() => void>(), dispatched: [] as unknown[] }));

vi.mock('@react-navigation/native', async () => {
    const ReactModule = await import('react');
    const navigation = {
        getState: () => ({
            key: 'stack-1',
            index: 0,
            routes: [{ key: 'index-1', name: 'index' }],
            preloadedRoutes: stackState.preloadedKeys.map((key) => ({ key, name: 'session/[id]/index' })),
        }),
        dispatch: (action: unknown) => { stackState.dispatched.push(action); },
        addListener: (_event: string, listener: () => void) => {
            stackState.listeners.add(listener);
            return () => stackState.listeners.delete(listener);
        },
    };
    return {
        useIsFocused: () => navigationState.focused,
        NavigationContext: ReactModule.createContext(navigation),
        NavigationRouteContext: ReactModule.createContext({ key: 'session-route-key' }),
    };
});

afterEach(() => {
    vi.useRealTimers();
    standardCleanup();
    navigationState.pathname = '/session/s1';
    navigationState.focused = true;
    stackState.preloadedKeys = [];
    stackState.listeners.clear();
    stackState.dispatched = [];
});

async function countMountsUnderGate(sessionId: string): Promise<number> {
    const { SessionRouteEntryGate } = await import('./sessionRouteEntryPresentation');
    let mounts = 0;
    function SessionContent() {
        React.useEffect(() => {
            mounts += 1;
        }, []);
        return null;
    }
    await renderScreen(
        <SessionRouteEntryGate sessionId={sessionId}>
            <SessionContent />
        </SessionRouteEntryGate>,
    );
    return mounts;
}

describe('SessionRouteEntryGate (web)', () => {
    it('mounts the focused session entry', async () => {
        navigationState.pathname = '/session/s1';
        navigationState.focused = true;

        expect(await countMountsUnderGate('s1')).toBe(1);
    });

    it('mounts nothing for an earlier visit kept only as Back/Forward history', async () => {
        // Visited s1, then opened s2: the s1 entry stays in the stack, unfocused.
        navigationState.pathname = '/session/s2';
        navigationState.focused = false;

        expect(await countMountsUnderGate('s1')).toBe(0);
    });

    it('mounts a preloaded entry that no navigation has taken yet', async () => {
        // The reader left s1 for the list; s1 was preloaded as a hidden stack route.
        navigationState.pathname = '/';
        navigationState.focused = false;
        stackState.preloadedKeys = ['session-route-key'];

        expect(await countMountsUnderGate('s1')).toBe(1);
    });

    it('offers a preloaded entry to the next open of its session, and stops once it is taken', async () => {
        const { takePreloadedSessionRoute } = await import('@/hooks/session/sessionRoutePreloadRegistry');
        const { act } = await import('react-test-renderer');
        navigationState.pathname = '/';
        navigationState.focused = false;
        stackState.preloadedKeys = ['session-route-key'];
        await countMountsUnderGate('s1');

        expect(takePreloadedSessionRoute('s2')).toBe(false);
        expect(takePreloadedSessionRoute('s1')).toBe(true);
        expect(stackState.dispatched).toHaveLength(1);

        await act(async () => {
            stackState.preloadedKeys = [];
            for (const listener of stackState.listeners) listener();
        });
        expect(takePreloadedSessionRoute('s1')).toBe(false);
    });

    it('offers a preloaded entry on native too', async () => {
        const { Platform } = await import('react-native');
        const { takePreloadedSessionRoute } = await import('@/hooks/session/sessionRoutePreloadRegistry');
        const originalOs = Platform.OS;
        Platform.OS = 'android';
        try {
            navigationState.pathname = '/';
            navigationState.focused = false;
            stackState.preloadedKeys = ['session-route-key'];
            await countMountsUnderGate('s1');

            expect(takePreloadedSessionRoute('s1')).toBe(true);
        } finally {
            Platform.OS = originalOs;
        }
    });

    it('keeps the entry mounted under its own sub-route, where it is still the visible anchor', async () => {
        navigationState.pathname = '/session/s1/message/m1';
        navigationState.focused = false;

        expect(await countMountsUnderGate('s1')).toBe(1);
    });

    it('lets a preloaded entry finish its staged mount before it freezes', async () => {
        const { SessionRouteEntryGate, PRELOADED_ROUTE_SETTLE_MS } = await import('./sessionRouteEntryPresentation');
        const { act } = await import('react-test-renderer');
        let transcriptMounts = 0;
        // Like the session view: the transcript list mounts in a later pass (Deferred, 10 ms).
        function Transcript() {
            React.useEffect(() => {
                transcriptMounts += 1;
            }, []);
            return null;
        }
        function SessionContent() {
            const [ready, setReady] = React.useState(false);
            React.useEffect(() => {
                const timer = setTimeout(() => setReady(true), 10);
                return () => clearTimeout(timer);
            }, []);
            return ready ? <Transcript /> : null;
        }
        navigationState.pathname = '/';
        navigationState.focused = false;
        stackState.preloadedKeys = ['session-route-key'];
        await renderScreen(
            <SessionRouteEntryGate sessionId="s1">
                <SessionContent />
            </SessionRouteEntryGate>,
        );
        // One act per stage: an async act flushes its updates only when it ends.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, PRELOADED_ROUTE_SETTLE_MS));
        });

        expect(transcriptMounts).toBe(1);
    });

    it('keeps the preloaded tree when a navigation takes it, so the open does not mount again', async () => {
        const { SessionRouteEntryGate, PRELOADED_ROUTE_SETTLE_MS } = await import('./sessionRouteEntryPresentation');
        const { act } = await import('react-test-renderer');
        let mounts = 0;
        const firstRenderIds: number[] = [];
        function SessionContent() {
            const id = React.useRef(Math.random()).current;
            firstRenderIds.push(id);
            React.useEffect(() => {
                mounts += 1;
            }, []);
            return null;
        }
        navigationState.pathname = '/';
        navigationState.focused = false;
        stackState.preloadedKeys = ['session-route-key'];
        await renderScreen(
            <SessionRouteEntryGate sessionId="s1">
                <SessionContent />
            </SessionRouteEntryGate>,
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, PRELOADED_ROUTE_SETTLE_MS + 50));
        });

        await act(async () => {
            navigationState.pathname = '/session/s1';
            navigationState.focused = true;
            stackState.preloadedKeys = [];
            for (const listener of stackState.listeners) listener();
        });

        expect(mounts).toBe(1);
        expect(new Set(firstRenderIds).size).toBe(1);
    });

    it('does not re-render a preloaded entry on store updates, and renders current data when taken', async () => {
        const { SessionRouteEntryGate } = await import('./sessionRouteEntryPresentation');
        const { act } = await import('react-test-renderer');
        const source = { value: 0, listeners: new Set<() => void>() };
        const subscribe = (listener: () => void) => {
            source.listeners.add(listener);
            return () => source.listeners.delete(listener);
        };
        const rendered: number[] = [];
        function SessionContent() {
            const value = React.useSyncExternalStore(subscribe, () => source.value);
            rendered.push(value);
            return null;
        }
        navigationState.pathname = '/';
        navigationState.focused = false;
        stackState.preloadedKeys = ['session-route-key'];
        await renderScreen(
            <SessionRouteEntryGate sessionId="s1">
                <SessionContent />
            </SessionRouteEntryGate>,
        );
        const { PRELOADED_ROUTE_SETTLE_MS } = await import('./sessionRouteEntryPresentation');
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, PRELOADED_ROUTE_SETTLE_MS + 50));
        });
        const rendersWhilePreloaded = rendered.length;
        expect(rendersWhilePreloaded).toBeGreaterThan(0);

        await act(async () => {
            for (let next = 1; next <= 3; next += 1) {
                source.value = next;
                for (const listener of source.listeners) listener();
            }
        });
        expect(rendered.length).toBe(rendersWhilePreloaded);

        // A navigation takes the preloaded route: it is focused and no longer preloaded.
        await act(async () => {
            navigationState.pathname = '/session/s1';
            navigationState.focused = true;
            stackState.preloadedKeys = [];
            for (const listener of stackState.listeners) listener();
        });
        expect(rendered[rendered.length - 1]).toBe(3);
    });
});
