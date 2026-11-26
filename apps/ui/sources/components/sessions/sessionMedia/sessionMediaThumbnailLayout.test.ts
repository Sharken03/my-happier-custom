import { describe, expect, it } from 'vitest';

import { resolveSessionMediaInlineImagesHeightPx } from './sessionMediaThumbnailLayout';

const image = (width?: number, height?: number) => ({
    name: 'a.png',
    path: '/a.png',
    mimeType: 'image/png',
    sizeBytes: 1,
    category: 'attachment' as const,
    role: 'input' as const,
    ...(width ? { width, height } : {}),
});

describe('resolveSessionMediaInlineImagesHeightPx', () => {
    it('wraps tiles into rows at the available width', () => {
        // Two 160 px tiles and an 8 px gap need 328 px: one row at 400 px, two rows at 300 px.
        expect(resolveSessionMediaInlineImagesHeightPx([image(1000, 1000), image(1000, 1000)], 400)).toBe(2 + 160 + 7);
        expect(resolveSessionMediaInlineImagesHeightPx([image(1000, 1000), image(1000, 1000)], 300)).toBe(2 + 160 + 8 + 160 + 7);
    });

    it('paints nothing when no entry is an image', () => {
        expect(resolveSessionMediaInlineImagesHeightPx([{ ...image(), name: 'notes.txt', path: '/notes.txt', mimeType: 'text/plain' }], 300)).toBe(0);
    });
});
