import { beforeEach, describe, expect, it, vi } from 'vitest';

const modal = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    const mock = createModalModuleMock();
    modal.show = mock.spies.show;
    return mock.module;
});
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

import type { Message } from '@/sync/domains/messages/messageTypes';
import { storage } from '@/sync/domains/state/storage';

import { openChatImageViewer } from './openChatImageViewer';

function toolResultWithImage(id: string, path: string): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1,
        children: [],
        tool: { name: 'Read', state: 'completed', input: {}, createdAt: 1, startedAt: 1, completedAt: 1, description: null },
        meta: {
            happier: {
                kind: 'session_media.v1',
                payload: {
                    media: [{
                        id: `media-${id}`,
                        role: 'output',
                        category: 'tool-artifact',
                        mediaKind: 'image',
                        name: path,
                        path,
                        mimeType: 'image/png',
                        sizeBytes: 10,
                        origin: { source: 'tool-output' },
                    }],
                },
            },
        },
    } as unknown as Message;
}

function seedChat(messages: readonly Message[]) {
    const current = storage.getState().sessionMessages;
    storage.setState({
        sessionMessages: {
            ...current,
            s1: {
                ...(current.s1 ?? {}),
                messageIdsOldestFirst: messages.map((message) => message.id),
                messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
            } as never,
        },
    });
}

describe('openChatImageViewer', () => {
    beforeEach(() => {
        modal.show.mockClear();
    });

    it('opens the gallery of the whole chat at the tapped tool-result image', () => {
        seedChat([toolResultWithImage('t1', 'one.png'), toolResultWithImage('t2', 'two.png')]);

        openChatImageViewer({
            sessionId: 's1',
            image: { kind: 'session-image', title: 'two.png', sessionId: 's1', filePath: 'two.png', mimeType: 'image/png', sizeBytes: 10, cacheKey: null },
        });

        const props = modal.show.mock.calls[0]?.[0]?.props as { images: Array<{ title: string }>; initialIndex: number };
        expect(props.images.map((image) => image.title)).toEqual(['one.png', 'two.png']);
        expect(props.initialIndex).toBe(1);
    });

    it('opens fullscreen and passes the session for markup', () => {
        seedChat([toolResultWithImage('t1', 'one.png')]);

        openChatImageViewer({
            sessionId: 's1',
            image: { kind: 'session-image', title: 'one.png', sessionId: 's1', filePath: 'one.png', mimeType: 'image/png', sizeBytes: 10, cacheKey: null },
        });

        const config = modal.show.mock.calls[0]?.[0] as { chrome?: unknown; props: { sessionId?: string } };
        expect(config.chrome).toEqual({ kind: 'fullscreen' });
        expect(config.props.sessionId).toBe('s1');
    });
});
