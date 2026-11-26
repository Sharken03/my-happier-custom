import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { installSessionAttachmentCommonModuleMocks } from '../sessionAttachmentTestHelpers';

const platform = vi.hoisted(() => ({ OS: 'android' }));
const startDownload = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

installSessionAttachmentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        // A getter, so each test can switch the platform after the module mock is built.
        return createReactNativeWebMock({ Platform: { get OS() { return platform.OS; } } as any });
    },
});

vi.mock('@/hooks/session/files/useWorkspaceFileTransfers', () => ({
    useWorkspaceFileTransfers: () => ({
        downloadState: { status: 'idle' },
        startDownload,
    }),
}));

const pdf = { name: 'report.pdf', path: '.happier/uploads/messages/m1/report.pdf', mimeType: 'application/pdf', sizeBytes: 2048 };
const text = { name: 'notes.txt', path: '.happier/uploads/messages/m1/notes.txt', mimeType: 'text/plain', sizeBytes: 12 };

async function renderRow(props: Record<string, unknown>) {
    const { AttachmentsMessageRow } = await import('./AttachmentsMessageRow');
    return renderScreen(React.createElement(AttachmentsMessageRow, props as any));
}

describe('AttachmentsMessageRow PDF chips', () => {
    beforeEach(() => {
        platform.OS = 'android';
        startDownload.mockClear();
    });

    it('opens a PDF in the system viewer on Android, and other files in the file screen', async () => {
        const onOpenPath = vi.fn();
        const screen = await renderRow({ attachments: [pdf, text], onOpenPath, sessionId: 's1' });

        await screen.pressByTestIdAsync('message-attachment-pdf-chip');
        expect(startDownload).toHaveBeenCalledWith({ path: pdf.path, asZip: false, action: 'open' });
        expect(onOpenPath).not.toHaveBeenCalled();
        expect(screen.findAllByTestId('message-attachment-pdf-chip')).toHaveLength(1);
    });

    it('keeps the file screen for a PDF off Android or without a session id', async () => {
        platform.OS = 'ios';
        const onIos = await renderRow({ attachments: [pdf], onOpenPath: vi.fn(), sessionId: 's1' });
        expect(onIos.findByTestId('message-attachment-pdf-chip')).toBeNull();

        platform.OS = 'android';
        const noSession = await renderRow({ attachments: [pdf], onOpenPath: vi.fn() });
        expect(noSession.findByTestId('message-attachment-pdf-chip')).toBeNull();
    });

    it('detects a PDF by its name when the mime type is missing', async () => {
        const { isPdfAttachment } = await import('./AttachmentsMessageRow');
        expect(isPdfAttachment({ name: 'Scan.PDF' })).toBe(true);
        expect(isPdfAttachment({ name: 'scan.png', mimeType: 'image/png' })).toBe(false);
    });
});
