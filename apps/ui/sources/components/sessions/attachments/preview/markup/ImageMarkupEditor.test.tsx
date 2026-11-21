import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';
import { findGestureByKind, type TestGestureChain } from '@/dev/testkit/mocks/gestureHandler';
import { installSessionAttachmentCommonModuleMocks } from '@/components/sessions/attachments/sessionAttachmentTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installSessionAttachmentCommonModuleMocks();

vi.mock('expo-image', () => ({
    Image: (props: Record<string, unknown>) => React.createElement('Image', props, null),
}));
vi.mock('react-native-svg', () => ({
    __esModule: true,
    default: (props: Record<string, unknown>) => React.createElement('Svg', props, props.children as React.ReactNode),
    Path: (props: Record<string, unknown>) => React.createElement('Path', props, null),
}));
vi.mock('@/components/ui/layout/useChromeSafeAreaInsets', () => ({
    useChromeSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const flatten = vi.hoisted(() => ({
    web: vi.fn(async (_params: unknown) => ({ kind: 'web', file: { name: 'cat-markup.png' } })),
    native: vi.fn(async (_params: unknown) => ({ kind: 'native', uri: 'file:///cache/shot.png', name: 'cat-markup.png', mimeType: 'image/png' })),
}));
vi.mock('./flattenMarkupImage', () => ({
    flattenMarkupImageOnWeb: flatten.web,
    flattenMarkupImageOnNative: flatten.native,
}));

async function renderEditor() {
    const { ImageMarkupEditor } = await import('./ImageMarkupEditor');
    const onCancel = vi.fn();
    const onDone = vi.fn();
    const screen = await renderScreen(
        <ImageMarkupEditor uri="blob:cat" fileName="cat.jpg" onCancel={onCancel} onDone={onDone} />,
    );
    act(() => {
        screen.findByTestId('image-markup-stage')?.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 400 } } });
        screen.findByType('Image' as never).props.onLoad?.({ source: { width: 200, height: 100 } });
    });
    const pan = () => findGestureByKind(screen.findByTestId('image-markup-canvas-gesture')?.props.gesture as TestGestureChain, 'pan')!;
    const draw = (points: ReadonlyArray<[number, number]>) => {
        act(() => {
            pan().__handlers.onBegin({ x: points[0][0], y: points[0][1] });
            for (const [x, y] of points.slice(1)) pan().__handlers.onUpdate({ x, y });
            pan().__handlers.onEnd({}, true);
        });
    };
    return { screen, onCancel, onDone, draw };
}

describe('ImageMarkupEditor', () => {
    it('fits the drawing area to the image', async () => {
        const { screen } = await renderEditor();
        const canvas = screen.findByTestId('image-markup-canvas');
        expect(canvas?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 400, height: 200 })]));
    });

    it('draws a stroke with the chosen color and removes it with undo', async () => {
        const { screen, draw } = await renderEditor();
        await screen.pressByTestIdAsync('image-markup-color-#0a84ff');
        draw([[10, 10], [100, 50], [200, 100]]);

        const paths = screen.findAllByType('Path' as never);
        expect(paths).toHaveLength(1);
        expect(paths[0].props.stroke).toBe('#0a84ff');
        expect(paths[0].props.d).toBe('M10 10 L100 50 L200 100');

        await screen.pressByTestIdAsync('image-markup-undo');
        expect(screen.findAllByType('Path' as never)).toHaveLength(0);
    });

    it('cancels without output', async () => {
        const { screen, onCancel, onDone } = await renderEditor();
        await screen.pressByTestIdAsync('image-markup-cancel');
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onDone).not.toHaveBeenCalled();
    });

    it('flattens the strokes onto the image and hands over the file on done', async () => {
        const { screen, onDone, draw } = await renderEditor();
        draw([[0, 0], [400, 200]]);

        await screen.pressByTestIdAsync('image-markup-done');

        expect(flatten.web).toHaveBeenCalledWith(expect.objectContaining({
            sourceUri: 'blob:cat',
            fileName: 'cat.jpg',
            strokes: [expect.objectContaining({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })],
        }));
        expect(onDone).toHaveBeenCalledWith({ kind: 'web', file: { name: 'cat-markup.png' } });
    });

    it('turns done off until there is a stroke', async () => {
        const { screen } = await renderEditor();
        expect(screen.findByTestId('image-markup-done')?.props.disabled).toBe(true);
    });
});
