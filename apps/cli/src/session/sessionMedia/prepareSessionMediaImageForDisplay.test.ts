import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { prepareSessionMediaImageForDisplay } from './prepareSessionMediaImageForDisplay';
import { sniffSessionMediaMimeType } from './sessionMediaMime';

// 40x30 HEVC-coded HEIC (ImageMagick output). Prebuilt sharp has no HEVC decoder.
const HEIC_40X30_BASE64 = 'AAAAGGZ0eXBoZWl4AAAAAG1pZjFoZWl4AAABZ21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAImlsb2MAAAAAREAAAQABAAAAAAGHAAEAAAAAAAAATwAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAADnBpdG0AAAAAAAEAAADnaXBycAAAAMhpcGNvAAAAdGh2Y0MBBAgAAACZuAAAAAAe8AD8/fz8AAAPA2AAAQAXQAEMAf//BAgAAAMAmbgAAAMAAB66AkBhAAEAKUIBAQQIAAADAJm4AAADAAAeoCCBBFKW6q6a5uAhoMCAAAAMgAAAAwCEYgABAAZEAcFzwYkAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAKAAAAAEAAAAeAAAAAf///+gAAAAC////3gAAAAIAAAAQcGl4aQAAAAADDAwMAAAAF2lwbWEAAAAAAAAAAQABBIECBIMAAABXbWRhdAAAAEsoAa8TIWtnwPVBwYX2t2NyKIhSnvMQW8xDk1oxmOi72Nirs33FcOzwQRDeG4Oy8NAxO/J2dL8CjMz+ml/JA/LGeJStroC0lqKx1sA=';

async function solidImage(width: number, height: number): Promise<ReturnType<typeof sharp>> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 10 } } });
}

/** A bottom-up 24-bit BI_RGB DIB, as Windows tools write it. */
function dib24(width: number, height: number, rgb: readonly [number, number, number], heightFactor = 1): Buffer {
  const stride = Math.floor((24 * width + 31) / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * heightFactor, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(24, 14);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + x * 3;
      pixels[offset] = rgb[2];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[0];
    }
  }
  return Buffer.concat([header, pixels]);
}

function bmpFile(width: number, height: number, rgb: readonly [number, number, number]): Buffer {
  const dib = dib24(width, height, rgb);
  const fileHeader = Buffer.alloc(14);
  fileHeader.write('BM', 0, 'binary');
  fileHeader.writeUInt32LE(14 + dib.length, 2);
  fileHeader.writeUInt32LE(14 + 40, 10);
  return Buffer.concat([fileHeader, dib]);
}

function icoFile(entries: readonly Readonly<{ width: number; height: number; payload: Buffer }>[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.width >= 256 ? 0 : entry.width;
    directory[base + 1] = entry.height >= 256 ? 0 : entry.height;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(entry.payload.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.payload.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.payload)]);
}

async function firstPixel(bytes: Buffer): Promise<readonly number[]> {
  const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!, data[3]!];
}

describe('prepareSessionMediaImageForDisplay', () => {
  it('passes small PNG, JPEG, GIF and WebP bytes through unchanged with their dimensions', async () => {
    for (const [format, mimeType] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp']] as const) {
      const bytes = await (await solidImage(40, 30)).toFormat(format).toBuffer();

      const result = await prepareSessionMediaImageForDisplay(bytes);

      expect(result).toEqual({
        ok: true,
        image: { bytes, mimeType, width: 40, height: 30, sourceMimeType: mimeType },
      });
    }
  });

  it('converts TIFF, AVIF and SVG to PNG', async () => {
    const tiff = await (await solidImage(40, 30)).tiff().toBuffer();
    const avif = await (await solidImage(40, 30)).avif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#c8280a"/></svg>');

    for (const [bytes, sourceMimeType] of [[tiff, 'image/tiff'], [avif, 'image/avif'], [svg, 'image/svg+xml']] as const) {
      const result = await prepareSessionMediaImageForDisplay(bytes);

      expect(result).toMatchObject({ ok: true, image: { mimeType: 'image/png', width: 40, height: 30, sourceMimeType } });
      if (!result.ok) continue;
      expect(sniffSessionMediaMimeType(result.image.bytes)).toBe('image/png');
    }
  });

  it('decodes 24-bit BMP files to PNG with the right colors and orientation', async () => {
    const result = await prepareSessionMediaImageForDisplay(bmpFile(5, 3, [200, 40, 10]));

    expect(result).toMatchObject({ ok: true, image: { mimeType: 'image/png', width: 5, height: 3, sourceMimeType: 'image/bmp' } });
    if (!result.ok) return;
    expect(await firstPixel(result.image.bytes)).toEqual([200, 40, 10, 255]);
  });

  it('shows the largest ICO entry, both for PNG and for DIB payloads', async () => {
    const png32 = await (await solidImage(32, 32)).png().toBuffer();
    const fromPng = await prepareSessionMediaImageForDisplay(icoFile([
      { width: 16, height: 16, payload: dib24(16, 16, [0, 0, 255], 2) },
      { width: 32, height: 32, payload: png32 },
    ]));
    expect(fromPng).toMatchObject({ ok: true, image: { mimeType: 'image/png', width: 32, height: 32, sourceMimeType: 'image/x-icon' } });

    // A DIB payload has a doubled height (color rows plus the AND mask) and no file header.
    const andMask = Buffer.alloc(4 * 4);
    const fromDib = await prepareSessionMediaImageForDisplay(icoFile([
      { width: 4, height: 4, payload: Buffer.concat([dib24(4, 4, [10, 200, 30], 2), andMask]) },
    ]));
    expect(fromDib).toMatchObject({ ok: true, image: { mimeType: 'image/png', width: 4, height: 4 } });
    if (!fromDib.ok) return;
    expect(await firstPixel(fromDib.image.bytes)).toEqual([10, 200, 30, 255]);
  });

  it('scales large images down to the display bounds', async () => {
    const bytes = await (await solidImage(4000, 1000)).png().toBuffer();

    const result = await prepareSessionMediaImageForDisplay(bytes);

    expect(result).toMatchObject({ ok: true, image: { width: 2048, height: 512, sourceMimeType: 'image/png' } });
  });

  it('re-encodes images over the byte budget as WebP', async () => {
    // A photo-like gradient with fine grain: large as PNG, small as lossy WebP.
    const pixels = Buffer.alloc(600 * 600 * 3);
    for (let index = 0; index < pixels.length; index += 1) {
      const pixel = Math.floor(index / 3);
      pixels[index] = ((pixel % 600) * 0.4 + Math.floor(pixel / 600) * 0.2 + ((pixel * 2654435761) >>> 28)) & 0xff;
    }
    const bytes = await sharp(pixels, { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer();

    const result = await prepareSessionMediaImageForDisplay(bytes, { maxBytes: bytes.length - 1 });

    expect(result).toMatchObject({ ok: true, image: { mimeType: 'image/webp', width: 600, height: 600 } });
    if (!result.ok) return;
    expect(result.image.bytes.length).toBeLessThan(bytes.length);
  });

  it('converts HEIC on this machine, or names the missing decoder', async () => {
    const result = await prepareSessionMediaImageForDisplay(Buffer.from(HEIC_40X30_BASE64, 'base64'));

    if (result.ok) {
      // sharp with an HEVC decoder, or a HEIF decoder on the machine, converts it.
      expect(result.image).toMatchObject({ mimeType: 'image/png', width: 40, height: 30, sourceMimeType: 'image/heic' });
      return;
    }
    expect(result.code).toBe('image_decode_unavailable');
    expect(result.error).toContain('image/heic');
  });

  it('converts HEIC with the system HEIF decoder when the image library has no HEVC decoder', async () => {
    const png = await (await solidImage(40, 30)).png().toBuffer();
    const decodeHeif = async () => png;
    const result = await prepareSessionMediaImageForDisplay(Buffer.from(HEIC_40X30_BASE64, 'base64'), { decodeHeif });

    expect(result).toMatchObject({ ok: true, image: { mimeType: 'image/png', width: 40, height: 30, sourceMimeType: 'image/heic' } });
  });

  it('names the tools to install when no HEIF decoder is available', async () => {
    const result = await prepareSessionMediaImageForDisplay(Buffer.from(HEIC_40X30_BASE64, 'base64'), { decodeHeif: async () => null });

    if (result.ok) {
      // A sharp build with an HEVC decoder never asks the system decoder.
      expect(result.image.sourceMimeType).toBe('image/heic');
      return;
    }
    expect(result.code).toBe('image_decode_unavailable');
    expect(result.error).toContain('heif-dec');
  });

  it('rejects bytes that are not an image, and unsafe SVG', async () => {
    expect(await prepareSessionMediaImageForDisplay(Buffer.from('hello world'))).toMatchObject({ ok: false, code: 'not_an_image' });
    expect(await prepareSessionMediaImageForDisplay(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))
      .toMatchObject({ ok: false, code: 'not_an_image' });
  });
});
