import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { MMKV } from 'react-native-mmkv';

import { buildScopedSessionRouteHref } from './sessionRouteServerScope';

/**
 * Keeps the chat the reader just left mounted in the background (setting sessionOpenPreloadV1).
 * At app start it also preloads the chat that was open last (useSessionRoutePreloadAtStart).
 *
 * On native, Back pops the session screen and unmounts it. On web, an entry that is no longer
 * presented unmounts its content (SessionRouteEntryGate). Either way the next open of the same
 * chat renders the full session view again (~0.5 s on a phone). With this hook the chat is
 * preloaded as a hidden stack route a moment after it closes. The next open navigates to the
 * preloaded route, which is already rendered. The stack keeps at most one preloaded session
 * route, because the session screen has no static getId.
 */

const PRELOAD_AFTER_LEAVE_DELAY_MS = 600;
// App start is busy (sync, list render). The preload waits until that settles.
const PRELOAD_AT_START_DELAY_MS = 2000;
const LAST_OPENED_KEY = 'session-open-preload.last-opened.v1';

const lastOpenedStore = new MMKV({ id: 'session-open-preload' });
let preloadAtStartDone = false;

export type LastOpenedSessionRoute = Readonly<{ sessionId: string; serverId: string | null }>;

export function readLastOpenedSessionRoute(): LastOpenedSessionRoute | null {
    const raw = lastOpenedStore.getString(LAST_OPENED_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<LastOpenedSessionRoute>;
        if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) return null;
        return { sessionId: parsed.sessionId, serverId: typeof parsed.serverId === 'string' ? parsed.serverId : null };
    } catch {
        return null;
    }
}

function rememberOpenedSessionRoute(route: LastOpenedSessionRoute): void {
    lastOpenedStore.set(LAST_OPENED_KEY, JSON.stringify(route));
}

export function resetSessionRoutePreloadAtStartForTests(): void {
    preloadAtStartDone = false;
    lastOpenedStore.delete(LAST_OPENED_KEY);
}

type PrefetchHref = (href: string) => void;

const defaultPrefetch: PrefetchHref = (href) => router.prefetch(href as never);

export function preloadSessionRoute(params: Readonly<{
    sessionId: string;
    serverId: string | null;
    prefetch?: PrefetchHref;
}>): boolean {
    const sessionId = params.sessionId.trim();
    if (!sessionId) return false;
    const href = buildScopedSessionRouteHref({ sessionId, serverId: params.serverId });
    try {
        (params.prefetch ?? defaultPrefetch)(href);
        return true;
    } catch {
        return false;
    }
}

/**
 * Preloads the session again after its screen unmounts, but only when the screen had focus.
 * A preloaded screen that is replaced before it was shown does not preload itself again.
 */
export function useSessionRoutePreloadOnLeave(params: Readonly<{
    sessionId: string;
    serverId: string | null;
    enabled: boolean;
    prefetch?: PrefetchHref;
}>): void {
    const latestRef = React.useRef(params);
    latestRef.current = params;
    const hadFocusRef = React.useRef(false);

    useFocusEffect(React.useCallback(() => {
        hadFocusRef.current = true;
        // A chat that was opened preloads itself on leave, so the start preload is not needed.
        preloadAtStartDone = true;
        const latest = latestRef.current;
        if (latest.enabled) rememberOpenedSessionRoute({ sessionId: latest.sessionId, serverId: latest.serverId });
    }, []));

    React.useEffect(() => {
        return () => {
            const latest = latestRef.current;
            if (!hadFocusRef.current || !latest.enabled) return;
            setTimeout(() => {
                preloadSessionRoute({
                    sessionId: latest.sessionId,
                    serverId: latest.serverId,
                    prefetch: latest.prefetch,
                });
            }, PRELOAD_AFTER_LEAVE_DELAY_MS);
        };
    }, []);
}

/**
 * Preloads the chat that was open last, once per app start, so that the first open of it after
 * a start is as fast as a repeat open. The caller sets ready when the setting is on, the chat is
 * known to the session list and the list screen has focus. The preload waits a moment after
 * that and is cancelled if ready turns false first.
 */
export function useSessionRoutePreloadAtStart(params: Readonly<{
    target: LastOpenedSessionRoute | null;
    ready: boolean;
    prefetch?: PrefetchHref;
}>): void {
    const latestRef = React.useRef(params);
    latestRef.current = params;
    const active = params.ready && params.target !== null;

    React.useEffect(() => {
        if (!active || preloadAtStartDone) return;
        const timer = setTimeout(() => {
            const latest = latestRef.current;
            if (preloadAtStartDone || !latest.target) return;
            preloadAtStartDone = true;
            preloadSessionRoute({
                sessionId: latest.target.sessionId,
                serverId: latest.target.serverId,
                prefetch: latest.prefetch,
            });
        }, PRELOAD_AT_START_DELAY_MS);
        return () => clearTimeout(timer);
    }, [active]);
}
