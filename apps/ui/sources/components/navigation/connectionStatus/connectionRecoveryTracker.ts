import type { ConnectionSocketStatus } from './connectionHealthTypes';

export type ConnectionRecoveryPhase = 'hidden' | 'reconnecting' | 'reconnected';

/** A drop shorter than this shows nothing, so fast reconnects do not flicker. */
export const CONNECTION_RECOVERY_SHOW_DELAY_MS = 1500;
/** How long "reconnected" stays after the link comes back. */
export const CONNECTION_RECOVERY_RECONNECTED_MS = 2000;

/**
 * Turns the server socket status into the phase of the recovery banner. Only a link that was
 * connected and then dropped counts: the first connection and an idle socket (signed out) show
 * nothing. The tracker uses one-shot timers only and publishes a phase only when it changes.
 */
export function createConnectionRecoveryTracker(onPhase: (phase: ConnectionRecoveryPhase) => void) {
    let phase: ConnectionRecoveryPhase = 'hidden';
    let hasConnected = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const publish = (next: ConnectionRecoveryPhase) => {
        if (next === phase) return;
        phase = next;
        onPhase(next);
    };

    return {
        update(status: ConnectionSocketStatus): void {
            if (status === 'idle') {
                hasConnected = false;
                clearTimer();
                publish('hidden');
                return;
            }
            if (status === 'connected') {
                clearTimer();
                if (phase === 'reconnecting') {
                    publish('reconnected');
                    timer = setTimeout(() => {
                        timer = null;
                        publish('hidden');
                    }, CONNECTION_RECOVERY_RECONNECTED_MS);
                }
                hasConnected = true;
                return;
            }
            if (!hasConnected || phase === 'reconnecting') return;
            if (phase === 'reconnected') clearTimer();
            if (timer !== null) return;
            timer = setTimeout(() => {
                timer = null;
                publish('reconnecting');
            }, CONNECTION_RECOVERY_SHOW_DELAY_MS);
        },
        dispose(): void {
            clearTimer();
        },
    };
}
