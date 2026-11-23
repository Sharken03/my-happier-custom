import { StackActions, StackRouter } from '@react-navigation/routers';
import { describe, expect, it } from 'vitest';

const SESSION = 'session/[id]/index';

/**
 * A new chat opens with router.replace. The stack holds the preloaded route of another chat
 * (setting sessionOpenPreloadV1), and the session screen has no getId. REPLACE must then open the
 * new chat, not reuse the preloaded route with its old params.
 */
describe('REPLACE with a preloaded session route', () => {
    const router = StackRouter({});
    const options = { routeNames: ['index', SESSION], routeParamList: {}, routeGetIdList: {} };

    function stateWithPreloaded() {
        const initial = router.getInitialState(options);
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
            options,
        );
        expect(next).not.toBeNull();
        const shown = next!.routes[next!.index] as { key: string; params?: { id?: string } };
        expect(shown.params?.id).toBe('new');
        expect(shown.key).not.toBe('session-p');
        expect(next!.preloadedRoutes.map((route) => route.key)).toEqual(['session-p']);
    });
});
