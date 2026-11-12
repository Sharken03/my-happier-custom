import type { SessionMediaInlineImageSummary } from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';

import { resolveSessionMediaImageMimeType } from './sessionMediaPresentation';

const FALLBACK_THUMBNAIL_SIZE = 84;
const MAX_THUMBNAIL_WIDTH = 220;
const MAX_THUMBNAIL_HEIGHT = 160;

/** The inline image row's box: margins above and below, and the gap between tiles and rows. */
export const SESSION_MEDIA_INLINE_IMAGES_MARGIN_TOP_PX = 2;
export const SESSION_MEDIA_INLINE_IMAGES_MARGIN_BOTTOM_PX = 7;
export const SESSION_MEDIA_INLINE_IMAGES_GAP_PX = 8;

export type ImageDimensions = Readonly<{
    width: number;
    height: number;
}>;

function readPositiveDimension(value: number | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : null;
}

export function resolveImageDimensions(value: Readonly<{ width?: number; height?: number }> | null): ImageDimensions | null {
    const width = readPositiveDimension(value?.width);
    const height = readPositiveDimension(value?.height);
    return width && height ? { width, height } : null;
}

export function resolveThumbnailSize(dimensions: ImageDimensions | null): ImageDimensions {
    if (!dimensions) {
        return {
            width: FALLBACK_THUMBNAIL_SIZE,
            height: FALLBACK_THUMBNAIL_SIZE,
        };
    }

    const scale = Math.min(
        MAX_THUMBNAIL_WIDTH / dimensions.width,
        MAX_THUMBNAIL_HEIGHT / dimensions.height,
    );
    return {
        width: Math.max(1, Math.round(dimensions.width * scale)),
        height: Math.max(1, Math.round(dimensions.height * scale)),
    };
}

/**
 * The height `SessionMediaInlineImages` paints before any image has loaded: tiles sized from
 * their metadata dimensions, wrapped into rows at `availableWidthPx`. A tile without metadata
 * dimensions paints the fallback size until its image loads and reports its real size.
 */
export function resolveSessionMediaInlineImagesHeightPx(
    media: readonly SessionMediaInlineImageSummary[],
    availableWidthPx: number,
): number {
    let rowsHeightPx = 0;
    let rowWidthPx = 0;
    let rowHeightPx = 0;
    let rowCount = 0;
    for (const entry of media) {
        if (!resolveSessionMediaImageMimeType(entry)) continue;
        const tile = resolveThumbnailSize(resolveImageDimensions(entry));
        const nextRowWidthPx = rowWidthPx === 0 ? tile.width : rowWidthPx + SESSION_MEDIA_INLINE_IMAGES_GAP_PX + tile.width;
        if (rowWidthPx > 0 && nextRowWidthPx > availableWidthPx) {
            rowsHeightPx += rowHeightPx;
            rowCount += 1;
            rowWidthPx = tile.width;
            rowHeightPx = tile.height;
            continue;
        }
        rowWidthPx = nextRowWidthPx;
        rowHeightPx = Math.max(rowHeightPx, tile.height);
    }
    if (rowWidthPx === 0) return 0;
    rowsHeightPx += rowHeightPx;
    rowCount += 1;
    return SESSION_MEDIA_INLINE_IMAGES_MARGIN_TOP_PX
        + rowsHeightPx
        + (rowCount - 1) * SESSION_MEDIA_INLINE_IMAGES_GAP_PX
        + SESSION_MEDIA_INLINE_IMAGES_MARGIN_BOTTOM_PX;
}
