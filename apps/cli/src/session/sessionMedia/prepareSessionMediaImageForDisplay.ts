import { decodeBmpImage, decodeIcoImage, type DecodedBitmap } from './decodeWindowsBitmapImage';
import { sniffSessionMediaSourceImageType, type SessionMediaSourceImageType } from './sessionMediaMime';

/**
 * Image types that every model API and every Happier client accepts.
 * SVG is stored as session media elsewhere, but model APIs reject it as an image block.
 */
export type DisplayImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type DisplayImage = Readonly<{
  bytes: Buffer;
  mimeType: DisplayImageMimeType;
  width: number;
  height: number;
  sourceMimeType: SessionMediaSourceImageType;
}>;

export type PrepareDisplayImageResult =
  | Readonly<{ ok: true; image: DisplayImage }>
  | Readonly<{ ok: false; code: 'not_an_image' | 'image_decode_unavailable' | 'image_decode_failed' | 'image_too_large'; error: string }>;

/** Long edge in pixels. Model APIs scale larger images down anyway. */
export const DISPLAY_IMAGE_MAX_EDGE = 2048;
/** Fits one base64 image (4/3 larger) in a 1 MiB tool-bridge result line with room to spare. */
export const DISPLAY_IMAGE_MAX_BYTES = 700 * 1024;

const PASS_THROUGH_TYPES = new Set<SessionMediaSourceImageType>(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

type SharpModule = typeof import('sharp');

async function loadSharp(): Promise<SharpModule['default']> {
  return (await import('sharp')).default;
}

function failure(code: Extract<PrepareDisplayImageResult, { ok: false }>['code'], error: string): PrepareDisplayImageResult {
  return { ok: false, code, error };
}

function decodeWindowsBitmap(bytes: Buffer, type: SessionMediaSourceImageType): DecodedBitmap | null {
  if (type === 'image/bmp') return decodeBmpImage(bytes);
  if (type === 'image/x-icon') return decodeIcoImage(bytes);
  return null;
}

/**
 * Turn image file bytes into an image that can go to the model and the user as is:
 * PNG, JPEG, GIF or WebP within DISPLAY_IMAGE_MAX_EDGE and the byte budget.
 * Small images of those four types keep their bytes (GIF animation stays).
 * Other types (SVG, TIFF, AVIF, HEIC/HEIF, BMP, ICO) become PNG, and an image over the
 * bounds is scaled down and, if still over the byte budget, re-encoded as WebP.
 */
export async function prepareSessionMediaImageForDisplay(
  bytes: Buffer,
  options: Readonly<{ maxBytes?: number; maxEdge?: number }> = {},
): Promise<PrepareDisplayImageResult> {
  const maxBytes = options.maxBytes ?? DISPLAY_IMAGE_MAX_BYTES;
  const maxEdge = options.maxEdge ?? DISPLAY_IMAGE_MAX_EDGE;
  const sourceMimeType = sniffSessionMediaSourceImageType(bytes);
  if (!sourceMimeType) {
    return failure('not_an_image', 'The file is not a supported image (PNG, JPEG, GIF, WebP, SVG, AVIF, HEIC/HEIF, TIFF, BMP or ICO)');
  }

  const sharp = await loadSharp();
  let input: Buffer = bytes;
  let rawInput: Readonly<{ width: number; height: number; channels: 4 }> | null = null;
  if (sourceMimeType === 'image/bmp' || sourceMimeType === 'image/x-icon') {
    const decoded = decodeWindowsBitmap(bytes, sourceMimeType);
    if (!decoded) {
      return failure('image_decode_failed', `This ${sourceMimeType} layout cannot be decoded (supported: uncompressed 8, 24 and 32 bit, or PNG icons)`);
    }
    if (decoded.kind === 'png') {
      input = decoded.bytes;
    } else {
      input = decoded.rgba;
      rawInput = { width: decoded.width, height: decoded.height, channels: 4 };
    }
  }

  const open = () => rawInput
    ? sharp(input, { raw: rawInput })
    : sharp(input, { failOn: 'none' });

  let width: number;
  let height: number;
  try {
    if (rawInput) {
      width = rawInput.width;
      height = rawInput.height;
    } else {
      const metadata = await open().metadata();
      width = metadata.autoOrient?.width ?? metadata.width ?? 0;
      height = metadata.autoOrient?.height ?? metadata.height ?? 0;
      // Decode one pixel row so that a missing decoder fails here, not later.
      if (!PASS_THROUGH_TYPES.has(sourceMimeType)) {
        await open().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if ((sourceMimeType === 'image/heic' || sourceMimeType === 'image/heif') && /compression format|plugin|decoder/i.test(detail)) {
      return failure('image_decode_unavailable', `${sourceMimeType} images cannot be decoded on this machine: the image library has no HEVC decoder. Convert the file to PNG or JPEG first.`);
    }
    return failure('image_decode_failed', `The ${sourceMimeType} image cannot be decoded`);
  }
  if (width <= 0 || height <= 0) {
    return failure('image_decode_failed', `The ${sourceMimeType} image has no readable dimensions`);
  }

  const fitsEdge = Math.max(width, height) <= maxEdge;
  if (PASS_THROUGH_TYPES.has(sourceMimeType) && fitsEdge && bytes.length <= maxBytes) {
    return { ok: true, image: { bytes, mimeType: sourceMimeType as DisplayImageMimeType, width, height, sourceMimeType } };
  }

  const resized = () => {
    const pipeline = open().autoOrient();
    return fitsEdge ? pipeline : pipeline.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  };

  try {
    const keepJpeg = sourceMimeType === 'image/jpeg';
    const first = keepJpeg
      ? await resized().jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
      : await resized().png().toBuffer({ resolveWithObject: true });
    if (first.data.length <= maxBytes) {
      return {
        ok: true,
        image: {
          bytes: first.data,
          mimeType: keepJpeg ? 'image/jpeg' : 'image/png',
          width: first.info.width,
          height: first.info.height,
          sourceMimeType,
        },
      };
    }
    const webp = await resized().webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (webp.data.length <= maxBytes) {
      return {
        ok: true,
        image: { bytes: webp.data, mimeType: 'image/webp', width: webp.info.width, height: webp.info.height, sourceMimeType },
      };
    }
  } catch {
    return failure('image_decode_failed', `The ${sourceMimeType} image cannot be converted`);
  }
  return failure('image_too_large', `The image is too large to show, also after scaling to ${maxEdge} px and WebP encoding`);
}
