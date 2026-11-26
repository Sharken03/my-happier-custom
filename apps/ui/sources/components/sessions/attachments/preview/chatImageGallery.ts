import { markdownRemoteImageTitle } from '@/components/markdown/rendering/markdownRemoteImages';
import { splitMarkdownRenderSegments } from '@/components/markdown/rendering/splitMarkdownRenderSegments';
import { resolveSessionMediaImageMimeType } from '@/components/sessions/sessionMedia/sessionMediaPresentation';
import type { Message } from '@/sync/domains/messages/messageTypes';
import {
    parseSessionMediaMessageMeta,
    type SessionMediaInlineImageSummary,
} from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';

import type { AttachmentImagePreviewModalImage } from './AttachmentImagePreviewModal';

/**
 * The fullscreen viewer entry of one session media image. The transcript tiles and the chat
 * gallery both build it here, so a tapped tile and its gallery entry have the same key.
 */
export function buildSessionMediaViewerImage(
    sessionId: string,
    media: SessionMediaInlineImageSummary,
    mimeType: string,
): AttachmentImagePreviewModalImage {
    return {
        kind: 'session-image',
        title: media.name,
        sessionId,
        filePath: media.path,
        mimeType,
        sizeBytes: media.sizeBytes,
        cacheKey: media.sha256 ?? null,
    };
}

export function buildMarkdownRemoteViewerImage(url: string, alt: string): AttachmentImagePreviewModalImage {
    return { kind: 'direct', uri: url, title: markdownRemoteImageTitle(url, alt) };
}

/** One key per distinct image: the same file with the same bytes, or the same URI. */
export function chatImageGalleryKey(image: AttachmentImagePreviewModalImage): string {
    if (image.kind === 'direct') return `direct\u0000${image.uri}`;
    return `session\u0000${image.sessionId}\u0000${image.filePath}\u0000${image.cacheKey ?? ''}`;
}

function collectMarkdownRemoteImages(
    text: string,
    remoteImageHosts: readonly string[],
    push: (image: AttachmentImagePreviewModalImage) => void,
): void {
    if (remoteImageHosts.length === 0 || !text.includes('![')) return;
    // The renderer's own segment split decides which markdown images the transcript paints.
    const segments = splitMarkdownRenderSegments({ markdown: text, streamingMode: 'static', remoteImageHosts });
    for (const segment of segments) {
        if (segment.type === 'remote-image') push(buildMarkdownRemoteViewerImage(segment.url, segment.alt));
    }
}

/**
 * All images the transcript of one chat shows, oldest first: allowed markdown images of agent
 * text, then the session media of each message (user attachments, tool results, generated
 * images). An image that occurs more than once is kept at its first position.
 */
export function collectChatGalleryImages(params: Readonly<{
    sessionId: string;
    messagesOldestFirst: readonly Message[];
    remoteImageHosts: readonly string[];
}>): AttachmentImagePreviewModalImage[] {
    const images: AttachmentImagePreviewModalImage[] = [];
    const seen = new Set<string>();
    const push = (image: AttachmentImagePreviewModalImage) => {
        const key = chatImageGalleryKey(image);
        if (seen.has(key)) return;
        seen.add(key);
        images.push(image);
    };

    for (const message of params.messagesOldestFirst) {
        if (message.kind === 'agent-text' && message.isThinking !== true) {
            collectMarkdownRemoteImages(message.text, params.remoteImageHosts, push);
        }
        if (message.meta == null) continue;
        for (const media of parseSessionMediaMessageMeta(message.meta).inlineImages) {
            const mimeType = resolveSessionMediaImageMimeType(media);
            if (mimeType) push(buildSessionMediaViewerImage(params.sessionId, media, mimeType));
        }
    }
    return images;
}

/**
 * The gallery and start index for a tapped image. An image that is not in the chat list (a
 * draft attachment, a file outside the transcript) opens with the images shown next to it,
 * or alone.
 */
export function resolveChatGallery(
    chatImages: readonly AttachmentImagePreviewModalImage[],
    tapped: AttachmentImagePreviewModalImage,
    siblings: readonly AttachmentImagePreviewModalImage[] = [],
): Readonly<{ images: readonly AttachmentImagePreviewModalImage[]; initialIndex: number }> {
    const key = chatImageGalleryKey(tapped);
    for (const images of [chatImages, siblings]) {
        const index = images.findIndex((image) => chatImageGalleryKey(image) === key);
        if (index >= 0) return { images, initialIndex: index };
    }
    return { images: [tapped], initialIndex: 0 };
}
