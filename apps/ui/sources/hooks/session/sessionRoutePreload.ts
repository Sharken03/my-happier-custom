import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { buildScopedSessionRouteHref } from './sessionRouteServerScope';

/**
 * Keeps the chat the reader just left mounted in the background (setting sessionOpenPreloadV1).
 *
 * On native, Back pops the session screen and unmounts it, so the next open of the same chat
 * renders the full session view again (~0.5 s). With this hook the popped chat is preloaded as
 * a hidden stack route a moment after it closes. The next tap navigates to the preloaded route,
 * which is already rendered. The stack keeps at most one preloaded session route, because the
 * session screen has no static getId.
 */

const PRELOAD_AFTER_LEAVE_DELAY_MS = 600;

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
    }, []));

    React.useEffect(() => {
        return () => {
            const latest = latestRef.current;
            if (!hadFocusRef.current || !latest.enabled || Platform.OS === 'web') return;
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
