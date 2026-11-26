import { describe, expect, it } from 'vitest';

import { resolveSharedImageBoxSize, resolveSharedImagesHeightPx } from './sessionMediaSharedImageLayout';

const image = (width?: number, height?: number) => ({
    name: 'a.png',
    path: '/a.png',
    mimeType: 'image/png',
    sizeBytes: 1,
    category: 'tool-artifact' as const,
    role: 'output' as const,
    ...(width ? { width, height } : {}),
});

// The react-native test stub reports a pixel ratio of 2, so sizes snap to 0.5 px steps.
describe('resolveSharedImageBoxSize', () => {
    it('fills the available width and snaps the height to whole device pixels', () => {
        // 328 * 333 / 1000 = 109.224, which snaps to 109 at a pixel ratio of 2.
        expect(resolveSharedImageBoxSize(image(1000, 333), 328)).toEqual({ width: 328, height: 109 });
    });

    it('caps the height of a tall image and keeps its aspect ratio', () => {
        expect(resolveSharedImageBoxSize(image(900, 1600), 328)).toEqual({ width: 270, height: 480 });
    });

    it('does not scale a small image up past its own size', () => {
        expect(resolveSharedImageBoxSize(image(100, 50), 328)).toEqual({ width: 100, height: 50 });
    });

    it('uses a fixed 4:3 box when the image has no stored size', () => {
        expect(resolveSharedImageBoxSize(image(), 328)).toEqual({ width: 328, height: 246 });
    });
});

describe('resolveSharedImagesHeightPx', () => {
    it('stacks the images with a gap and skips entries that are not images', () => {
        const notes = { ...image(), name: 'notes.txt', path: '/notes.txt', mimeType: 'text/plain' };
        expect(resolveSharedImagesHeightPx([image(1000, 500), notes, image(100, 50)], 328)).toBe(164 + 8 + 50);
    });
});
