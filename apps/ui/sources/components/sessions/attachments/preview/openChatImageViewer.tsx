import * as React from 'react';

import { resolveMarkdownRemoteImageHosts } from '@/components/markdown/rendering/markdownRemoteImages';
import { Modal } from '@/modal';
import type { Message } from '@/sync/domains/messages/messageTypes';
import { storage } from '@/sync/domains/state/storage';
import { settingsDefaults } from '@/sync/domains/settings/settings';

import { AttachmentImagePreviewModal, type AttachmentImagePreviewModalImage } from './AttachmentImagePreviewModal';
import { collectChatGalleryImages, resolveChatGallery } from './chatImageGallery';

/**
 * The chat that a transcript subtree belongs to. Markdown images use it to open the gallery of
 * their chat; outside a chat the viewer shows the tapped image alone.
 */
const ChatImageGallerySessionContext = React.createContext<string | null>(null);

export const ChatImageGallerySessionProvider = ChatImageGallerySessionContext.Provider;

export function useChatImageGallerySessionId(): string | null {
    return React.useContext(ChatImageGallerySessionContext);
}

function readChatImages(sessionId: string): readonly AttachmentImagePreviewModalImage[] {
    // One snapshot read at tap time: the open viewer keeps this list and subscribes to nothing.
    const state = storage.getState();
    const session = state.sessionMessages[sessionId];
    if (!session) return [];
    const messagesOldestFirst: Message[] = [];
    for (const id of session.messageIdsOldestFirst) {
        const message = session.messagesById[id];
        if (message) messagesOldestFirst.push(message);
    }
    const remoteImageHosts = resolveMarkdownRemoteImageHosts({
        enabled: state.settings?.transcriptMarkdownRemoteImagesEnabled ?? settingsDefaults.transcriptMarkdownRemoteImagesEnabled,
        hosts: state.settings?.transcriptMarkdownRemoteImageHosts ?? settingsDefaults.transcriptMarkdownRemoteImageHosts,
    });
    return collectChatGalleryImages({ sessionId, messagesOldestFirst, remoteImageHosts });
}

/**
 * Opens the fullscreen viewer at `image`. With a chat, the user can swipe through every image of
 * that chat in transcript order. When the chat does not list the image, the viewer shows
 * `siblings` (the images shown next to it), or the image alone.
 */
export function openChatImageViewer(params: Readonly<{
    sessionId: string | null;
    image: AttachmentImagePreviewModalImage;
    siblings?: readonly AttachmentImagePreviewModalImage[];
}>): void {
    const chatImages = params.sessionId ? readChatImages(params.sessionId) : [];
    const gallery = resolveChatGallery(chatImages, params.image, params.siblings);
    Modal.show({
        component: AttachmentImagePreviewModal,
        props: { images: gallery.images, initialIndex: gallery.initialIndex, sessionId: params.sessionId },
        // Fullscreen from the first frame, so the viewer never shows a card while it mounts.
        chrome: { kind: 'fullscreen' },
    });
}
