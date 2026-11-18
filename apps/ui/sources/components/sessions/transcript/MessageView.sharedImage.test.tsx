import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPartialStorageModuleMock, renderScreen, standardCleanup } from '@/dev/testkit';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { TranscriptSharedImagesContext } from '@/components/sessions/sessionMedia/TranscriptSharedImagesContext';
import { estimateTranscriptRowHeightFromContent } from './measurement/estimateTranscriptRowHeightFromCache';
import { installMessageViewCommonModuleMocks } from './messageViewTestHelpers';

const previewState = vi.hoisted(() => ({ status: 'loading' as 'loading' | 'loaded' }));

installMessageViewCommonModuleMocks({
    storage: async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
        useSetting: (key: keyof typeof settingsDefaults) => settingsDefaults[key],
    }),
});

vi.mock('@/components/sessions/files/content/imagePreview/useSessionImagePreview', () => ({
    useSessionImagePreview: () => previewState.status === 'loaded'
        ? { status: 'loaded', uri: 'blob:preview', svgXml: null, error: null }
        : { status: 'loading', uri: null, svgXml: null, error: null },
}));

afterEach(() => {
    previewState.status = 'loading';
    standardCleanup();
});

const imagePath = '.happier/uploads/artifacts/show-image/chart.png';
const TRANSCRIPT_CONTENT_WIDTH_PX = 360;

function showImageMessage(): ToolCallMessage {
    return {
        kind: 'tool-call', id: 'show-image', localId: null, createdAt: 1, children: [],
        tool: {
            id: 'show-1', name: 'mcp__happier__show_image', state: 'completed',
            input: { path: 'chart.png' },
            createdAt: 1, startedAt: 1, completedAt: 2, description: null, result: {},
        },
        meta: { happierMedia: { kind: 'session_media.v1', payload: { media: [{
            id: 'media-1', role: 'output', category: 'tool-artifact', mediaKind: 'image',
            mimeType: 'image/png', name: 'chart.png', path: imagePath, sizeBytes: 80,
            width: 1000, height: 333,
            origin: { source: 'tool-output', toolCallId: 'show-1' },
        }] } } },
    };
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    if (style && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

function findToolRowHeader(screen: Awaited<ReturnType<typeof renderScreen>>) {
    return screen.findByTestId('tool-timeline-row') ?? screen.findByTestId('tool-view-header-primary');
}

function estimateRowPx(message: ToolCallMessage, sharedImagesEnabled: boolean): number | undefined {
    return estimateTranscriptRowHeightFromContent({
        getMessageById: () => message,
        item: { kind: 'message', id: message.id, messageId: message.id, createdAt: 1, seq: null },
        toolCallsGroupChromeVariant: 'feed',
        platformIsWeb: false,
        uiFontScale: 1,
        transcriptContentWidthPx: TRANSCRIPT_CONTENT_WIDTH_PX,
        sharedImagesEnabled,
    });
}

describe('show_image in the transcript', () => {
    it('paints the image box the row estimate sized, before and after the image loads', async () => {
        const { MessageView } = await import('./MessageView');
        const message = showImageMessage();
        const interaction = deriveTranscriptInteraction({ kind: 'session', accessLevel: null, canApprovePermissions: true, isSessionActive: true });
        const sharedImages = { transcriptContentWidthPx: TRANSCRIPT_CONTENT_WIDTH_PX };
        // A fresh message object makes the memoized row render again with the loaded preview.
        const render = () => (
            <TranscriptSharedImagesContext.Provider value={sharedImages}>
                <MessageView message={{ ...message }} metadata={null} sessionId="s1" interaction={interaction} />
            </TranscriptSharedImagesContext.Provider>
        );

        const screen = await renderScreen(render());
        const boxTestID = `transcript-shared-image-box:${imagePath}`;
        // 360 - 2 x 16 margin = 328 px wide; 328 * 333 / 1000 snaps to 109 px at the stub's pixel ratio of 2.
        const expectedBox = { width: 328, height: 109 };
        expect(flattenStyle(screen.findByTestId(boxTestID)?.props.style)).toMatchObject(expectedBox);
        expect(findToolRowHeader(screen)).toBeNull();
        // The row is the image box plus the 22 px under it, as under a reply.
        expect(estimateRowPx(message, true)).toBe(expectedBox.height + 22);

        previewState.status = 'loaded';
        await screen.update(render());
        expect(flattenStyle(screen.findByTestId(boxTestID)?.props.style)).toMatchObject(expectedBox);
        expect(screen.findByTestId(`transcript-shared-image-preview:${imagePath}`)?.props.resizeMode).toBe('contain');
    });

    it('renders a normal tool call with a thumbnail when the setting is off', async () => {
        const { MessageView } = await import('./MessageView');
        const message = showImageMessage();
        // No provider: the list leaves it out while `transcriptSharedImagesEnabled` is off.
        const screen = await renderScreen(
            <MessageView message={message} metadata={null} sessionId="s1" interaction={deriveTranscriptInteraction({ kind: 'public' })} />,
        );
        expect(screen.findByTestId(`transcript-shared-image-box:${imagePath}`)).toBeNull();
        expect(findToolRowHeader(screen)).not.toBeNull();
        expect(estimateRowPx(message, false)).not.toBe(109 + 22);
    });
});
