import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigateToSessionRoute } from './navigateToSessionRoute';
import { setSessionOpenPrewarmHandler } from '@/sync/runtime/sessionOpenPrewarm';

afterEach(() => { setSessionOpenPrewarmHandler(null); });

describe('session open prewarm', () => {
    it('starts the session prewarm before the route navigation', () => {
        const order: string[] = [];
        const prewarm = vi.fn(() => { order.push('prewarm'); });
        setSessionOpenPrewarmHandler(prewarm);
        const navigate = vi.fn(() => { order.push('navigate'); });
        const push = vi.fn(() => { order.push('navigate'); });
        navigateToSessionRoute({ router: { navigate, push }, sessionId: 'session-a', serverId: 'server-1' });
        // A tap is not a background prewarm: no options.
        expect(prewarm).toHaveBeenCalledWith('session-a', 'server-1', undefined);
        expect(order).toEqual(['prewarm', 'navigate']);
    });

    it('still navigates when the prewarm handler throws', () => {
        setSessionOpenPrewarmHandler(() => { throw new Error('boom'); });
        const navigate = vi.fn();
        const push = vi.fn();
        navigateToSessionRoute({ router: { navigate, push }, sessionId: 'session-b' });
        expect(navigate.mock.calls.length + push.mock.calls.length).toBe(1);
    });
});
