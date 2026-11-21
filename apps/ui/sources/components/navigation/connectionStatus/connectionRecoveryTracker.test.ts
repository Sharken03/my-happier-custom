import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    CONNECTION_RECOVERY_RECONNECTED_MS,
    CONNECTION_RECOVERY_SHOW_DELAY_MS,
    createConnectionRecoveryTracker,
    type ConnectionRecoveryPhase,
} from './connectionRecoveryTracker';

describe('connection recovery tracker', () => {
    let phases: ConnectionRecoveryPhase[];
    let tracker: ReturnType<typeof createConnectionRecoveryTracker>;

    beforeEach(() => {
        vi.useFakeTimers();
        phases = [];
        tracker = createConnectionRecoveryTracker((phase) => phases.push(phase));
    });

    afterEach(() => {
        tracker.dispose();
        vi.useRealTimers();
    });

    it('stays hidden while the first connection is made', () => {
        tracker.update('idle');
        tracker.update('connecting');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS * 4);
        tracker.update('connected');
        expect(phases).toEqual([]);
    });

    it('stays hidden when a lost connection comes back before the delay', () => {
        tracker.update('connected');
        tracker.update('disconnected');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS - 1);
        tracker.update('connected');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS * 4);
        expect(phases).toEqual([]);
    });

    it('shows reconnecting after the delay, then reconnected, then hides', () => {
        tracker.update('connected');
        tracker.update('connecting');
        tracker.update('error');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS);
        expect(phases).toEqual(['reconnecting']);
        tracker.update('connecting');
        tracker.update('connected');
        expect(phases).toEqual(['reconnecting', 'reconnected']);
        vi.advanceTimersByTime(CONNECTION_RECOVERY_RECONNECTED_MS);
        expect(phases).toEqual(['reconnecting', 'reconnected', 'hidden']);
    });

    it('hides at once when the socket goes idle, as on sign-out', () => {
        tracker.update('connected');
        tracker.update('disconnected');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS);
        tracker.update('idle');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS * 4);
        tracker.update('connecting');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS * 4);
        expect(phases).toEqual(['reconnecting', 'hidden']);
    });

    it('shows reconnecting again when the link drops while reconnected is shown', () => {
        tracker.update('connected');
        tracker.update('disconnected');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS);
        tracker.update('connected');
        tracker.update('disconnected');
        vi.advanceTimersByTime(CONNECTION_RECOVERY_SHOW_DELAY_MS);
        expect(phases).toEqual(['reconnecting', 'reconnected', 'reconnecting']);
    });
});
