import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const machinePreviewEnvSpy = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ supported: true })));

vi.mock('@/sync/ops', () => ({
    machinePreviewEnv: machinePreviewEnvSpy,
}));

import {
    resolveInactiveSessionRunnerPrewarmMachineId,
    useInactiveSessionRunnerPrewarm,
    type InactiveSessionRunnerPrewarmTarget,
} from './useInactiveSessionRunnerPrewarm';

const inactiveTarget: InactiveSessionRunnerPrewarmTarget = {
    sessionId: 's1',
    isSessionActive: false,
    isResumable: true,
    isMachineReachable: true,
    machineId: 'm1',
    serverId: 'srv1',
};

afterEach(async () => {
    machinePreviewEnvSpy.mockClear();
    await standardCleanup();
});

describe('resolveInactiveSessionRunnerPrewarmMachineId', () => {
    it('returns the machine for an inactive, resumable session on a reachable machine', () => {
        expect(resolveInactiveSessionRunnerPrewarmMachineId(inactiveTarget)).toBe('m1');
    });

    it('returns null when a resume is not possible now', () => {
        expect(resolveInactiveSessionRunnerPrewarmMachineId({ ...inactiveTarget, isSessionActive: true })).toBeNull();
        expect(resolveInactiveSessionRunnerPrewarmMachineId({ ...inactiveTarget, isResumable: false })).toBeNull();
        expect(resolveInactiveSessionRunnerPrewarmMachineId({ ...inactiveTarget, isMachineReachable: false })).toBeNull();
        expect(resolveInactiveSessionRunnerPrewarmMachineId({ ...inactiveTarget, machineId: ' ' })).toBeNull();
        expect(resolveInactiveSessionRunnerPrewarmMachineId({ ...inactiveTarget, machineId: null })).toBeNull();
    });
});

describe('useInactiveSessionRunnerPrewarm', () => {
    it('asks the daemon for one preview per session', async () => {
        const hook = await renderHook(useInactiveSessionRunnerPrewarm, { initialProps: inactiveTarget });
        hook.getCurrent()();
        hook.getCurrent()();
        expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(1);
        expect(machinePreviewEnvSpy).toHaveBeenCalledWith('m1', { keys: [] }, { serverId: 'srv1' });

        await hook.rerender({ ...inactiveTarget, sessionId: 's2' });
        hook.getCurrent()();
        expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(2);
    });

    it('does not ask while the session is active', async () => {
        const hook = await renderHook(useInactiveSessionRunnerPrewarm, {
            initialProps: { ...inactiveTarget, isSessionActive: true },
        });
        hook.getCurrent()();
        expect(machinePreviewEnvSpy).not.toHaveBeenCalled();

        await hook.rerender(inactiveTarget);
        hook.getCurrent()();
        expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(1);
    });

    it('asks again at most once a minute while the user keeps typing', async () => {
        vi.useFakeTimers();
        try {
            const hook = await renderHook(useInactiveSessionRunnerPrewarm, { initialProps: inactiveTarget });
            hook.getCurrent()();
            vi.advanceTimersByTime(59_000);
            hook.getCurrent()();
            expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1_000);
            hook.getCurrent()();
            hook.getCurrent()();
            expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('asks again after the session ran and stopped while the chat stayed open', async () => {
        const hook = await renderHook(useInactiveSessionRunnerPrewarm, { initialProps: inactiveTarget });
        hook.getCurrent()();
        expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(1);

        await hook.rerender({ ...inactiveTarget, isSessionActive: true });
        await hook.rerender(inactiveTarget);
        hook.getCurrent()();
        hook.getCurrent()();
        expect(machinePreviewEnvSpy).toHaveBeenCalledTimes(2);
    });
});
