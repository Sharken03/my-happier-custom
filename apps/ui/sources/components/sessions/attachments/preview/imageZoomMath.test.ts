import { describe, expect, it } from 'vitest';

import {
    IMAGE_ZOOM_DOUBLE_TAP_SCALE,
    IMAGE_ZOOM_MAX_SCALE,
    clampImageZoomScale,
    clampImageZoomTranslation,
    fitImageInBox,
    isImageZoomed,
    resolveDoubleTapZoom,
} from './imageZoomMath';

describe('imageZoomMath', () => {
    it('fits an image inside a box and keeps its aspect ratio', () => {
        expect(fitImageInBox({ width: 400, height: 800 }, { width: 1000, height: 500 })).toEqual({ width: 400, height: 200 });
        expect(fitImageInBox({ width: 400, height: 800 }, { width: 500, height: 1000 })).toEqual({ width: 400, height: 800 });
        expect(fitImageInBox({ width: 400, height: 800 }, null)).toEqual({ width: 400, height: 800 });
    });

    it('keeps the scale between 1 and the maximum', () => {
        expect(clampImageZoomScale(0.4)).toBe(1);
        expect(clampImageZoomScale(2)).toBe(2);
        expect(clampImageZoomScale(99)).toBe(IMAGE_ZOOM_MAX_SCALE);
    });

    it('treats a scale just above 1 as not zoomed', () => {
        expect(isImageZoomed(1)).toBe(false);
        expect(isImageZoomed(1.005)).toBe(false);
        expect(isImageZoomed(1.5)).toBe(true);
    });

    it('keeps the zoomed image edges inside the box', () => {
        const box = { width: 400, height: 800 };
        const content = { width: 400, height: 200 };
        // At scale 2 the content is 800 x 400: it can move 200 px sideways and not at all vertically.
        expect(clampImageZoomTranslation({ scale: 2, x: 500, y: 300, box, content })).toEqual({ x: 200, y: 0 });
        expect(clampImageZoomTranslation({ scale: 2, x: -500, y: -300, box, content })).toEqual({ x: -200, y: 0 });
        expect(clampImageZoomTranslation({ scale: 1, x: 50, y: 50, box, content })).toEqual({ x: 0, y: 0 });
    });

    it('zooms in toward the tapped point and zooms out when already zoomed', () => {
        const box = { width: 400, height: 800 };
        const content = { width: 400, height: 800 };
        const zoomIn = resolveDoubleTapZoom({ scale: 1, focalX: 300, focalY: 400, box, content });
        expect(zoomIn.scale).toBe(IMAGE_ZOOM_DOUBLE_TAP_SCALE);
        // The tapped point is 100 px right of center, so the image moves left by 100 * (scale - 1).
        expect(zoomIn.x).toBeCloseTo(-100 * (IMAGE_ZOOM_DOUBLE_TAP_SCALE - 1));
        expect(zoomIn.y).toBeCloseTo(0);

        expect(resolveDoubleTapZoom({ scale: 2, focalX: 10, focalY: 10, box, content })).toEqual({ scale: 1, x: 0, y: 0 });
    });
});
