import * as React from 'react';

/**
 * Rows mounted in the first frame and added in each later frame. A model row or card costs about
 * 1-1.5 ms of render work in the UI render tests (380 models), so a batch stays far inside a frame
 * and the first batch still fills a picker or menu on a phone.
 */
export const PROGRESSIVE_ROW_BATCH = 24;

/** Runs the callback in the next frame; returns a function that cancels it. */
function scheduleNextFrame(callback: () => void): () => void {
    if (typeof globalThis.requestAnimationFrame === 'function') {
        const frame = globalThis.requestAnimationFrame(callback);
        return () => globalThis.cancelAnimationFrame(frame);
    }
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
}

/**
 * How many of `total` rows a long list mounts now. The list mounts the first batch at once and
 * one more batch per frame, so opening it and each change of `resetKey` (a search query) mount
 * at most one batch at once. A new `resetKey` starts again from the first batch. A list with at
 * most one batch of rows mounts all of them at once.
 */
export function useProgressiveRowCount(total: number, resetKey: string): number {
    const [batch, setBatch] = React.useState({ resetKey, count: PROGRESSIVE_ROW_BATCH });
    const count = batch.resetKey === resetKey ? batch.count : PROGRESSIVE_ROW_BATCH;
    React.useEffect(() => {
        if (count >= total) return;
        return scheduleNextFrame(() => {
            setBatch({ resetKey, count: count + PROGRESSIVE_ROW_BATCH });
        });
    }, [count, resetKey, total]);
    return Math.min(count, total);
}
