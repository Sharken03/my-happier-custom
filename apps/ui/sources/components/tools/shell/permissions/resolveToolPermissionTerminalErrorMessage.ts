import { isAskUserQuestionToolName } from '@happier-dev/protocol';

import type { ToolCall } from '@/sync/domains/messages/messageTypes';
import type { Metadata } from '@/sync/domains/state/storageTypes';

import type { AgentId } from '@/agents/registry/registryCore';
import { getAgentCore, resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { t } from '@/text';

function hasStructuredAnswers(result: unknown): boolean {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const answers = (result as { answers?: unknown }).answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return false;
    return Object.keys(answers).length > 0;
}

export function resolveToolPermissionTerminalErrorMessage(params: Readonly<{
    tool: ToolCall;
    metadata: Metadata | null;
    permissionDisabledReason?: 'public' | 'readOnly' | 'notGranted' | 'inactive';
    /**
     * The Agent that produced this row, when the transcript has divider
     * evidence for it. This outcome is already terminal, so the Session's
     * current Agent is not who made it: after a switch, reading live metadata
     * blamed the new Agent's read-only mode for the old Agent's denial.
     * `null`/absent keeps the live-metadata answer.
     */
    historicalAgentId?: AgentId | null;
}>): string | null {
    const permission = params.tool.permission;
    if (!permission) return null;
    if (permission.status !== 'denied' && permission.status !== 'canceled') return null;

    if (permission.status === 'denied') {
        const canBlameReadOnlyMode = (() => {
            if (params.metadata?.permissionMode !== 'read-only') return false;
            const agentId = params.historicalAgentId ?? resolveAgentIdFromFlavor(params.metadata?.flavor);
            if (!agentId) return false;
            const core = getAgentCore(agentId);
            return core.permissions?.modeGroup === 'codexLike';
        })();

        return canBlameReadOnlyMode
            ? t('errors.permissionDeniedReadOnlyMode')
            : t('errors.permissionDenied');
    }

    // canceled
    // Cached rows from before the answered-question guard in the AgentState reducer can still be
    // marked canceled while carrying the user's answers. Those are answered, not interrupted.
    const isUserAction = params.tool.permission?.kind === 'user_action'
        || isAskUserQuestionToolName(params.tool.name);
    if (isUserAction && hasStructuredAnswers(params.tool.result)) return null;
    if (params.permissionDisabledReason === 'inactive') {
        return t('errors.permissionCanceledSessionInactive');
    }
    return t('errors.permissionCanceled');
}
