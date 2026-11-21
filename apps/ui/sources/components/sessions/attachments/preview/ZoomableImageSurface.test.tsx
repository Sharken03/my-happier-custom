import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';
import { findGestureByKind, type TestGestureChain } from '@/dev/testkit/mocks/gestureHandler';
import { installReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';

installReactNativeWebMock();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderSurface(props: Partial<React.ComponentProps<typeof import('./ZoomableImageSurface').ZoomableImageSurface>> = {}) {
    const { ZoomableImageSurface } = await import('./ZoomableImageSurface');
    const onZoomedChange = vi.fn();
    const onSingleTap = vi.fn();
    const screen = await renderScreen(
        <ZoomableImageSurface
            active
            imageSize={{ width: 400, height: 800 }}
            onZoomedChange={onZoomedChange}
            onSingleTap={onSingleTap}
            testID="zoom"
            {...props}
        >
            {React.createElement('Child')}
        </ZoomableImageSurface>,
    );
    const root = screen.findByTestId('zoom');
    act(() => {
        root?.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
    });
    const gesture = () => screen.findByTestId('zoom-gesture')?.props.gesture as TestGestureChain;
    return { screen, gesture, onZoomedChange, onSingleTap };
}

function findTap(gesture: TestGestureChain, taps: number): TestGestureChain {
    const exclusive = findGestureByKind(gesture, 'exclusive');
    const tap = exclusive?.__gestures?.find((child) => child.__config.numberOfTaps === taps);
    if (!tap) throw new Error(`tap with ${taps} taps not found`);
    return tap;
}

describe('ZoomableImageSurface', () => {
    it('zooms in on double tap, reports it, and turns on the pan', async () => {
        const { gesture, onZoomedChange } = await renderSurface();
        expect(findGestureByKind(gesture(), 'pan')?.__config.enabled).toBe(false);

        act(() => {
            findTap(gesture(), 2).__handlers.onEnd({ x: 300, y: 400 }, true);
        });

        expect(onZoomedChange).toHaveBeenLastCalledWith(true);
        expect(findGestureByKind(gesture(), 'pan')?.__config.enabled).toBe(true);
    });

    it('zooms out on a second double tap', async () => {
        const { gesture, onZoomedChange } = await renderSurface();
        act(() => {
            findTap(gesture(), 2).__handlers.onEnd({ x: 200, y: 400 }, true);
        });
        act(() => {
            findTap(gesture(), 2).__handlers.onEnd({ x: 200, y: 400 }, true);
        });
        expect(onZoomedChange).toHaveBeenLastCalledWith(false);
        expect(findGestureByKind(gesture(), 'pan')?.__config.enabled).toBe(false);
    });

    it('reports a pinch past 1x as zoomed', async () => {
        const { gesture, onZoomedChange } = await renderSurface();
        const pinch = findGestureByKind(gesture(), 'pinch');
        act(() => {
            pinch?.__handlers.onStart({ scale: 1, focalX: 200, focalY: 400 });
            pinch?.__handlers.onUpdate({ scale: 2, focalX: 200, focalY: 400 });
            pinch?.__handlers.onEnd({ scale: 2, focalX: 200, focalY: 400 });
        });
        expect(onZoomedChange).toHaveBeenLastCalledWith(true);
    });

    it('passes a single tap to the parent', async () => {
        const { gesture, onSingleTap } = await renderSurface();
        act(() => {
            findTap(gesture(), 1).__handlers.onEnd({ x: 1, y: 1 }, true);
        });
        expect(onSingleTap).toHaveBeenCalledTimes(1);
    });

    it('resets the zoom when the slide stops being the current one', async () => {
        const { ZoomableImageSurface } = await import('./ZoomableImageSurface');
        const { screen, gesture, onZoomedChange } = await renderSurface();
        act(() => {
            findTap(gesture(), 2).__handlers.onEnd({ x: 200, y: 400 }, true);
        });
        await screen.update(
            <ZoomableImageSurface active={false} imageSize={null} onZoomedChange={onZoomedChange} testID="zoom">
                {React.createElement('Child')}
            </ZoomableImageSurface>,
        );
        expect(findGestureByKind(gesture(), 'pan')?.__config.enabled).toBe(false);
    });
});
