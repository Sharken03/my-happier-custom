import { describe, expect, it, vi } from 'vitest';

const captureRef = vi.hoisted(() => vi.fn(async (_target: unknown, _options: unknown) => 'file:///cache/view-shot.png'));
vi.mock('react-native-view-shot', () => ({ captureRef }));

import {
    flattenMarkupImageOnNative,
    flattenMarkupImageOnWeb,
    resolveMarkupFileName,
} from './flattenMarkupImage';
import type { MarkupStroke } from './markupStrokes';

const strokes: MarkupStroke[] = [{ color: '#ff3b30', width: 0.01, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];

describe('flattenMarkupImage', () => {
    it('names the output after the source image', () => {
        expect(resolveMarkupFileName('1000123.jpg')).toBe('1000123-markup.png');
        expect(resolveMarkupFileName('')).toBe('image-markup.png');
    });

    it('draws the image and the strokes on a canvas at full size on web', async () => {
        const ctx = {
            drawImage: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            lineCap: '',
            lineJoin: '',
            lineWidth: 0,
            strokeStyle: '',
        };
        const blob = new Blob(['png'], { type: 'image/png' });
        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ctx),
            toBlob: vi.fn((callback: (value: Blob | null) => void) => callback(blob)),
        };
        const image = { naturalWidth: 400, naturalHeight: 200 };

        const result = await flattenMarkupImageOnWeb(
            { sourceUri: 'blob:source', strokes, fileName: 'cat.jpg' },
            { createCanvas: () => canvas, loadImage: async () => image },
        );

        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(200);
        expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 400, 200);
        expect(ctx.lineTo).toHaveBeenCalledWith(400, 200);
        expect(result.kind).toBe('web');
        if (result.kind !== 'web') throw new Error('expected a web file');
        expect(result.file.name).toBe('cat-markup.png');
        expect(result.file.type).toBe('image/png');
    });

    it('fails clearly when the canvas cannot export the image', async () => {
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), lineCap: '', lineJoin: '', lineWidth: 0, strokeStyle: '' }),
            toBlob: (callback: (value: Blob | null) => void) => callback(null),
        };
        await expect(flattenMarkupImageOnWeb(
            { sourceUri: 'blob:source', strokes, fileName: 'cat.jpg' },
            { createCanvas: () => canvas, loadImage: async () => ({ naturalWidth: 10, naturalHeight: 10 }) },
        )).rejects.toThrow();
    });

    it('captures the drawn view as a PNG file at the image size on native', async () => {
        const target = { current: {} };
        const result = await flattenMarkupImageOnNative({
            captureTarget: target,
            imageSize: { width: 4096, height: 2048 },
            fileName: 'photo.heic',
        });

        expect(captureRef).toHaveBeenCalledWith(target, expect.objectContaining({
            format: 'png',
            result: 'tmpfile',
            width: 2048,
            height: 1024,
        }));
        expect(result).toEqual({
            kind: 'native',
            uri: 'file:///cache/view-shot.png',
            name: 'photo-markup.png',
            mimeType: 'image/png',
        });
    });
});
