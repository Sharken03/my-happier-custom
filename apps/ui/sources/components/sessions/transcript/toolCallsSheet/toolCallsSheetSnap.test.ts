import { describe, expect, it } from 'vitest';

import { resolveToolCallsSheetSnap } from './toolCallsSheetSnap';

const HALF = 500;
const CLOSED = 1000;

describe('resolveToolCallsSheetSnap', () => {
    it('moves one detent down on a fast swipe down', () => {
        expect(resolveToolCallsSheetSnap(40, 1500, HALF, CLOSED)).toBe(HALF);
        expect(resolveToolCallsSheetSnap(HALF + 30, 1500, HALF, CLOSED)).toBe(CLOSED);
    });

    it('moves one detent up on a fast swipe up', () => {
        expect(resolveToolCallsSheetSnap(HALF - 30, -1500, HALF, CLOSED)).toBe(0);
        expect(resolveToolCallsSheetSnap(HALF + 200, -1500, HALF, CLOSED)).toBe(HALF);
    });

    it('settles a slow release at the nearest detent and closes only well below half height', () => {
        expect(resolveToolCallsSheetSnap(200, 0, HALF, CLOSED)).toBe(0);
        expect(resolveToolCallsSheetSnap(300, 0, HALF, CLOSED)).toBe(HALF);
        expect(resolveToolCallsSheetSnap(HALF + 100, 0, HALF, CLOSED)).toBe(HALF);
        expect(resolveToolCallsSheetSnap(HALF + 200, 0, HALF, CLOSED)).toBe(CLOSED);
    });
});
