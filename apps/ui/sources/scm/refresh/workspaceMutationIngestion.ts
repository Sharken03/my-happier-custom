import type { NormalizedMessage } from '@/sync/typesRaw';

import { WorkspaceMutationInvalidator } from './workspaceMutationInvalidator';

export type WorkspaceMutationIngestionOptions = Readonly<{
    debounceMs: number;
    minUnknownOnlyIntervalMs: number;
    now: () => number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    invalidateKnownMutation: (sessionId: string, changedPaths: readonly string[]) => void;
    invalidateUnknownMutation: (sessionId: string) => void;
    /** A finished tool that may have changed any file; falls back to invalidateUnknownMutation. */
    invalidateCompletedUnknownMutation?: (sessionId: string) => void;
    refreshOnToolDone?: () => boolean;
}>;

export type WorkspaceMutationIngestion = Readonly<{
    ingest: (sessionId: string, messages: readonly NormalizedMessage[]) => void;
}>;

export function createWorkspaceMutationIngestion(options: WorkspaceMutationIngestionOptions): WorkspaceMutationIngestion {
    const invalidator = new WorkspaceMutationInvalidator({
        debounceMs: options.debounceMs,
        minUnknownOnlyIntervalMs: options.minUnknownOnlyIntervalMs,
        now: options.now,
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
        refreshOnToolDone: options.refreshOnToolDone,
        onInvalidate: (event) => {
            if (event.changedPaths.length > 0) {
                options.invalidateKnownMutation(event.sessionId, event.changedPaths);
                return;
            }
            if (event.hasUnknownMutations && event.fromCompletedTool && options.invalidateCompletedUnknownMutation) {
                options.invalidateCompletedUnknownMutation(event.sessionId);
                return;
            }
            if (event.hasUnknownMutations) {
                options.invalidateUnknownMutation(event.sessionId);
            }
        },
    });

    return {
        ingest: (sessionId, messages) => invalidator.ingest(sessionId, messages),
    };
}
