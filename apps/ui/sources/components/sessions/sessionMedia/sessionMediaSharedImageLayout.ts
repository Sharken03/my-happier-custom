import { PixelRatio } from 'react-native';

import type { SessionMediaInlineImageSummary } from '@/sync/domains/sessionMedia/sessionMediaMessageMeta';

import { resolveSessionMediaImageMimeType } from './sessionMediaPresentation';
import { resolveImageDimensions, type ImageDimensions } from './sessionMediaThumbnailLayout';

/**
 * Layout of an image the agent shares with `show_image`: one box per image, as wide as the
 * transcript column allows. The transcript row estimate and the painted box both read
 * {@link resolveSharedImageBoxSize}, and the box only depends on the stored image size and the
 * available width, so the row keeps its height when the image loads.
 */

/** A fixed cap, so the box does not depend on the screen height. */
export const SHARED_IMAGE_MAX_HEIGHT_PX = 480;
export const SHARED_IMAGE_GAP_PX = 8;
/** The row lines up with the reply text: `agentMessageContainer.marginHorizontal` in `MessageView`. */
export const SHARED_IMAGE_ROW_HORIZONTAL_MARGIN_PX = 16;
/** Same space under the row as under a reply: `agentMessageContainer.paddingBottom`. */
export const SHARED_IMAGE_ROW_PADDING_BOTTOM_PX = 22;
export const SHARED_IMAGE_CAPTION_MARGIN_TOP_PX = 6;
/** Height to width of the box for an image without a stored size. */
const FALLBACK_HEIGHT_RATIO = 3 / 4;

function snapToDevicePixels(value: number): number {
    const ratio = PixelRatio.get();
    const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return Math.max(1, Math.round(value * scale) / scale);
}

/** The width an image box can take in a row of this transcript content width. */
export function resolveSharedImageAvailableWidthPx(transcriptContentWidthPx: number): number {
    if (!Number.isFinite(transcriptContentWidthPx)) return 0;
    return Math.max(0, transcriptContentWidthPx - SHARED_IMAGE_ROW_HORIZONTAL_MARGIN_PX * 2);
}

export function resolveSharedImageBoxSize(
    media: SessionMediaInlineImageSummary,
    availableWidthPx: number,
): ImageDimensions {
    const maxWidthPx = Math.max(1, availableWidthPx);
    const dimensions = resolveImageDimensions(media);
    if (!dimensions) {
        const width = snapToDevicePixels(maxWidthPx);
        return { width, height: snapToDevicePixels(Math.min(SHARED_IMAGE_MAX_HEIGHT_PX, width * FALLBACK_HEIGHT_RATIO)) };
    }
    const width = Math.min(
        maxWidthPx,
        dimensions.width,
        SHARED_IMAGE_MAX_HEIGHT_PX * dimensions.width / dimensions.height,
    );
    return {
        width: snapToDevicePixels(width),
        height: snapToDevicePixels(width * dimensions.height / dimensions.width),
    };
}

/** The height of the stacked image boxes, without the row padding and the caption. */
export function resolveSharedImagesHeightPx(
    media: readonly SessionMediaInlineImageSummary[],
    availableWidthPx: number,
): number {
    let heightPx = 0;
    let count = 0;
    for (const entry of media) {
        if (!resolveSessionMediaImageMimeType(entry)) continue;
        heightPx += resolveSharedImageBoxSize(entry, availableWidthPx).height;
        count += 1;
    }
    return count === 0 ? 0 : heightPx + (count - 1) * SHARED_IMAGE_GAP_PX;
}
