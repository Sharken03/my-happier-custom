import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { invokeTestInstanceHandler, renderScreen } from '@/dev/testkit';
import { installReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { installSessionAttachmentCommonModuleMocks } from '@/components/sessions/attachments/sessionAttachmentTestHelpers';

const actEnvironmentGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

type PreviewState =
    | { status: 'loaded'; uri: string; svgXml: string | null; error: null }
    | { status: 'error'; uri: null; svgXml: null; error: string };

const previewState = vi.hoisted(() => ({
    value: { status: 'loaded', uri: 'data:image/png;base64,.happier/uploads/messages/m1/file.png', svgXml: null, error: null } as PreviewState,
}));

installSessionAttachmentCommonModuleMocks({
    reactNative: installReactNativeWebMock({
        useWindowDimensions: () => ({ width: 900, height: 700 }),
    }),
});

vi.mock('expo-image', () => ({
    Image: (props: Record<string, unknown>) => React.createElement('Image', props, null),
}));

// Reduced motion lands each swipe and button commit at once, without a spring callback.
vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({
    useReducedMotionPreference: () => true,
}));

vi.mock('@/components/sessions/files/content/imagePreview/useSessionImagePreview', () => ({
    useSessionImagePreview: (input: { enabled: boolean; filePath: string }) => {
        if (!input.enabled) {
            return { status: 'disabled', uri: null, error: null };
        }
        if (previewState.value.status === 'error') {
            return previewState.value;
        }
        return { ...previewState.value, uri: `data:image/png;base64,${input.filePath}` };
    },
}));

describe('AttachmentImagePreviewModal', () => {
    const previousActEnvironment = actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT;

    beforeEach(() => {
        actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        previewState.value = { status: 'loaded', uri: 'data:image/png;base64,reset', svgXml: null, error: null };
    });

    afterEach(() => {
        actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    });

    it('renders the current direct image with inline width and height sizing for expo-image', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                { kind: 'direct', uri: 'blob:first', title: 'first.png' },
            ]}
            initialIndex={0}
        />);

        const image = screen.findByType('Image');
        expect(image.props.source).toEqual({ uri: 'blob:first' });
        expect(Array.isArray(image.props.style)).toBe(true);
        expect(image.props.style[0]).toEqual({ width: '100%', height: '100%' });
    });

    it('hides navigation until hover on web', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                { kind: 'direct', uri: 'blob:first', title: 'first.png' },
                { kind: 'direct', uri: 'blob:second', title: 'second.png' },
            ]}
            initialIndex={0}
        />);

        expect(screen.findAllByTestId('attachment-image-preview-previous')).toHaveLength(0);
        expect(screen.findAllByTestId('attachment-image-preview-next')).toHaveLength(0);

        act(() => {
            invokeTestInstanceHandler(screen.findByTestId('attachment-image-preview-surface'), 'onHoverIn', undefined, 'attachment-image-preview-surface');
        });

        expect(screen.findAllByTestId('attachment-image-preview-previous')).toHaveLength(1);
        expect(screen.findAllByTestId('attachment-image-preview-next')).toHaveLength(1);
    });

    it('navigates between direct images after hover', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                { kind: 'direct', uri: 'blob:first', title: 'first.png' },
                { kind: 'direct', uri: 'blob:second', title: 'second.png' },
            ]}
            initialIndex={0}
        />);

        act(() => {
            invokeTestInstanceHandler(screen.findByTestId('attachment-image-preview-surface'), 'onHoverIn', undefined, 'attachment-image-preview-surface');
        });

        await screen.pressByTestIdAsync('attachment-image-preview-next');

        const currentLayer = screen.findByTestId('attachment-image-preview-gallery-current-layer');
        expect(currentLayer.findByType('Image').props.source).toEqual({ uri: 'blob:second' });
        expect(setChrome).toHaveBeenLastCalledWith(
            expect.objectContaining({
                kind: 'card',
                title: 'second.png',
                titleTestID: 'attachment-image-preview-title',
            }),
        );
    });

    it('renders session-backed images through the shared session preview hook', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                {
                    kind: 'session-image',
                    title: 'from-transcript.png',
                    sessionId: 's1',
                    filePath: '.happier/uploads/messages/m1/file.png',
                    mimeType: 'image/png',
                    sizeBytes: 10,
                    cacheKey: 'hash',
                },
            ]}
            initialIndex={0}
        />);

        expect(screen.findByType('Image').props.source).toEqual({
            uri: 'data:image/png;base64,.happier/uploads/messages/m1/file.png',
        });
    });

    it('shows a generic localized error instead of raw preview details', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        previewState.value = { status: 'error', uri: null, svgXml: null, error: 'internal disk path leaked' };
        const setChrome = vi.fn();

        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                {
                    kind: 'session-image',
                    title: 'broken.png',
                    sessionId: 's1',
                    filePath: '.happier/uploads/messages/m1/file.png',
                    mimeType: 'image/png',
                    sizeBytes: 10,
                    cacheKey: 'hash',
                },
            ]}
            initialIndex={0}
        />);

        const textNodes = screen.findAll((node) => node.props?.children === 'common.error');
        expect(textNodes.length).toBeGreaterThan(0);
        expect(() => screen.find((node) => node.props?.children === 'internal disk path leaked')).toThrow();
    });
    it('shows the position of the current image when the gallery has more than one', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();

        await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                { kind: 'direct', uri: 'blob:first', title: 'first.png' },
                { kind: 'direct', uri: 'blob:second', title: 'second.png' },
            ]}
            initialIndex={1}
        />);

        expect(setChrome).toHaveBeenLastCalledWith(expect.objectContaining({
            title: 'second.png',
            subtitle: 'files.imageViewer.position',
            subtitleTestID: 'attachment-image-preview-index',
        }));
    });

    it('swipes to the next image of the gallery', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();

        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={() => {}}
            setChrome={setChrome}
            images={[
                { kind: 'direct', uri: 'blob:first', title: 'first.png' },
                { kind: 'direct', uri: 'blob:second', title: 'second.png' },
            ]}
            initialIndex={0}
        />);

        const gesture = screen.findByType('GestureDetector').props.gesture as {
            __handlers: Record<string, (event: { translationX: number }) => void>;
        };
        act(() => {
            gesture.__handlers.onUpdate?.({ translationX: -200 });
            gesture.__handlers.onEnd?.({ translationX: -200 });
        });

        expect(setChrome).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'second.png' }));
    });

    it('shares the loaded image from the header with the Web Share API', async () => {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();
        const share = vi.fn(async (_data: { files?: File[] }) => {});
        vi.stubGlobal('navigator', { canShare: () => true, share });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }))));

        try {
            await renderScreen(<AttachmentImagePreviewModal
                onClose={() => {}}
                setChrome={setChrome}
                images={[{ kind: 'direct', uri: 'blob:first', title: 'first.png' }]}
                initialIndex={0}
            />);

            const chrome = setChrome.mock.calls.at(-1)?.[0] as { actions: React.ReactElement };
            const header = await renderScreen(chrome.actions);
            await header.pressByTestIdAsync('attachment-image-preview-share');

            expect(share.mock.calls[0]?.[0].files?.[0]?.name).toBe('first.png');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
