/**
 * Pure zoom math for the fullscreen image viewer. Every function is a worklet, so the
 * gesture callbacks can call it on the UI thread.
 */

export type ImageZoomSize = Readonly<{ width: number; height: number }>;

export const IMAGE_ZOOM_MAX_SCALE = 5;
export const IMAGE_ZOOM_DOUBLE_TAP_SCALE = 2.5;
const IMAGE_ZOOM_EPSILON = 0.01;

/** The size of an image drawn with `contain` in the box. Without the image size, the box size. */
export function fitImageInBox(box: ImageZoomSize, image: ImageZoomSize | null): ImageZoomSize {
    'worklet';
    if (!image || image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) {
        return { width: box.width, height: box.height };
    }
    const ratio = Math.min(box.width / image.width, box.height / image.height);
    return { width: image.width * ratio, height: image.height * ratio };
}

export function clampImageZoomScale(scale: number): number {
    'worklet';
    if (!Number.isFinite(scale)) return 1;
    return Math.min(IMAGE_ZOOM_MAX_SCALE, Math.max(1, scale));
}

export function isImageZoomed(scale: number): boolean {
    'worklet';
    return scale > 1 + IMAGE_ZOOM_EPSILON;
}

function clampAxis(value: number, contentLength: number, boxLength: number, scale: number): number {
    'worklet';
    const limit = Math.max(0, (contentLength * scale - boxLength) / 2);
    const clamped = Math.min(limit, Math.max(-limit, value));
    // Normalize -0 to 0 so callers and tests compare cleanly.
    return clamped === 0 ? 0 : clamped;
}

/** Limits the translation so the scaled content never leaves a gap at an edge it covers. */
export function clampImageZoomTranslation(params: Readonly<{
    scale: number;
    x: number;
    y: number;
    box: ImageZoomSize;
    content: ImageZoomSize;
}>): Readonly<{ x: number; y: number }> {
    'worklet';
    return {
        x: clampAxis(params.x, params.content.width, params.box.width, params.scale),
        y: clampAxis(params.y, params.content.height, params.box.height, params.scale),
    };
}

/**
 * Double tap: zoom in so the tapped point stays under the finger, or zoom out to fit.
 * The transform origin is the box center.
 */
export function resolveDoubleTapZoom(params: Readonly<{
    scale: number;
    focalX: number;
    focalY: number;
    box: ImageZoomSize;
    content: ImageZoomSize;
}>): Readonly<{ scale: number; x: number; y: number }> {
    'worklet';
    if (isImageZoomed(params.scale)) return { scale: 1, x: 0, y: 0 };
    const scale = IMAGE_ZOOM_DOUBLE_TAP_SCALE;
    const translation = clampImageZoomTranslation({
        scale,
        x: (params.box.width / 2 - params.focalX) * (scale - 1),
        y: (params.box.height / 2 - params.focalY) * (scale - 1),
        box: params.box,
        content: params.content,
    });
    return { scale, ...translation };
}
