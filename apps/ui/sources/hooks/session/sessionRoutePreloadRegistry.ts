import { Platform } from 'react-native';

type StackRoute = Readonly<{ key: string; name: string }>;
type StackState = Readonly<{
    key: string;
    index: number;
    routes: ReadonlyArray<StackRoute>;
    preloadedRoutes?: ReadonlyArray<StackRoute>;
}>;

/** The part of the stack navigation object that a preloaded session screen hands over. */
export type PreloadedSessionRouteNavigation = Readonly<{
    getState: () => unknown;
    dispatch: (action: Readonly<{ type: 'RESET'; target: string; payload: StackState }>) => void;
}>;

type Registration = Readonly<{ routeKey: string; navigation: PreloadedSessionRouteNavigation }>;

const registrations = new Map<string, Registration>();

/**
 * Records that the stack holds a rendered, preloaded route for this session. The preloaded screen
 * registers itself while it is preloaded; the returned function removes the record.
 */
export function registerPreloadedSessionRoute(params: Readonly<{
    sessionId: string;
    routeKey: string;
    navigation: PreloadedSessionRouteNavigation;
}>): () => void {
    const registration: Registration = { routeKey: params.routeKey, navigation: params.navigation };
    registrations.set(params.sessionId, registration);
    return () => {
        if (registrations.get(params.sessionId) === registration) registrations.delete(params.sessionId);
    };
}

function isSessionRoute(route: StackRoute | undefined): boolean {
    return route?.name.startsWith('session/') === true;
}

/**
 * Shows the preloaded route of this session with its own key, so the screen that already rendered
 * is the one shown. A navigate or push action gives a taken preloaded route a new key, which mounts
 * the whole session view again. Returns false when the caller must navigate normally.
 */
export function takePreloadedSessionRoute(sessionId: string): boolean {
    const registration = registrations.get(sessionId);
    if (!registration) return false;
    const state = registration.navigation.getState() as StackState | undefined;
    const preloaded = state?.preloadedRoutes?.find((route) => route.key === registration.routeKey);
    if (!state || !preloaded) return false;
    // Native switches an open session in place (singular session route); keep that path.
    if (Platform.OS !== 'web' && isSessionRoute(state.routes[state.index])) return false;

    const routes = [...state.routes, preloaded];
    registration.navigation.dispatch({
        type: 'RESET',
        target: state.key,
        payload: {
            ...state,
            index: routes.length - 1,
            routes,
            preloadedRoutes: (state.preloadedRoutes ?? []).filter((route) => route.key !== preloaded.key),
        },
    });
    return true;
}
