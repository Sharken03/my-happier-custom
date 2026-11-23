import type { NormalizedMessage } from '@/sync/typesRaw';

import { scmStatusSync } from '@/scm/scmStatusSync';
import { resolveSessionScmDiffCacheScope } from '@/scm/diffCache/scmDiffCacheKey';
import { scmDiffCache } from '@/scm/diffCache/scmDiffCacheSingleton';
import { storage } from '@/sync/domains/state/storage';

import { createWorkspaceMutationIngestion } from './workspaceMutationIngestion';

const ingestion = createWorkspaceMutationIngestion({
    debounceMs: 200,
    minUnknownOnlyIntervalMs: 1500,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as any),
    invalidateKnownMutation: (sessionId, changedPaths) => {
        scmDiffCache.invalidatePaths({ sessionId: resolveSessionScmDiffCacheScope(sessionId), paths: new Set(changedPaths) });
        scmStatusSync.invalidateFromMutation(sessionId);
    },
    invalidateUnknownMutation: (sessionId) => {
        scmStatusSync.invalidateFromAutoRefresh(sessionId);
    },
    // A finished shell command is a real change signal, so it skips the auto-refresh interval.
    invalidateCompletedUnknownMutation: (sessionId) => {
        scmStatusSync.invalidateFromMutation(sessionId);
    },
    refreshOnToolDone: () => storage.getState().settings?.scmRefreshOnToolDoneV1 !== false,
});

export function ingestWorkspaceMutationMessages(sessionId: string, messages: readonly NormalizedMessage[]): void {
    ingestion.ingest(sessionId, messages);
}
