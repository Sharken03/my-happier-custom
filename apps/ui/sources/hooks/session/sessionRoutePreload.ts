import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { MMKV } from 'react-native-mmkv';

import { requestSessionOpenPrewarm } from '@/sync/runtime/sessionOpenPrewarm';

import { buildScopedSessionRouteHref } from './sessionRouteServerScope';

/**
 * Keeps the chat the reader just left mounted in the background (setting sessionOpenPreloadV1).
 * At app start it also preloads the chat at the top of the list (useSessionRoutePreloadAtStart).
 *
 * On native, Back pops the session screen and unmounts it. On web, an entry that is no longer
 * presented unmounts its content (SessionRouteEntryGate). Either way the next open of the same
 * chat renders the full session view again (~0.5 s on a phone). With this hook the chat is
 * preloaded as a hidden stack route a moment after it closes. The next open navigates to the
 * preloaded route, which is already rendered. The stack keeps at most one preloaded session
 * route, because the session screen has no static getId.
 */

const PRELOAD_AFTER_LEAVE_DELAY_MS = 600;
const LAST_OPENED_KEY = 'session-open-preload.last-opened.v1';

const lastOpenedStore = new MMKV({ id: 'session-open-preload' });
let preloadAtStartDone = false;

/**
 * How many rows after the top one get their data warmed at app start (see useSessionRoutePreloadAtStart).
 * Only one chat is kept rendered in the background: a second hidden route reorders the native screens
 * when it is taken, which left a white, frozen screen on the 8T (build 347).
 */
export const MAX_START_DATA_PREWARMS = 5;
/** Spacing between two start data prewarms, so the top chat's hidden render and the list stay smooth. */
export const START_DATA_PREWARM_STAGGER_MS = 500;
let startDataPrewarmTimer: ReturnType<typeof setTimeout> | null = null;

function stopStartDataPrewarms(): void {
    if (startDataPrewarmTimer === null) return;
    clearTimeout(startDataPrewarmTimer);
    startDataPrewarmTimer = null;
}

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
    stopStartDataPrewarms();
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
        // A chat that was opened preloads itself on leave, so the start preload is not needed, and
        // the start data prewarms would only compete with the open.
        preloadAtStartDone = true;
        stopStartDataPrewarms();
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
 * Preloads the chat at the top of the list, once per app start, so that the first open after a
 * start is as fast as a repeat open. The caller sets ready when the setting is on, the list has a
 * chat to offer and the list screen has focus.
 *
 * It fires as soon as ready is true, with no extra delay: measured on the 8T, a start preload that
 * waited 2 s was still rendering its hidden chat when the reader tapped, so the tap paid the full
 * cost anyway. A preload that misses the tap costs nothing but the hidden render, whichever chat
 * was tapped — but a tap before it fires cancels it, which is why waiting is the worse trade.
 *
 * The next rows (dataPrewarmTargets) get only their data: the session and its transcript, through
 * the same prewarm a tap starts. Without it, a tap on such a row first shows the route spinner while
 * the session hydrates, then the transcript spinner while the messages load (about 1.5 s on the 8T).
 * They go one at a time and stop when a chat opens.
 */
export function useSessionRoutePreloadAtStart(params: Readonly<{
    target: LastOpenedSessionRoute | null;
    dataPrewarmTargets?: readonly LastOpenedSessionRoute[];
    ready: boolean;
    prefetch?: PrefetchHref;
    prewarm?: (sessionId: string, serverId: string | null) => void;
}>): void {
    const latestRef = React.useRef(params);
    latestRef.current = params;
    const active = params.ready && params.target !== null;

    React.useEffect(() => {
        if (!active || preloadAtStartDone) return;
        const latest = latestRef.current;
        if (!latest.target) return;
        preloadAtStartDone = true;
        preloadSessionRoute({
            sessionId: latest.target.sessionId,
            serverId: latest.target.serverId,
            prefetch: latest.prefetch,
        });
        const topSessionId = latest.target.sessionId;
        const queue = (latest.dataPrewarmTargets ?? [])
            .filter((target) => target.sessionId !== topSessionId)
            .slice(0, MAX_START_DATA_PREWARMS);
        const prewarm = latest.prewarm ?? requestSessionOpenPrewarm;
        const warmNext = () => {
            startDataPrewarmTimer = null;
            const next = queue.shift();
            if (!next) return;
            prewarm(next.sessionId, next.serverId);
            if (queue.length > 0) startDataPrewarmTimer = setTimeout(warmNext, START_DATA_PREWARM_STAGGER_MS);
        };
        stopStartDataPrewarms();
        if (queue.length > 0) startDataPrewarmTimer = setTimeout(warmNext, START_DATA_PREWARM_STAGGER_MS);
    }, [active]);
}
