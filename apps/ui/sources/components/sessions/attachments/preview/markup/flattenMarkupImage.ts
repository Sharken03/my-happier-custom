import type { PickedAttachment } from '../../AttachmentFilePicker.types';
import { drawMarkupStrokes, resolveMarkupOutputSize, type MarkupCanvasContext, type MarkupSize, type MarkupStroke } from './markupStrokes';

const MARKUP_MIME_TYPE = 'image/png';

export function resolveMarkupFileName(sourceName: string): string {
    const trimmed = sourceName.trim();
    const dot = trimmed.lastIndexOf('.');
    const base = (dot > 0 ? trimmed.slice(0, dot) : trimmed) || 'image';
    return `${base}-markup.png`;
}

type WebCanvas = {
    width: number;
    height: number;
    getContext(kind: '2d'): (MarkupCanvasContext & { drawImage(image: unknown, x: number, y: number, w: number, h: number): void }) | null;
    toBlob(callback: (blob: Blob | null) => void, type?: string): void;
};

type WebImage = { naturalWidth: number; naturalHeight: number };

export type FlattenMarkupWebDeps = Readonly<{
    createCanvas: () => WebCanvas;
    loadImage: (uri: string) => Promise<WebImage>;
}>;

function loadImageInBrowser(uri: string): Promise<WebImage> {
    return new Promise((resolve, reject) => {
        const image = new (globalThis as unknown as { Image: new () => HTMLImageElement }).Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not load the image for markup.'));
        image.src = uri;
    });
}

const browserDeps: FlattenMarkupWebDeps = {
    createCanvas: () => document.createElement('canvas') as unknown as WebCanvas,
    loadImage: loadImageInBrowser,
};

/** Web: draws the source image at full size on a canvas, then the strokes on top. */
export async function flattenMarkupImageOnWeb(
    params: Readonly<{ sourceUri: string; strokes: ReadonlyArray<MarkupStroke>; fileName: string }>,
    deps: FlattenMarkupWebDeps = browserDeps,
): Promise<PickedAttachment> {
    const image = await deps.loadImage(params.sourceUri);
    const size = resolveMarkupOutputSize({ width: image.naturalWidth, height: image.naturalHeight });
    const canvas = deps.createCanvas();
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(image, 0, 0, size.width, size.height);
    drawMarkupStrokes(ctx, params.strokes, size.width, size.height);
    // A cross-origin image without CORS taints the canvas, and toBlob then throws or returns null.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MARKUP_MIME_TYPE));
    if (!blob) throw new Error('Could not export the marked-up image.');
    const file = new File([blob], resolveMarkupFileName(params.fileName), { type: MARKUP_MIME_TYPE });
    return { kind: 'web', file };
}

/**
 * Native: captures the view that shows the image and the strokes (react-native-view-shot).
 * The capture is scaled to the image size, so the output keeps the image's aspect ratio.
 */
export async function flattenMarkupImageOnNative(params: Readonly<{
    captureTarget: unknown;
    imageSize: MarkupSize | null;
    fileName: string;
}>): Promise<PickedAttachment> {
    const { captureRef } = await import('react-native-view-shot');
    const size = params.imageSize ? resolveMarkupOutputSize(params.imageSize) : null;
    const uri = await captureRef(params.captureTarget as never, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        ...(size ? { width: size.width, height: size.height } : {}),
    });
    return {
        kind: 'native',
        uri,
        name: resolveMarkupFileName(params.fileName),
        mimeType: MARKUP_MIME_TYPE,
    };
}
