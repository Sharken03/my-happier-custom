import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';

import { collectChatGalleryImages, resolveChatGallery } from './chatImageGallery';

function sessionMediaMeta(entries: ReadonlyArray<Readonly<{ name: string; path: string; sha256?: string }>>) {
    return {
        happier: {
            kind: 'session_media.v1',
            payload: {
                media: entries.map((entry, index) => ({
                    id: `media-${index}`,
                    role: 'output',
                    category: 'tool-artifact',
                    mediaKind: 'image',
                    name: entry.name,
                    path: entry.path,
                    mimeType: 'image/png',
                    sizeBytes: 10,
                    ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
                    origin: { source: 'provider-generated' },
                })),
            },
        },
    } as unknown as Message['meta'];
}

const SHA_A = 'a'.repeat(64);

function userText(id: string, meta?: Message['meta']): Message {
    return { kind: 'user-text', id, localId: null, createdAt: 1, text: 'hi', ...(meta ? { meta } : {}) };
}

function agentText(id: string, text: string, extra: Partial<Extract<Message, { kind: 'agent-text' }>> = {}): Message {
    return { kind: 'agent-text', id, localId: null, createdAt: 1, text, ...extra };
}

function toolCall(id: string, meta: Message['meta']): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1,
        children: [],
        meta,
        tool: { name: 'Read', state: 'completed', input: {}, createdAt: 1, startedAt: 1, completedAt: 1, description: null },
    } as unknown as Message;
}

describe('collectChatGalleryImages', () => {
    it('lists markdown images and session media of every message in transcript order, once each', () => {
        const messages: Message[] = [
            userText('u1', sessionMediaMeta([{ name: 'upload.png', path: '.happier/uploads/u1/upload.png', sha256: SHA_A }])),
            agentText('a1', 'Look:\n\n![chart](https://img.example.org/chart.png)\n\nDone.'),
            agentText('a-thinking', '![hidden](https://img.example.org/hidden.png)', { isThinking: true }),
            toolCall('t1', sessionMediaMeta([
                { name: 'shot.png', path: 'repo/shot.png' },
                // The same upload again: it keeps its first position.
                { name: 'upload.png', path: '.happier/uploads/u1/upload.png', sha256: SHA_A },
            ])),
            agentText('a2', '![blocked](https://other.example.com/x.png)'),
        ];

        const images = collectChatGalleryImages({
            sessionId: 's1',
            messagesOldestFirst: messages,
            remoteImageHosts: ['img.example.org'],
        });

        expect(images.map((image) => image.title)).toEqual(['upload.png', 'chart', 'shot.png']);
        expect(images[0]).toMatchObject({ kind: 'session-image', sessionId: 's1', cacheKey: SHA_A });
        expect(images[1]).toEqual({ kind: 'direct', uri: 'https://img.example.org/chart.png', title: 'chart' });
    });

    it('skips markdown images while no host is allowed', () => {
        const images = collectChatGalleryImages({
            sessionId: 's1',
            messagesOldestFirst: [agentText('a1', '![chart](https://img.example.org/chart.png)')],
            remoteImageHosts: [],
        });
        expect(images).toEqual([]);
    });
});

describe('resolveChatGallery', () => {
    const chat = collectChatGalleryImages({
        sessionId: 's1',
        messagesOldestFirst: [
            toolCall('t1', sessionMediaMeta([{ name: 'one.png', path: 'repo/one.png' }])),
            toolCall('t2', sessionMediaMeta([{ name: 'two.png', path: 'repo/two.png' }])),
        ],
        remoteImageHosts: [],
    });

    it('starts at the tapped image inside the whole chat gallery', () => {
        const tapped = { kind: 'session-image', title: 'two.png', sessionId: 's1', filePath: 'repo/two.png', mimeType: 'image/png', sizeBytes: 10, cacheKey: null } as const;
        expect(resolveChatGallery(chat, tapped)).toEqual({ images: chat, initialIndex: 1 });
    });

    it('falls back to the images next to the tapped one when the chat does not list it', () => {
        const first = { kind: 'direct', uri: 'file:///a.png', title: 'a.png' } as const;
        const second = { kind: 'direct', uri: 'file:///b.png', title: 'b.png' } as const;
        expect(resolveChatGallery(chat, second, [first, second])).toEqual({ images: [first, second], initialIndex: 1 });
    });

    it('opens an image that is not in the chat alone', () => {
        const draft = { kind: 'direct', uri: 'file:///draft.png', title: 'draft.png' } as const;
        expect(resolveChatGallery(chat, draft)).toEqual({ images: [draft], initialIndex: 0 });
    });
});
