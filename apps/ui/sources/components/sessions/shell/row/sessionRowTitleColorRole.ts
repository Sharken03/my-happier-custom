import type { SessionRowAttentionState, SessionRowTitleTone } from './resolveSessionRowPresentation';

export type SessionListActiveColorModeV1 =
    | 'activityAndAttention'
    | 'attentionOnly'
    | 'allActive';

export type SessionRowTitleColorRole = 'primary' | 'secondary' | 'tertiary';

export function normalizeSessionListActiveColorMode(value: unknown): SessionListActiveColorModeV1 {
    return value === 'attentionOnly' || value === 'allActive'
        ? value
        : 'activityAndAttention';
}

export function resolveSessionRowTitleColorRole(input: Readonly<{
    mode: SessionListActiveColorModeV1;
    selected: boolean;
    isConnected: boolean;
    isSessionActive: boolean;
    attentionState: SessionRowAttentionState;
    titleTone: SessionRowTitleTone;
    /** A row that waits for the user (unread, ready, failed, a request) keeps the primary color, also offline. */
    highlightAttention?: boolean;
}>): SessionRowTitleColorRole {
    if (input.selected) return 'primary';
    if (input.highlightAttention === true && isUserAttentionState(input.attentionState)) return 'primary';
    // An offline row recedes below a read one, but unread news still has to be findable.
    if (!input.isConnected && input.attentionState !== 'unread') return 'tertiary';

    if (input.mode === 'allActive') {
        return input.isSessionActive || input.titleTone !== 'quiet' ? 'primary' : 'secondary';
    }

    if (input.mode === 'attentionOnly') {
        return isUserAttentionState(input.attentionState) ? 'primary' : 'secondary';
    }

    return input.titleTone === 'quiet' ? 'secondary' : 'primary';
}

function isUserAttentionState(attentionState: SessionRowAttentionState): boolean {
    return attentionState === 'unread'
        || attentionState === 'pending'
        || attentionState === 'ready'
        || attentionState === 'failed'
        || attentionState === 'permission_required'
        || attentionState === 'action_required';
}
