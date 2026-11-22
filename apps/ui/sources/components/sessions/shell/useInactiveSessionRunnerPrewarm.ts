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
 * that a resume is likely, so the returned callback asks for a preview of no keys once each
 * time the session is inactive: a chat that ran and stopped while it stayed open asks again.
 * The daemon ignores the request when a prewarmed runner already waits.
 */
export function useInactiveSessionRunnerPrewarm(target: InactiveSessionRunnerPrewarmTarget): () => void {
    const targetRef = React.useRef(target);
    targetRef.current = target;
    const requestedSessionIdRef = React.useRef<string | null>(null);
    // The resume took the prewarmed runner, so the next inactive period needs a new one.
    React.useEffect(() => {
        if (target.isSessionActive) requestedSessionIdRef.current = null;
    }, [target.isSessionActive]);
    return React.useCallback(() => {
        const current = targetRef.current;
        if (requestedSessionIdRef.current === current.sessionId) return;
        const machineId = resolveInactiveSessionRunnerPrewarmMachineId(current);
        if (!machineId) return;
        requestedSessionIdRef.current = current.sessionId;
        void machinePreviewEnv(machineId, { keys: [] }, { serverId: current.serverId ?? null });
    }, []);
}
