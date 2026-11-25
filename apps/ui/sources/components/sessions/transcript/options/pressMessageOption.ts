import { Modal } from '@/modal';
import { deriveSessionInputReadinessState } from '@/sync/domains/session/control/deriveSessionInputReadinessState';
import { storage } from '@/sync/domains/state/storage';
import type { PendingMessage } from '@/sync/domains/state/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';

const submittingOptionKeys = new Set<string>();

function canPendingRowStillRun(message: PendingMessage): boolean {
    return message.sendState !== 'failed'
        && message.pendingDeliveryStatus !== 'blocked'
        && message.pendingOutboxOperation !== 'cancel';
}

function isOptionWaitingOrRunning(sessionId: string, title: string): boolean {
    const state = storage.getState();
    const pendingMessages = state.sessionPending[sessionId]?.messages ?? [];
    if (pendingMessages.some((message) => message.text === title && canPendingRowStillRun(message))) return true;

    const session = state.sessions[sessionId];
    if (!session || !deriveSessionInputReadinessState(session, Date.now()).isInputBusy) return false;

    const transcript = state.sessionMessages[sessionId];
    if (!transcript) return false;
    for (let index = transcript.messageIdsOldestFirst.length - 1; index >= 0; index -= 1) {
        const message = transcript.messagesById[transcript.messageIdsOldestFirst[index]];
        if (message?.kind === 'user-text') return message.text === title;
    }
    return false;
}

/**
 * Submits a pressed message option. With the option queue on, a press is ignored while the same
 * option is being submitted, waits in the queue, or is the task that the agent works on.
 */
export async function pressMessageOption(params: Readonly<{
    sessionId: string;
    title: string;
    canSendMessages: boolean;
}>): Promise<void> {
    const { sessionId, title } = params;
    if (!params.canSendMessages) {
        Modal.alert(t('session.sharing.viewOnly'), t('session.sharing.noEditPermission'));
        return;
    }

    const optionKey = JSON.stringify([sessionId, title]);
    const guardsRepeat = storage.getState().settings.sessionMessageOptionsQueueV1 !== false;
    if (guardsRepeat) {
        if (submittingOptionKeys.has(optionKey) || isOptionWaitingOrRunning(sessionId, title)) return;
        submittingOptionKeys.add(optionKey);
    }
    try {
        await sync.submitMessage(sessionId, title, undefined, undefined, { callerSurface: 'message_option' });
    } catch (error) {
        Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.failedToSendMessage'));
    } finally {
        if (guardsRepeat) submittingOptionKeys.delete(optionKey);
    }
}
