import { describe, expect, it } from 'vitest';

import { truncateFileNameMiddle } from './imageViewerText';

describe('truncateFileNameMiddle', () => {
    it('keeps short names as they are', () => {
        expect(truncateFileNameMiddle('cat.png', 16)).toBe('cat.png');
    });

    it('keeps the start and the extension of long names', () => {
        expect(truncateFileNameMiddle('1000012345678.jpg', 11)).toBe('1000....jpg');
    });

    it('cuts in the middle when the name has no extension', () => {
        expect(truncateFileNameMiddle('abcdefghijklmnop', 9)).toBe('abc...nop');
    });

    it('treats a very long extension as part of the name', () => {
        expect(truncateFileNameMiddle('a.verylongextensionname', 10)).toBe('a.ve...ame');
    });
});
