import { describe, expect, it } from 'vitest';

import { countSessionMediaImages } from './sessionMediaPresentation';

const entry = (name: string, mimeType?: string) => ({
    name,
    path: `/${name}`,
    ...(mimeType ? { mimeType } : {}),
    sizeBytes: 1,
    category: 'tool-artifact' as const,
    role: 'output' as const,
});

describe('countSessionMediaImages', () => {
    it('counts only the entries that the inline image row paints', () => {
        expect(countSessionMediaImages([
            entry('shot.png', 'image/png'),
            entry('photo.jpg'),
            entry('notes.txt', 'text/plain'),
        ])).toBe(2);
    });
});
