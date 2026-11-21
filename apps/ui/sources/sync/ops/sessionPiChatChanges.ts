import {
    PiChatChangesDiffResponseSchema,
    type PiChatChangesDiffResponse,
    type PiChatChangesFile,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import { readPiChatChangesFiles } from '@/components/sessions/panes/git/piChatChanges/piChatChanges';
import { sessionRpcWithPreferredSessionScope } from '@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope';

/** The files a Pi chat changed outside git, or null when the call fails (also for non-Pi sessions). */
export async function sessionPiChatChangesList(sessionId: string): Promise<readonly PiChatChangesFile[] | null> {
    try {
        const response = await sessionRpcWithPreferredSessionScope<unknown, Record<string, never>>({
            sessionId,
            method: SESSION_RPC_METHODS.PI_CHAT_CHANGES_LIST,
            payload: {},
        });
        return readPiChatChangesFiles(response);
    } catch {
        return null;
    }
}

export type PiChatChangesDiff = Extract<PiChatChangesDiffResponse, { ok: true }>;

/** The before and current text of one listed file, or null when the call fails. */
export async function sessionPiChatChangesDiff(sessionId: string, path: string): Promise<PiChatChangesDiff | null> {
    try {
        const response = await sessionRpcWithPreferredSessionScope<unknown, { path: string }>({
            sessionId,
            method: SESSION_RPC_METHODS.PI_CHAT_CHANGES_DIFF,
            payload: { path },
        });
        const parsed = PiChatChangesDiffResponseSchema.safeParse(response);
        return parsed.success && parsed.data.ok ? parsed.data : null;
    } catch {
        return null;
    }
}
