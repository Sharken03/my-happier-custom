import * as React from 'react';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { usePathname } from 'expo-router';
import { Platform } from 'react-native';

import { useSessionScreenIsFocused } from '@/components/sessions/shell/useSessionScreenIsFocused';
import { useSurfaceAnchorPathname } from '@/components/sessions/shell/surface/sessionSurfaceAnchorPathname';
import { registerPreloadedSessionRoute } from '@/hooks/session/sessionRoutePreloadRegistry';

/**
 * Canonical owner of "is this session route entry presented".
 *
 * Web and desktop keep every session visit in the router stack for Back/Forward (#764), so one
 * stack can hold an entry per earlier visit. An entry is presented when it is focused, or when it is
 * the anchor under an overlay or under its own sub-route. Any other entry is only history.
 */

export function isOwnedSessionRootPathname(pathname: string | null | undefined, sessionId: string): boolean {
    const normalizedPathname = typeof pathname === 'string' ? pathname.trim() : '';
    if (!normalizedPathname) {
        return false;
    }

    const match = /^\/session\/([^/]+)\/?$/.exec(normalizedPathname);
    if (!match) {
        return false;
    }

    try {
        return decodeURIComponent(match[1] ?? '') === sessionId;
    } catch {
        return false;
    }
}

export function isOwnedSessionRoutePathname(pathname: string | null | undefined, sessionId: string): boolean {
    const normalizedPathname = typeof pathname === 'string' ? pathname.trim().split('?')[0] ?? '' : '';
    if (!normalizedPathname) {
        return false;
    }

    const match = /^\/session\/([^/]+)(?:\/.*)?$/.exec(normalizedPathname);
    if (!match) {
        return false;
    }

    try {
        return decodeURIComponent(match[1] ?? '') === sessionId;
    } catch {
        return false;
    }
}

export type SessionRouteEntryPresentation = Readonly<{
    surfaceFocused: boolean;
    presented: boolean;
}>;

export function useSessionRouteEntryPresentation(
    sessionId: string,
    overrides?: Readonly<{
        surfaceFocused?: boolean | null;
        routeAnchor?: boolean | null;
    }>,
): SessionRouteEntryPresentation {
    const pathname = usePathname();
    const routeFocused = useSessionScreenIsFocused();
    const anchorPathname = useSurfaceAnchorPathname(pathname);
    const surfaceFocused = typeof overrides?.surfaceFocused === 'boolean'
        ? overrides.surfaceFocused
        : routeFocused;
    const isRouteAnchor = typeof overrides?.routeAnchor === 'boolean'
        ? overrides.routeAnchor
        : isOwnedSessionRoutePathname(anchorPathname, sessionId)
            && (surfaceFocused || !isOwnedSessionRootPathname(pathname, sessionId));
    // A preloaded entry renders its content hidden, so a later open shows it at once.
    const preloaded = useIsPreloadedStackRoute();
    return { surfaceFocused, presented: surfaceFocused || isRouteAnchor || preloaded };
}

/**
 * Mounts a session route's content only while its entry is presented. A history entry keeps no
 * session subtree mounted: every mounted session view subscribes to the store, so keeping one per
 * earlier visit made each streamed update cost more the longer the app ran. Back remounts the entry
 * from the in-memory store. Native keeps its single session screen, so it always renders.
 *
 * A preloaded entry (setting sessionOpenPreloadV1, see hooks/session/sessionRoutePreload.ts) also
 * renders, on every platform: until it settles, and then frozen, so a hidden chat does no live work. The stack
 * hides it until a navigation takes it, and holds up to MAX_PRELOADED_SESSION_ROUTES of them, one per chat.
 */
export function SessionRouteEntryGate(props: Readonly<{
    sessionId: string;
    children: React.ReactNode;
}>): React.ReactElement | null {
    if (Platform.OS !== 'web') {
        return <PreloadedRouteFreeze sessionId={props.sessionId}>{props.children}</PreloadedRouteFreeze>;
    }
    return <WebSessionRouteEntryGate sessionId={props.sessionId}>{props.children}</WebSessionRouteEntryGate>;
}

function WebSessionRouteEntryGate(props: Readonly<{
    sessionId: string;
    children: React.ReactNode;
}>): React.ReactElement | null {
    const { presented } = useSessionRouteEntryPresentation(props.sessionId);
    return presented
        ? <PreloadedRouteFreeze sessionId={props.sessionId}>{props.children}</PreloadedRouteFreeze>
        : null;
}

const NEVER_SETTLES = new Promise<never>(() => {});

function SuspendWhile(props: Readonly<{ suspended: boolean; children: React.ReactNode }>): React.ReactElement {
    if (props.suspended) {
        throw NEVER_SETTLES;
    }
    return <>{props.children}</>;
}

/**
 * Time a preloaded route renders freely before it freezes. The session view mounts in stages
 * (the transcript list after a Deferred pass, the composer after two frames), and each stage
 * must commit while hidden, else the costly part still renders after the tap.
 */
export const PRELOADED_ROUTE_SETTLE_MS = 1500;

/**
 * Renders a preloaded route until it settles, then holds it frozen until a navigation takes the
 * route. A frozen subtree keeps its state and does not re-render on store updates; it renders
 * with current data when it is shown. This is the same Suspense technique as react-freeze.
 */
function PreloadedRouteFreeze(props: Readonly<{ sessionId: string; children: React.ReactNode }>): React.ReactElement {
    const preloaded = useIsPreloadedStackRoute();
    useOfferPreloadedRoute(props.sessionId, preloaded);
    const [settled, setSettled] = React.useState(false);
    React.useEffect(() => {
        const timer = setTimeout(() => setSettled(true), PRELOADED_ROUTE_SETTLE_MS);
        return () => clearTimeout(timer);
    }, []);
    return (
        <React.Suspense fallback={null}>
            <SuspendWhile suspended={preloaded && settled}>{props.children}</SuspendWhile>
        </React.Suspense>
    );
}

/** While this screen is a preloaded route, the next open of its session shows it instead of a new route. */
function useOfferPreloadedRoute(sessionId: string, preloaded: boolean): void {
    const navigation = React.useContext(NavigationContext);
    const route = React.useContext(NavigationRouteContext);
    const routeKey = route?.key ?? null;
    // The route's own server scope, so two servers that hold the same session id register apart.
    const serverId = readRouteServerIdParam(route?.params);
    React.useEffect(() => {
        if (!preloaded || !navigation || !routeKey) return;
        return registerPreloadedSessionRoute({ sessionId, serverId, routeKey, navigation });
    }, [navigation, preloaded, routeKey, serverId, sessionId]);
}

function readRouteServerIdParam(params: unknown): string | null {
    if (!params || typeof params !== 'object') return null;
    const serverId = (params as { serverId?: unknown }).serverId;
    const value = typeof serverId === 'string' ? serverId : '';
    return value.trim() || null;
}

type StackRouteRef = Readonly<{ key: string }>;
type StackStateWithPreloadedRoutes = Readonly<{ preloadedRoutes?: ReadonlyArray<StackRouteRef> }>;

/** True while this screen is a preloaded stack route that no navigation has taken yet. */
export function useIsPreloadedStackRoute(): boolean {
    const navigation = React.useContext(NavigationContext);
    const route = React.useContext(NavigationRouteContext);
    const routeKey = route?.key ?? null;
    const read = React.useCallback((): boolean => {
        if (!navigation || !routeKey) return false;
        const state = navigation.getState() as StackStateWithPreloadedRoutes | undefined;
        return state?.preloadedRoutes?.some((entry) => entry.key === routeKey) === true;
    }, [navigation, routeKey]);
    const [preloaded, setPreloaded] = React.useState(read);

    React.useEffect(() => {
        setPreloaded(read());
        if (!navigation) return;
        return navigation.addListener('state', () => setPreloaded(read()));
    }, [navigation, read]);

    return preloaded;
}
