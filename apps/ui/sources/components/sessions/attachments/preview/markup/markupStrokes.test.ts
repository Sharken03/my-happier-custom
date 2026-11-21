import { describe, expect, it, vi } from 'vitest';

import {
    MARKUP_COLORS,
    appendMarkupPoint,
    drawMarkupStrokes,
    markupStrokeToSvgPath,
    resolveMarkupOutputSize,
    toMarkupPoint,
    type MarkupStroke,
} from './markupStrokes';

const stroke: MarkupStroke = {
    color: '#ff3b30',
    width: 0.01,
    points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }, { x: 1, y: 1 }],
};

describe('markupStrokes', () => {
    it('offers a few pen colors', () => {
        expect(MARKUP_COLORS.length).toBeGreaterThanOrEqual(4);
    });

    it('stores points relative to the image box and keeps them inside it', () => {
        expect(toMarkupPoint(50, 100, { width: 200, height: 400 })).toEqual({ x: 0.25, y: 0.25 });
        expect(toMarkupPoint(-10, 900, { width: 200, height: 400 })).toEqual({ x: 0, y: 1 });
    });

    it('skips a point that is too close to the last point', () => {
        const first = appendMarkupPoint([], { x: 0.1, y: 0.1 });
        expect(appendMarkupPoint(first, { x: 0.1001, y: 0.1 })).toBe(first);
        expect(appendMarkupPoint(first, { x: 0.2, y: 0.1 })).toHaveLength(2);
    });

    it('builds an SVG path in pixels of the drawn box', () => {
        expect(markupStrokeToSvgPath(stroke, 200, 400)).toBe('M0 0 L100 100 L200 400');
    });

    it('draws a single tap as a dot', () => {
        expect(markupStrokeToSvgPath({ ...stroke, points: [{ x: 0.5, y: 0.5 }] }, 100, 100)).toBe('M50 50 L50.01 50');
    });

    it('draws the strokes on a canvas at the output size', () => {
        const ctx = {
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            lineCap: '',
            lineJoin: '',
            lineWidth: 0,
            strokeStyle: '',
        };
        drawMarkupStrokes(ctx, [stroke], 1000, 2000);
        expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(500, 500);
        expect(ctx.lineTo).toHaveBeenCalledWith(1000, 2000);
        expect(ctx.lineWidth).toBe(10);
        expect(ctx.strokeStyle).toBe('#ff3b30');
        expect(ctx.lineCap).toBe('round');
        expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it('keeps the output size of large images at most 2048 px on the long side', () => {
        expect(resolveMarkupOutputSize({ width: 4096, height: 1024 })).toEqual({ width: 2048, height: 512 });
        expect(resolveMarkupOutputSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    });
});
