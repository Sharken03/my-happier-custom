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
 * The daemon keeps a waiting runner for 2 minutes after each request. Asking again at most
 * once a minute while the user types keeps it waiting for a long message.
 */
const PREWARM_REPEAT_MS = 60_000;

/**
 * The daemon prewarms a session runner when the app previews the spawn environment (the
 * new-chat screen does the same on its first keystroke). Typing in an inactive chat shows
 * that a resume is likely, so the returned callback asks for a preview of no keys: once when
 * the session becomes inactive (a chat that ran and stopped while it stayed open asks again),
 * and again at most once a minute while the user keeps typing. The daemon starts a runner on
 * the first request and keeps the waiting one on each later request.
 */
export function useInactiveSessionRunnerPrewarm(target: InactiveSessionRunnerPrewarmTarget): () => void {
    const targetRef = React.useRef(target);
    targetRef.current = target;
    const lastRequestRef = React.useRef<Readonly<{ sessionId: string; atMs: number }> | null>(null);
    // The resume took the prewarmed runner, so the next inactive period needs a new one.
    React.useEffect(() => {
        if (target.isSessionActive) lastRequestRef.current = null;
    }, [target.isSessionActive]);
    return React.useCallback(() => {
        const current = targetRef.current;
        const now = Date.now();
        const last = lastRequestRef.current;
        if (last?.sessionId === current.sessionId && now - last.atMs < PREWARM_REPEAT_MS) return;
        const machineId = resolveInactiveSessionRunnerPrewarmMachineId(current);
        if (!machineId) return;
        lastRequestRef.current = { sessionId: current.sessionId, atMs: now };
        void machinePreviewEnv(machineId, { keys: [] }, { serverId: current.serverId ?? null });
    }, []);
}
