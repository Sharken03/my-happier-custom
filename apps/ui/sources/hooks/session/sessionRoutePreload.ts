import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { MMKV } from 'react-native-mmkv';

import type { SessionPreloadTarget } from './resolveTopSessionPreloadTarget';
import { dropPreloadedSessionRoutes, sessionRoutePreloadKey } from './sessionRoutePreloadRegistry';
import { buildScopedSessionRouteHref } from './sessionRouteServerScope';

/**
 * Keeps the chat the reader just left mounted in the background (setting sessionOpenPreloadV1).
 * At app start it also preloads the first few chats of the list (useSessionRoutePreloadAtStart).
 *
 * On native, Back pops the session screen and unmounts it. On web, an entry that is no longer
 * presented unmounts its content (SessionRouteEntryGate). Either way the next open of the same
 * chat renders the full session view again (~0.5 s on a phone). With this hook the chat is
 * preloaded as a hidden stack route a moment after it closes, or, at app start, before the reader
 * taps it. The next open navigates to the preloaded route, which is already rendered.
 *
 * The session screen has a per-chat id (_layout), so the stack keeps one preloaded route per chat
 * instead of dropping the previous one. Nothing caps that list in the router, so this module does:
 * MAX_PRELOADED_SESSION_ROUTES routes from the top of the list, asked for one at a time. A chat the
 * reader then opens adds itself on leave, so the real ceiling is one above that (six trees, ~90 MB).
 */

const PRELOAD_AFTER_LEAVE_DELAY_MS = 600;
/**
 * How many chats the app keeps rendered in the background. One hidden session tree costs 13-15 MB
 * and 0.5-1.5 s of render on the 8T (~70 MB for five), and each of them turns a ~1.45 s open into
 * a ~0.55 s one.
 */
export const MAX_PRELOADED_SESSION_ROUTES = 5;
/**
 * Spacing between two start preloads. Five hidden renders in one burst would stall the list the
 * reader is touching, so the chain asks for one chat, waits out the settle window
 * (PRELOADED_ROUTE_SETTLE_MS = 1500 ms in sessionRouteEntryPresentation) plus a margin, then asks
 * for the next. The first one still fires at once: that is the win measured today.
 */
export const PRELOAD_STAGGER_MS = 1600;
const LAST_OPENED_KEY = 'session-open-preload.last-opened.v1';

const lastOpenedStore = new MMKV({ id: 'session-open-preload' });

type PrefetchHref = (href: string) => void;

const defaultPrefetch: PrefetchHref = (href) => router.prefetch(href as never);

/**
 * Once per app start. An opened chat stops the chain for good, because that chat preloads itself
 * on leave and the reader is no longer looking at the top of the list.
 */
let startPreloadsStopped = false;
let startPreloadTimer: ReturnType<typeof setTimeout> | null = null;
/** The chats the start chain has asked the stack for, oldest first. */
const startPreloadedTargets: SessionPreloadTarget[] = [];
/** The chats the start chain wants preloaded, newest computed list first, capped. */
let startPreloadWanted: readonly SessionPreloadTarget[] = [];
let startPreloadPrefetch: PrefetchHref | undefined;

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
    startPreloadsStopped = false;
    cancelStartPreloadTimer();
    startPreloadedTargets.length = 0;
    startPreloadWanted = [];
    startPreloadPrefetch = undefined;
    lastOpenedStore.delete(LAST_OPENED_KEY);
}

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

function findPendingStartTarget(): SessionPreloadTarget | undefined {
    return startPreloadWanted.find((target) => (
        !startPreloadedTargets.some((preloaded) => sessionRoutePreloadKey(preloaded) === sessionRoutePreloadKey(target))
    ));
}

function cancelStartPreloadTimer(): void {
    if (startPreloadTimer === null) return;
    clearTimeout(startPreloadTimer);
    startPreloadTimer = null;
}

function preloadNextStartTarget(): void {
    // Clear the handle through the one helper: assigning null here would drop a live timeout that a
    // second chain (another mounted list surface) could no longer cancel.
    cancelStartPreloadTimer();
    if (startPreloadsStopped) return;
    const next = findPendingStartTarget();
    if (!next) return;
    startPreloadedTargets.push(next);
    preloadSessionRoute({
        sessionId: next.sessionId,
        serverId: next.serverId,
        prefetch: startPreloadPrefetch,
    });
    scheduleNextStartPreload();
}

function scheduleNextStartPreload(): void {
    if (startPreloadTimer !== null || startPreloadsStopped) return;
    if (!findPendingStartTarget()) return;
    startPreloadTimer = setTimeout(preloadNextStartTarget, PRELOAD_STAGGER_MS);
}

/**
 * Drops the preloads of chats the list no longer offers, so the stack returns to at most
 * MAX_PRELOADED_SESSION_ROUTES hidden session routes as the list changes under the chain.
 */
function dropStartPreloadsThatLeft(): void {
    const dropped = startPreloadedTargets.filter((preloaded) => (
        !startPreloadWanted.some((target) => sessionRoutePreloadKey(target) === sessionRoutePreloadKey(preloaded))
    ));
    if (dropped.length === 0) return;
    const kept = startPreloadedTargets.filter((preloaded) => !dropped.includes(preloaded));
    startPreloadedTargets.length = 0;
    startPreloadedTargets.push(...kept);
    dropPreloadedSessionRoutes(dropped);
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
        // A chat that was opened preloads itself on leave, so the start chain stops here.
        startPreloadsStopped = true;
        cancelStartPreloadTimer();
        const latest = latestRef.current;
        // The chat on screen does not need its own hidden twin. Normally the take consumed the
        // preloaded route and this finds nothing; when the reader tapped inside the frame before that
        // route registered, the twin stayed behind, and dropping it here is the only way to free its
        // 13-15 MB without waiting for the chat to be preloaded again.
        dropPreloadedSessionRoutes([{ sessionId: latest.sessionId, serverId: latest.serverId }]);
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
 * Preloads the chats at the top of the list, once per app start, so that the first open after a
 * start is as fast as a repeat open. The caller sets ready when the setting is on, the list has
 * chats to offer and the list screen has focus, and passes at most MAX_PRELOADED_SESSION_ROUTES of
 * them, most likely to be tapped first.
 *
 * The first one fires as soon as ready is true, with no extra delay: measured on the 8T, a start
 * preload that waited 2 s was still rendering its hidden chat when the reader tapped, so the tap
 * paid the full cost anyway. The rest follow one at a time (PRELOAD_STAGGER_MS): a preload that
 * misses the tap costs nothing but the hidden render, while five simultaneous hidden renders would.
 * A later list rebuild preloads a chat that moved into the top rows and drops one that left them.
 */
export function useSessionRoutePreloadAtStart(params: Readonly<{
    targets: readonly SessionPreloadTarget[];
    ready: boolean;
    prefetch?: PrefetchHref;
}>): void {
    const latestRef = React.useRef(params);
    latestRef.current = params;
    const { ready, targets } = params;

    React.useEffect(() => {
        const latest = latestRef.current;
        startPreloadWanted = latest.targets.slice(0, MAX_PRELOADED_SESSION_ROUTES);
        startPreloadPrefetch = latest.prefetch;
        // Drop before the early return: the tap that stops the chain is also the tap that can leave
        // a hidden route behind, when it lands inside the frame between prefetch and registration.
        // Dropping only filters `preloadedRoutes` and copies routes/index, so it is safe while a
        // chat is open.
        dropStartPreloadsThatLeft();
        if (!ready || startPreloadsStopped) {
            cancelStartPreloadTimer();
            return;
        }
        if (startPreloadedTargets.length === 0) preloadNextStartTarget();
        else scheduleNextStartPreload();
        return cancelStartPreloadTimer;
    }, [ready, targets]);
}
