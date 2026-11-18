import { describe, expect, it } from 'vitest';

import { sniffSessionMediaMimeType, sniffSessionMediaSourceImageType } from './sessionMediaMime';

describe('sniffSessionMediaMimeType', () => {
  it('sniffs PNG bytes', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(sniffSessionMediaMimeType(bytes)).toBe('image/png');
  });

  it('sniffs JPEG bytes', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    expect(sniffSessionMediaMimeType(bytes)).toBe('image/jpeg');
  });

  it('sniffs WebP bytes', () => {
    const bytes = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');

    expect(sniffSessionMediaMimeType(bytes)).toBe('image/webp');
  });
});

describe('sniffSessionMediaSourceImageType', () => {
  function isoBmff(majorBrand: string, compatibleBrands: readonly string[] = []): Buffer {
    const brands = Buffer.from([majorBrand, '\0\0\0\0', ...compatibleBrands].join(''), 'binary');
    const size = Buffer.alloc(4);
    size.writeUInt32BE(8 + brands.length);
    return Buffer.concat([size, Buffer.from('ftyp', 'binary'), brands]);
  }

  it('sniffs the image types that the display pipeline converts', () => {
    const bmp = Buffer.alloc(30);
    bmp.write('BM', 0, 'binary');
    bmp.writeUInt32LE(40, 14);
    expect(sniffSessionMediaSourceImageType(bmp)).toBe('image/bmp');
    expect(sniffSessionMediaSourceImageType(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('image/x-icon');
    expect(sniffSessionMediaSourceImageType(Buffer.from('II*\0', 'binary'))).toBe('image/tiff');
    expect(sniffSessionMediaSourceImageType(Buffer.from('MM\0*', 'binary'))).toBe('image/tiff');
    expect(sniffSessionMediaSourceImageType(isoBmff('avif', ['mif1']))).toBe('image/avif');
    expect(sniffSessionMediaSourceImageType(isoBmff('heic', ['mif1']))).toBe('image/heic');
    expect(sniffSessionMediaSourceImageType(isoBmff('mif1', ['heix']))).toBe('image/heic');
    expect(sniffSessionMediaSourceImageType(isoBmff('mif1', ['avif']))).toBe('image/avif');
    expect(sniffSessionMediaSourceImageType(isoBmff('mif1'))).toBe('image/heif');
  });

  it('keeps the session media types and rejects other ISO media and unknown bytes', () => {
    expect(sniffSessionMediaSourceImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffSessionMediaSourceImageType(isoBmff('isom', ['mp41']))).toBeNull();
    expect(sniffSessionMediaSourceImageType(Buffer.from('plain text', 'utf8'))).toBeNull();
    // A "BM" prefix without a DIB header is too weak: ordinary text can start with it.
    expect(sniffSessionMediaSourceImageType(Buffer.from('BMW owners manual', 'utf8'))).toBeNull();
  });
});
