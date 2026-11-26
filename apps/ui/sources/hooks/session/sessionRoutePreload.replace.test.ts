import { StackActions, StackRouter } from '@react-navigation/routers';
import { describe, expect, it } from 'vitest';

const SESSION = 'session/[id]/index';

/**
 * A new chat opens with router.replace. The stack also holds the preloaded routes of other chats
 * (setting sessionOpenPreloadV1), so REPLACE must open the chat it was given and not adopt a
 * preloaded route of another chat with its old params.
 *
 * The session screen carries a per-chat id today (app/(app)/_layout.tsx), which is what lets several
 * preloaded chats coexist: REPLACE then reuses the preloaded route of the SAME chat (it is already
 * rendered and its key is kept) and still opens a new route for any other chat.
 */
describe('REPLACE with a preloaded session route', () => {
    const router = StackRouter({});

    function options() {
        return { routeNames: ['index', SESSION], routeParamList: {}, routeGetIdList: {} };
    }

    function stateWithPreloaded() {
        const initial = router.getInitialState(options());
        return {
            ...initial,
            routes: [initial.routes[0], { key: 'new-1', name: SESSION, params: { id: 'draft' } }],
            index: 1,
            preloadedRoutes: [{ key: 'session-p', name: SESSION, params: { id: 'old' } }],
        };
    }

    it('opens the chat it was given, not the preloaded chat of another session', () => {
        const next = router.getStateForAction(
            stateWithPreloaded(),
            StackActions.replace(SESSION, { id: 'new' }),
            options(),
        );
        const routes = (next?.routes ?? []) as ReadonlyArray<{ key: string; params?: { id?: string } }>;
        const shown = routes[next?.index ?? -1];
        expect(shown?.params?.id).toBe('new');
        expect(shown?.key).not.toBe('session-p');
        expect((next?.preloadedRoutes ?? []).map((route) => route.key)).toEqual(['session-p']);
    });

    it('takes the preloaded route when it is the same chat, keeping the rendered screen', () => {
        const routeId = (route: { params?: Record<string, unknown> }) => (
            `${SESSION}|${String(route.params?.serverId ?? '')}|${String(route.params?.id ?? '')}`
        );
        const next = router.getStateForAction(
            stateWithPreloaded(),
            StackActions.replace(SESSION, { id: 'old' }),
            { ...options(), routeGetIdList: { [SESSION]: routeId } },
        );
        const routes = (next?.routes ?? []) as ReadonlyArray<{ key: string; params?: { id?: string } }>;
        expect(routes[next?.index ?? -1]?.key).toBe('session-p');
        expect(next?.preloadedRoutes).toEqual([]);
    });
});
