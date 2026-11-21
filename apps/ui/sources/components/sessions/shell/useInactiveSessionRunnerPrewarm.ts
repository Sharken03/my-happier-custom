import * as React from 'react';

import { machinePreviewEnv } from '@/sync/ops';

export type InactiveSessionRunnerPrewarmTarget = Readonly<{
    sessionId: string;
    isSessionActive: boolean;
    isResumable: boolean;
    isMachineReachable: boolean;
    machineId: string | null | undefined;
    serverId: string | null | undefined;
}>;

/** Returns the machine to prewarm a runner on, or null when a resume is not possible now. */
export function resolveInactiveSessionRunnerPrewarmMachineId(
    target: InactiveSessionRunnerPrewarmTarget,
): string | null {
    if (target.isSessionActive || !target.isResumable || !target.isMachineReachable) return null;
    const machineId = typeof target.machineId === 'string' ? target.machineId.trim() : '';
    return machineId.length > 0 ? machineId : null;
}

/**
 * The daemon prewarms a session runner when the app previews the spawn environment (the
 * new-chat screen does the same on its first keystroke). Typing in an inactive chat shows
 * that a resume is likely, so the returned callback asks once per session for a preview of
 * no keys. The daemon ignores the request when a prewarmed runner already waits.
 */
export function useInactiveSessionRunnerPrewarm(target: InactiveSessionRunnerPrewarmTarget): () => void {
    const targetRef = React.useRef(target);
    targetRef.current = target;
    const requestedSessionIdRef = React.useRef<string | null>(null);
    return React.useCallback(() => {
        const current = targetRef.current;
        if (requestedSessionIdRef.current === current.sessionId) return;
        const machineId = resolveInactiveSessionRunnerPrewarmMachineId(current);
        if (!machineId) return;
        requestedSessionIdRef.current = current.sessionId;
        void machinePreviewEnv(machineId, { keys: [] }, { serverId: current.serverId ?? null });
    }, []);
}
