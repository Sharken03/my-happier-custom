import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { formatSessionCostUsd, useSessionCostUsd } from './sessionCost';

const serverFetch = vi.hoisted(() => vi.fn());
// The usage query is an HTTP call; the auth context provides its token.
vi.mock('@/sync/http/client', () => ({ serverFetch }));
vi.mock('@/auth/context/AuthContext', () => {
    const credentials = { token: 'auth-token' };
    return { useAuth: () => ({ credentials }) };
});

describe('formatSessionCostUsd', () => {
    it('shows three decimals below ten cents, two above, and nothing without a cost', () => {
        expect(formatSessionCostUsd(0.0423)).toBe('$0.042');
        expect(formatSessionCostUsd(0.1)).toBe('$0.10');
        expect(formatSessionCostUsd(12.345)).toBe('$12.35');
        expect(formatSessionCostUsd(0)).toBeNull();
        expect(formatSessionCostUsd(null)).toBeNull();
        expect(formatSessionCostUsd(Number.NaN)).toBeNull();
    });
});

describe('useSessionCostUsd', () => {
    afterEach(() => {
        vi.useRealTimers();
        serverFetch.mockReset();
        storage.setState({ sessions: {}, sessionMessages: {}, sessionListRenderables: {} } as never);
        standardCleanup();
    });

    it('reads the cost once per finished turn', async () => {
        vi.useFakeTimers();
        serverFetch.mockImplementation(async () => new Response(JSON.stringify({
            usage: [{ timestamp: 1, tokens: { total: 10 }, cost: { total: 0.25 }, reportCount: 1 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const setReady = (seq: number) => storage.setState({
            sessions: {},
            sessionMessages: {},
            sessionListRenderables: { s1: { id: 's1', latestReadyEventSeq: seq, latestReadyEventAt: seq } },
        } as never);
        setReady(5);
        const hook = await renderHook(() => useSessionCostUsd('s1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
        expect(serverFetch).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent()).toBe(0.25);

        // A render within the same turn (new token counts) asks nothing.
        await hook.rerender();
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
        expect(serverFetch).toHaveBeenCalledTimes(1);

        await act(async () => { setReady(9); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
        expect(serverFetch).toHaveBeenCalledTimes(2);
        await hook.unmount();
    });
});
