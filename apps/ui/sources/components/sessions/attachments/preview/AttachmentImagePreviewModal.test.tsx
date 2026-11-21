import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { invokeTestInstanceHandler, renderScreen } from '@/dev/testkit';
import { installReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { installSessionAttachmentCommonModuleMocks } from '@/components/sessions/attachments/sessionAttachmentTestHelpers';
import { registerSessionComposerAttachmentSink } from '@/components/sessions/attachments/sessionComposerAttachmentSink';
import { findGestureByKind, type TestGestureChain } from '@/dev/testkit/mocks/gestureHandler';

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

vi.mock('@/components/ui/layout/useChromeSafeAreaInsets', () => ({
    useChromeSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-status-bar', () => ({
    StatusBar: (props: Record<string, unknown>) => React.createElement('StatusBar', props, null),
}));

vi.mock('./markup/ImageMarkupEditor', () => ({
    ImageMarkupEditor: (props: Record<string, unknown>) => React.createElement('ImageMarkupEditor', props, null),
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

    // The first import of the viewer graph is slow on a busy machine; load it outside the test timeout.
    beforeAll(async () => {
        await import('./AttachmentImagePreviewModal');
    }, 180_000);

    beforeEach(() => {
        actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        previewState.value = { status: 'loaded', uri: 'data:image/png;base64,reset', svgXml: null, error: null };
    });

    afterEach(() => {
        actEnvironmentGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    });

    const twoImages = [
        { kind: 'direct', uri: 'blob:first', title: 'first.png' },
        { kind: 'direct', uri: 'blob:second', title: 'second.png' },
    ] as const;

    async function renderViewer(props: Partial<React.ComponentProps<typeof import('./AttachmentImagePreviewModal').AttachmentImagePreviewModal>> = {}) {
        const { AttachmentImagePreviewModal } = await import('./AttachmentImagePreviewModal');
        const setChrome = vi.fn();
        const onClose = vi.fn();
        const screen = await renderScreen(<AttachmentImagePreviewModal
            onClose={onClose}
            setChrome={setChrome}
            images={twoImages}
            initialIndex={0}
            {...props}
        />);
        return { screen, setChrome, onClose };
    }

    function titleText(screen: Awaited<ReturnType<typeof renderViewer>>['screen']): unknown {
        return screen.findByTestId('attachment-image-preview-title')?.props.children;
    }

    function currentZoomGesture(screen: Awaited<ReturnType<typeof renderViewer>>['screen']): TestGestureChain {
        const layer = screen.findByTestId('attachment-image-preview-gallery-current-layer');
        const detector = layer?.findAll((node) => node.props?.testID === 'attachment-image-preview-zoom-gesture')[0];
        if (!detector) throw new Error('zoom gesture not found');
        return detector.props.gesture as TestGestureChain;
    }

    function deckGesture(screen: Awaited<ReturnType<typeof renderViewer>>['screen']): TestGestureChain {
        return screen.findByTestId('attachment-image-preview-gallery-gesture-detector')?.props.gesture as TestGestureChain;
    }

    function tap(screen: Awaited<ReturnType<typeof renderViewer>>['screen'], taps: number, event = { x: 10, y: 10 }): void {
        const exclusive = findGestureByKind(currentZoomGesture(screen), 'exclusive');
        const gesture = exclusive?.__gestures?.find((child) => child.__config.numberOfTaps === taps);
        act(() => {
            gesture?.__handlers.onEnd(event, true);
        });
    }

    it('fills the whole screen instead of a card', async () => {
        const { setChrome } = await renderViewer();
        expect(setChrome).toHaveBeenCalledWith({ kind: 'fullscreen' });
        expect(setChrome).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'card' }));
    });

    it('shows light status bar icons over the black screen', async () => {
        const { screen } = await renderViewer();
        expect(screen.findByType('StatusBar' as never).props.style).toBe('light');
    });

    it('renders the current direct image with inline width and height sizing for expo-image', async () => {
        const { screen } = await renderViewer({ images: [{ kind: 'direct', uri: 'blob:first', title: 'first.png' }] });

        const image = screen.findByType('Image');
        expect(image.props.source).toEqual({ uri: 'blob:first' });
        expect(image.props.contentFit).toBe('contain');
        expect(Array.isArray(image.props.style)).toBe(true);
        expect(image.props.style[0]).toEqual({ width: '100%', height: '100%' });
    });

    it('shows the file name in the top pill, shortened in the middle', async () => {
        const { screen } = await renderViewer({
            images: [{ kind: 'direct', uri: 'blob:first', title: '1000012345678901234567.jpg' }],
        });
        const title = titleText(screen);
        expect(typeof title).toBe('string');
        expect(title).toMatch(/^1000.*\.\.\..*\.jpg$/);
        expect((title as string).length).toBeLessThan('1000012345678901234567.jpg'.length);
    });

    it('shows round edit, share, save and close buttons, and close closes', async () => {
        registerSessionComposerAttachmentSink('s-buttons', vi.fn());
        const { screen, onClose } = await renderViewer({ sessionId: 's-buttons' });
        for (const id of ['edit', 'share', 'save', 'close']) {
            expect(screen.findByTestId(`attachment-image-preview-${id}`)).not.toBeNull();
        }
        await screen.pressByTestIdAsync('attachment-image-preview-close');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides edit when no composer can take the result', async () => {
        const { screen } = await renderViewer();
        expect(screen.findByTestId('attachment-image-preview-edit')).toBeNull();
    });

    it('shows the position in the bottom pill only when the gallery has more than one image', async () => {
        const { screen } = await renderViewer({ initialIndex: 1 });
        expect(screen.findByTestId('attachment-image-preview-index')?.props.children).toBe('files.imageViewer.position');

        const single = await renderViewer({ images: [{ kind: 'direct', uri: 'blob:first', title: 'first.png' }] });
        expect(single.screen.findByTestId('attachment-image-preview-index')).toBeNull();
    });

    it('hides navigation until hover on web', async () => {
        const { screen } = await renderViewer();

        expect(screen.findAllByTestId('attachment-image-preview-previous')).toHaveLength(0);
        expect(screen.findAllByTestId('attachment-image-preview-next')).toHaveLength(0);

        act(() => {
            invokeTestInstanceHandler(screen.findByTestId('attachment-image-preview-surface'), 'onHoverIn', undefined, 'attachment-image-preview-surface');
        });

        expect(screen.findAllByTestId('attachment-image-preview-previous')).toHaveLength(1);
        expect(screen.findAllByTestId('attachment-image-preview-next')).toHaveLength(1);
    });

    it('navigates between direct images after hover', async () => {
        const { screen } = await renderViewer();

        act(() => {
            invokeTestInstanceHandler(screen.findByTestId('attachment-image-preview-surface'), 'onHoverIn', undefined, 'attachment-image-preview-surface');
        });

        await screen.pressByTestIdAsync('attachment-image-preview-next');

        const currentLayer = screen.findByTestId('attachment-image-preview-gallery-current-layer');
        expect(currentLayer).not.toBeNull();
        expect(currentLayer!.findByType('Image').props.source).toEqual({ uri: 'blob:second' });
        expect(titleText(screen)).toBe('second.png');
    });

    it('renders session-backed images through the shared session preview hook', async () => {
        const { screen } = await renderViewer({
            images: [{
                kind: 'session-image',
                title: 'from-transcript.png',
                sessionId: 's1',
                filePath: '.happier/uploads/messages/m1/file.png',
                mimeType: 'image/png',
                sizeBytes: 10,
                cacheKey: 'hash',
            }],
        });

        expect(screen.findByType('Image').props.source).toEqual({
            uri: 'data:image/png;base64,.happier/uploads/messages/m1/file.png',
        });
    });

    it('shows a generic localized error instead of raw preview details', async () => {
        previewState.value = { status: 'error', uri: null, svgXml: null, error: 'internal disk path leaked' };
        const { screen } = await renderViewer({
            images: [{
                kind: 'session-image',
                title: 'broken.png',
                sessionId: 's1',
                filePath: '.happier/uploads/messages/m1/file.png',
                mimeType: 'image/png',
                sizeBytes: 10,
                cacheKey: 'hash',
            }],
        });

        const textNodes = screen.findAll((node) => node.props?.children === 'common.error');
        expect(textNodes.length).toBeGreaterThan(0);
        expect(() => screen.find((node) => node.props?.children === 'internal disk path leaked')).toThrow();
    });

    it('swipes to the next image of the gallery', async () => {
        const { screen } = await renderViewer();

        const gesture = deckGesture(screen);
        act(() => {
            gesture.__handlers.onUpdate?.({ translationX: -200 });
            gesture.__handlers.onEnd?.({ translationX: -200 });
        });

        expect(titleText(screen)).toBe('second.png');
    });

    it('turns the gallery swipe off while the image is zoomed', async () => {
        const { screen } = await renderViewer();
        expect(deckGesture(screen).__config.enabled).toBe(true);

        tap(screen, 2);
        expect(deckGesture(screen).__config.enabled).toBe(false);

        tap(screen, 2);
        expect(deckGesture(screen).__config.enabled).toBe(true);
    });

    it('hides and shows the buttons on a single tap', async () => {
        const { screen } = await renderViewer();
        tap(screen, 1);
        expect(screen.findByTestId('attachment-image-preview-close')).toBeNull();
        tap(screen, 1);
        expect(screen.findByTestId('attachment-image-preview-close')).not.toBeNull();
    });

    it('shares the loaded image with the Web Share API', async () => {
        const share = vi.fn(async (_data: { files?: File[] }) => {});
        vi.stubGlobal('navigator', { canShare: () => true, share });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }))));

        try {
            const { screen } = await renderViewer({ images: [{ kind: 'direct', uri: 'blob:first', title: 'first.png' }] });
            await screen.pressByTestIdAsync('attachment-image-preview-share');

            expect(share.mock.calls[0]?.[0].files?.[0]?.name).toBe('first.png');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('adds the marked-up image to the session composer and closes', async () => {
        const sink = vi.fn();
        const unregister = registerSessionComposerAttachmentSink('s-edit', sink);
        try {
            const { screen, onClose } = await renderViewer({ sessionId: 's-edit' });
            await screen.pressByTestIdAsync('attachment-image-preview-edit');

            const editor = screen.findByType('ImageMarkupEditor' as never);
            expect(editor.props.uri).toBe('blob:first');
            expect(editor.props.fileName).toBe('first.png');

            const attachment = { kind: 'native', uri: 'file:///cache/shot.png', name: 'first-markup.png', mimeType: 'image/png' };
            act(() => {
                editor.props.onDone(attachment);
            });

            expect(sink).toHaveBeenCalledWith([attachment]);
            expect(onClose).toHaveBeenCalledTimes(1);
        } finally {
            unregister();
        }
    });

    it('returns to the viewer when the markup is cancelled', async () => {
        const unregister = registerSessionComposerAttachmentSink('s-cancel', vi.fn());
        try {
            const { screen } = await renderViewer({ sessionId: 's-cancel' });
            await screen.pressByTestIdAsync('attachment-image-preview-edit');
            act(() => {
                screen.findByType('ImageMarkupEditor' as never).props.onCancel();
            });
            expect(screen.findAllByType('ImageMarkupEditor' as never)).toHaveLength(0);
            expect(screen.findByTestId('attachment-image-preview-close')).not.toBeNull();
        } finally {
            unregister();
        }
    });
});
