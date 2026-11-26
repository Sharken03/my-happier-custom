import { Platform } from 'react-native';

import type { SessionPreloadTarget } from './resolveTopSessionPreloadTarget';

type StackRoute = Readonly<{ key: string; name: string }>;
type StackState = Readonly<{
    key: string;
    index: number;
    routes: ReadonlyArray<StackRoute>;
    preloadedRoutes?: ReadonlyArray<StackRoute>;
}>;

type StackResetAction = Readonly<{ type: 'RESET'; target: string; payload: StackState }>;

/**
 * The part of the navigation object that a preloaded session screen hands over. A preloaded
 * screen gets a placeholder object from React Navigation: getState reads the stack, but its own
 * dispatch throws. An action sent to the parent navigator with the stack as target reaches it.
 */
export type PreloadedSessionRouteNavigation = Readonly<{
    getState: () => unknown;
    getParent: () => Readonly<{ dispatch: (action: StackResetAction) => void }> | undefined;
}>;

type Registration = Readonly<{ routeKey: string; navigation: PreloadedSessionRouteNavigation }>;

const registrations = new Map<string, Registration>();

/**
 * Identity of a preloaded session route. The server is part of it because the same session id can
 * exist on two servers; a call that knows no server scope uses an empty one, so a single-argument
 * caller keeps working as before.
 */
export function sessionRoutePreloadKey(target: Readonly<{ sessionId: string; serverId?: string | null }>): string {
    return `${target.serverId ?? ''}|${target.sessionId}`;
}

/**
 * Records that the stack holds a rendered, preloaded route for this chat. The preloaded screen
 * registers itself while it is preloaded; the returned function removes the record.
 */
export function registerPreloadedSessionRoute(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    routeKey: string;
    navigation: PreloadedSessionRouteNavigation;
}>): () => void {
    const key = sessionRoutePreloadKey(params);
    const registration: Registration = { routeKey: params.routeKey, navigation: params.navigation };
    registrations.set(key, registration);
    return () => {
        if (registrations.get(key) === registration) registrations.delete(key);
    };
}

function isSessionRoute(route: StackRoute | undefined): boolean {
    return route?.name.startsWith('session/') === true;
}

function findRegistration(sessionId: string, serverId: string | null | undefined): Registration | undefined {
    const registration = registrations.get(sessionRoutePreloadKey({ sessionId, serverId: serverId ?? null }));
    if (registration || !serverId) return registration;
    // A preload href that carried no server id registers without one, while the open resolves the
    // server from the local cache. The serverless record is then the same chat, and no other
    // server's route can be shown by mistake: the record carries its own route key.
    return registrations.get(sessionRoutePreloadKey({ sessionId }));
}

/**
 * Shows the preloaded route of this chat with its own key, so the screen that already rendered
 * is the one shown. A navigate or push action gives a taken preloaded route a new key, which mounts
 * the whole session view again. Returns false when the caller must navigate normally.
 */
export function takePreloadedSessionRoute(sessionId: string, serverId?: string | null): boolean {
    const registration = findRegistration(sessionId, serverId);
    if (!registration) return false;
    const state = registration.navigation.getState() as StackState | undefined;
    const preloaded = state?.preloadedRoutes?.find((route) => route.key === registration.routeKey);
    if (!state || !preloaded) return false;
    // Native switches an open session in place (singular session route); keep that path.
    if (Platform.OS !== 'web' && isSessionRoute(state.routes[state.index])) return false;

    const parent = registration.navigation.getParent();
    if (!parent) return false;
    const routes = [...state.routes, preloaded];
    parent.dispatch({
        type: 'RESET',
        target: state.key,
        payload: {
            ...state,
            index: routes.length - 1,
            routes,
            preloadedRoutes: (state.preloadedRoutes ?? []).filter((route) => route.key !== preloaded.key),
        },
    });
    // The stack applies the action synchronously. If it did not, the caller navigates normally.
    const next = registration.navigation.getState() as StackState | undefined;
    return next?.routes[next.index]?.key === preloaded.key;
}

/**
 * Drops the preloaded routes of chats that left the list, so at most MAX_PRELOADED_SESSION_ROUTES
 * stay mounted. The stack has no "drop a preload" action (PRELOAD is only reachable through
 * router.prefetch), so this reuses the RESET path: the same state, with those routes filtered out
 * of `preloadedRoutes`. Every RESET payload must carry `preloadedRoutes`, because the native stack
 * view reads it on every render.
 *
 * A chat that never registered (its hidden screen has not rendered yet) keeps its route: there is no
 * key to filter. The start chain asks for a route a frame before the screen registers, so a tap in
 * that window leaves a hidden twin; `useSessionRoutePreloadOnLeave` drops it when the chat takes
 * focus, and the chain also re-drops on every list change.
 */
export function dropPreloadedSessionRoutes(targets: readonly SessionPreloadTarget[]): boolean {
    if (targets.length === 0) return false;
    const registrationsToDrop = targets
        .map((target) => findRegistration(target.sessionId, target.serverId))
        .filter((registration): registration is Registration => registration !== undefined);
    if (registrationsToDrop.length === 0) return false;

    const owner = registrationsToDrop[0];
    const state = owner.navigation.getState() as StackState | undefined;
    if (!state) return false;
    const droppedKeys = new Set(registrationsToDrop.map((registration) => registration.routeKey));
    const preloadedRoutes = state.preloadedRoutes ?? [];
    const keptPreloadedRoutes = preloadedRoutes.filter((route) => !droppedKeys.has(route.key));
    if (keptPreloadedRoutes.length === preloadedRoutes.length) return false;

    const parent = owner.navigation.getParent();
    if (!parent) return false;
    parent.dispatch({
        type: 'RESET',
        target: state.key,
        payload: {
            ...state,
            index: state.index,
            routes: [...state.routes],
            preloadedRoutes: keptPreloadedRoutes,
        },
    });
    return true;
}
