/** A swipe faster than this (px/s) moves the sheet one detent, whatever its position. */
const FLING_VELOCITY = 800;
/** A slow release closes the sheet only this far (part of the distance) below half height. */
const CLOSE_FRACTION = 0.3;

/**
 * Where the Tool calls sheet settles after a swipe. `y` is how far the sheet is moved down from
 * full height: 0 is full height, `half` is half height and `closed` is off screen.
 * A fast swipe down goes from full height to half height, and from half height to closed.
 */
export function resolveToolCallsSheetSnap(y: number, velocityY: number, half: number, closed: number): number {
    'worklet';
    if (velocityY > FLING_VELOCITY) return y < half - 1 ? half : closed;
    if (velocityY < -FLING_VELOCITY) return y > half + 1 ? half : 0;
    if (y > half + (closed - half) * CLOSE_FRACTION) return closed;
    return y < half / 2 ? 0 : half;
}
