/**
 * Minimal decoders for BMP and ICO images, which the bundled sharp build cannot read.
 * They cover the layouts that common tools write: uncompressed 8-, 24- and 32-bit DIBs
 * (BI_RGB, and BI_BITFIELDS with the standard BGRA masks), and ICO entries that hold
 * either a PNG or such a DIB. Other layouts return null.
 */

export type DecodedBitmap =
  | Readonly<{ kind: 'rgba'; width: number; height: number; rgba: Buffer }>
  | Readonly<{ kind: 'png'; bytes: Buffer }>;

const MAX_BITMAP_EDGE = 16_384;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BI_RGB = 0;
const BI_BITFIELDS = 3;

function hasStandardBgraMasks(dib: Buffer, headerSize: number): boolean {
  // With a 40-byte header the masks follow the header; larger headers hold them at 40.
  const offset = 40;
  if (dib.length < offset + 12) return false;
  const red = dib.readUInt32LE(offset);
  const green = dib.readUInt32LE(offset + 4);
  const blue = dib.readUInt32LE(offset + 8);
  const alpha = headerSize >= 56 && dib.length >= offset + 16 ? dib.readUInt32LE(offset + 12) : 0xff000000;
  return red === 0x00ff0000 && green === 0x0000ff00 && blue === 0x000000ff && (alpha === 0xff000000 || alpha === 0);
}

/**
 * Decode a DIB (BITMAPINFOHEADER or later, no file header).
 * `pixelOffset` is relative to the DIB start; null means "directly after the palette".
 * An icon DIB has a doubled height (color rows, then a 1-bit AND mask).
 */
function decodeDib(dib: Buffer, options: Readonly<{ pixelOffset: number | null; icon: boolean }>): DecodedBitmap | null {
  if (dib.length < 40) return null;
  const headerSize = dib.readUInt32LE(0);
  if (headerSize < 40 || headerSize > dib.length) return null;
  const width = dib.readInt32LE(4);
  const rawHeight = dib.readInt32LE(8);
  const bitsPerPixel = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  const colorsUsed = dib.readUInt32LE(32);
  const topDown = rawHeight < 0;
  const height = options.icon ? Math.floor(Math.abs(rawHeight) / 2) : Math.abs(rawHeight);
  if (width <= 0 || height <= 0 || width > MAX_BITMAP_EDGE || height > MAX_BITMAP_EDGE) return null;
  if (bitsPerPixel !== 8 && bitsPerPixel !== 24 && bitsPerPixel !== 32) return null;
  if (compression !== BI_RGB && !(compression === BI_BITFIELDS && bitsPerPixel === 32 && hasStandardBgraMasks(dib, headerSize))) {
    return null;
  }

  const masksSize = compression === BI_BITFIELDS && headerSize === 40 ? 12 : 0;
  const paletteOffset = headerSize + masksSize;
  const paletteCount = bitsPerPixel === 8 ? (colorsUsed > 0 && colorsUsed <= 256 ? colorsUsed : 256) : 0;
  const pixelOffset = options.pixelOffset ?? paletteOffset + paletteCount * 4;
  const stride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const maskStride = Math.floor((width + 31) / 32) * 4;
  if (paletteOffset + paletteCount * 4 > dib.length) return null;
  if (pixelOffset < 0 || pixelOffset + stride * height > dib.length) return null;
  const maskOffset = pixelOffset + stride * height;
  const hasMask = options.icon && maskOffset + maskStride * height <= dib.length;

  const rgba = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const sourceRow = topDown ? y : height - 1 - y;
    const rowStart = pixelOffset + sourceRow * stride;
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      if (bitsPerPixel === 8) {
        const entry = paletteOffset + dib[rowStart + x]! * 4;
        if (entry + 3 > dib.length) return null;
        rgba[target] = dib[entry + 2]!;
        rgba[target + 1] = dib[entry + 1]!;
        rgba[target + 2] = dib[entry]!;
        rgba[target + 3] = 255;
        continue;
      }
      const source = rowStart + x * (bitsPerPixel / 8);
      rgba[target] = dib[source + 2]!;
      rgba[target + 1] = dib[source + 1]!;
      rgba[target + 2] = dib[source]!;
      if (bitsPerPixel === 32) {
        rgba[target + 3] = dib[source + 3]!;
        if (dib[source + 3] !== 0) anyAlpha = true;
      } else {
        rgba[target + 3] = 255;
      }
    }
  }

  // 32-bit data with only zero alpha bytes is opaque: the fourth byte is padding.
  const alphaFromChannel = bitsPerPixel === 32 && anyAlpha;
  if (bitsPerPixel === 32 && !anyAlpha) {
    for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
  }
  if (hasMask && !alphaFromChannel) {
    for (let y = 0; y < height; y += 1) {
      const sourceRow = topDown ? y : height - 1 - y;
      const rowStart = maskOffset + sourceRow * maskStride;
      for (let x = 0; x < width; x += 1) {
        const transparent = (dib[rowStart + (x >> 3)]! >> (7 - (x & 7))) & 1;
        if (transparent) rgba[(y * width + x) * 4 + 3] = 0;
      }
    }
  }

  return { kind: 'rgba', width, height, rgba };
}

export function decodeBmpImage(bytes: Buffer): DecodedBitmap | null {
  if (bytes.length < 14 + 40 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  const pixelDataOffset = bytes.readUInt32LE(10);
  return decodeDib(bytes.subarray(14), { pixelOffset: pixelDataOffset - 14, icon: false });
}

export function decodeIcoImage(bytes: Buffer): DecodedBitmap | null {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (count === 0 || bytes.length < 6 + count * 16) return null;

  let best: Readonly<{ area: number; offset: number; size: number }> | null = null;
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (size === 0 || offset + size > bytes.length) continue;
    if (!best || width * height > best.area) best = { area: width * height, offset, size };
  }
  if (!best) return null;

  const payload = bytes.subarray(best.offset, best.offset + best.size);
  if (payload.length >= PNG_SIGNATURE.length && payload.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { kind: 'png', bytes: Buffer.from(payload) };
  }
  return decodeDib(payload, { pixelOffset: null, icon: true });
}
