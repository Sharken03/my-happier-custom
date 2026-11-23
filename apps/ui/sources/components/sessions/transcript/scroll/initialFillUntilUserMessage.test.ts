import { describe, expect, it } from 'vitest';

import { isLegendContentOverflowing } from './initialFillUntilUserMessage';

describe('isLegendContentOverflowing', () => {
    it('reads a list padded up to the viewport as not scrollable', () => {
        expect(isLegendContentOverflowing({ contentLength: 862, scrollLength: 862 })).toBe(false);
    });

    it('reads a list longer than the viewport as scrollable', () => {
        expect(isLegendContentOverflowing({ contentLength: 1400, scrollLength: 862 })).toBe(true);
    });

    it('returns null before Legend measures the viewport', () => {
        expect(isLegendContentOverflowing(null)).toBeNull();
        expect(isLegendContentOverflowing({ contentLength: 862, scrollLength: 0 })).toBeNull();
        expect(isLegendContentOverflowing({ contentLength: Number.NaN, scrollLength: 862 })).toBeNull();
    });
});
