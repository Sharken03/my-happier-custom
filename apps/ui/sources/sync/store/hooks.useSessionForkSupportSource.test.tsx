import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';

import { storage } from '@/sync/domains/state/storageStore';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSessionForkSupportSource } from '@/sync/store/hooks';

afterEach(() => {
    standardCleanup();
});

function buildSession(metadata: Session['metadata']): Session {
    return {
        id: 's-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 1,
    };
}

function patchSession(patch: Partial<Session>): void {
    storage.setState((state) => {
        const session = state.sessions['s-1'];
        if (!session) return state;
        return { ...state, sessions: { ...state.sessions, 's-1': { ...session, ...patch } } };
    });
}

describe('useSessionForkSupportSource', () => {
    it('does not read the metadata again when a store update keeps the same metadata object', async () => {
        const previousState = storage.getState();
        try {
            let pathReads = 0;
            const metadata = { flavor: 'codex', host: 'localhost' } as NonNullable<Session['metadata']>;
            Object.defineProperty(metadata, 'path', {
                enumerable: true,
                get: () => {
                    pathReads += 1;
                    return '/tmp/project';
                },
            });
            storage.setState((state) => ({ ...state, sessions: { ...state.sessions, 's-1': buildSession(metadata) } }));

            const hook = await renderHook(() => useSessionForkSupportSource('s-1'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const initial = hook.getCurrent();
            expect(initial?.metadata).toBe(metadata);
            const readsAfterMount = pathReads;

            await act(async () => {
                for (let seq = 2; seq < 12; seq += 1) patchSession({ seq });
                await flushHookEffects({ cycles: 1, turns: 4 });
            });

            expect(hook.getCurrent()).toBe(initial);
            expect(pathReads).toBe(readsAfterMount);
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });

    it('keeps the value for equal metadata and replaces it when a stable field changes', async () => {
        const previousState = storage.getState();
        try {
            const metadata: Session['metadata'] = { flavor: 'codex', host: 'localhost', path: '/tmp/a' };
            storage.setState((state) => ({ ...state, sessions: { ...state.sessions, 's-1': buildSession(metadata) } }));

            const hook = await renderHook(() => useSessionForkSupportSource('s-1'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const initial = hook.getCurrent();

            await act(async () => {
                patchSession({ metadata: { flavor: 'codex', host: 'localhost', path: '/tmp/a' } });
                await flushHookEffects({ cycles: 1, turns: 4 });
            });
            expect(hook.getCurrent()).toBe(initial);

            const changed: Session['metadata'] = { flavor: 'codex', host: 'localhost', path: '/tmp/b' };
            await act(async () => {
                patchSession({ metadata: changed });
                await flushHookEffects({ cycles: 1, turns: 4 });
            });
            expect(hook.getCurrent()).not.toBe(initial);
            expect(hook.getCurrent()?.metadata).toBe(changed);
            await hook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
