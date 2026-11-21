import type { Message, ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { readTurnChangeToolMetadataFromToolCall } from '@/sync/domains/session/changes/parsing/readTurnChangeToolMetadata';
import { isPendingUserActionRequest } from '@/utils/sessions/permissions/permissionPromptPolicy';
import { isShowImageToolCall } from '@/components/sessions/sessionMedia/sharedImageToolCall';

export function isToolCallMessageGroupableInTranscript(message: Message): message is ToolCallMessage {
    if (message.kind !== 'tool-call') return false;

    if (readTurnChangeToolMetadataFromToolCall(message.tool) != null) {
        return false;
    }

    // An image the agent shares is part of the reply, not a step of the work: it gets its own row.
    // The name alone decides, so the call does not leave its group when its image arrives.
    if (isShowImageToolCall(message.tool)) return false;

    return !isPendingUserActionRequest({
        toolName: message.tool.name,
        requestKind: message.tool.permission?.kind,
        permissionStatus: message.tool.permission?.status,
    });
}
