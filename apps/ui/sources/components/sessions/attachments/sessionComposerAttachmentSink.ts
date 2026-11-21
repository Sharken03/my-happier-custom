import type { PickedAttachment } from './AttachmentFilePicker.types';

/**
 * The session composer owns the attachment draft (useAttachmentDraftManager). Surfaces outside
 * the composer, for example the fullscreen image viewer, add files through the sink that the
 * mounted composer registers here. This is the same path the image picker uses.
 */
type SessionComposerAttachmentSink = (attachments: readonly PickedAttachment[]) => void;

const sinks = new Map<string, SessionComposerAttachmentSink>();

function normalizeSessionId(sessionId: string | null | undefined): string | null {
    if (typeof sessionId !== 'string') return null;
    const trimmed = sessionId.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function registerSessionComposerAttachmentSink(
    sessionId: string,
    sink: SessionComposerAttachmentSink,
): () => void {
    const key = normalizeSessionId(sessionId);
    if (!key) return () => {};
    sinks.set(key, sink);
    return () => {
        if (sinks.get(key) === sink) sinks.delete(key);
    };
}

export function hasSessionComposerAttachmentSink(sessionId: string | null | undefined): boolean {
    const key = normalizeSessionId(sessionId);
    return key != null && sinks.has(key);
}

/** Returns false when no composer for the session is mounted. */
export function addAttachmentsToSessionComposer(
    sessionId: string | null | undefined,
    attachments: readonly PickedAttachment[],
): boolean {
    const key = normalizeSessionId(sessionId);
    const sink = key ? sinks.get(key) : undefined;
    if (!sink) return false;
    sink(attachments);
    return true;
}
