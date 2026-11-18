export type SupportedSessionMediaMimeType =
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'image/svg+xml';

const EXTENSIONS_BY_MIME: Record<SupportedSessionMediaMimeType, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
};

const MIME_BY_EXTENSION: Record<string, SupportedSessionMediaMimeType> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

export function normalizeSessionMediaMimeType(value: unknown): SupportedSessionMediaMimeType | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized in EXTENSIONS_BY_MIME) {
        return normalized as SupportedSessionMediaMimeType;
    }
    return null;
}

export function extensionForSessionMediaMimeType(mimeType: SupportedSessionMediaMimeType): string {
    return EXTENSIONS_BY_MIME[mimeType];
}

export function inferSessionMediaMimeTypeFromName(name: string): SupportedSessionMediaMimeType | null {
    const match = name.toLowerCase().match(/\.[^.]+$/);
    return match ? MIME_BY_EXTENSION[match[0]] ?? null : null;
}

function isSafeSvgImageText(value: string): boolean {
    const normalized = value.trimStart().toLowerCase();
    const containsSvgRoot = normalized.startsWith('<svg') || (normalized.startsWith('<?xml') && normalized.includes('<svg'));
    if (!containsSvgRoot) return false;
    if (normalized.includes('<script') || normalized.includes('<foreignobject')) return false;
    if (normalized.includes('javascript:')) return false;
    if (/\son[a-z]+\s*=/.test(normalized)) return false;
    return true;
}

export function sniffSessionMediaMimeType(bytes: Uint8Array): SupportedSessionMediaMimeType | null {
    if (
        bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6) {
        const header = Buffer.from(bytes.subarray(0, 6)).toString('ascii');
        if (header === 'GIF87a' || header === 'GIF89a') {
            return 'image/gif';
        }
    }
    if (bytes.length >= 12) {
        const riff = Buffer.from(bytes.subarray(0, 4)).toString('ascii');
        const webp = Buffer.from(bytes.subarray(8, 12)).toString('ascii');
        if (riff === 'RIFF' && webp === 'WEBP') {
            return 'image/webp';
        }
    }

    const textPrefix = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString('utf8');
    if (isSafeSvgImageText(textPrefix)) {
        return 'image/svg+xml';
    }

    return null;
}

/**
 * Image types a source file can have. Only `SupportedSessionMediaMimeType` values are stored
 * as session media; the others are converted first (see prepareSessionMediaImageForDisplay).
 */
export type SessionMediaSourceImageType =
    | SupportedSessionMediaMimeType
    | 'image/avif'
    | 'image/heic'
    | 'image/heif'
    | 'image/bmp'
    | 'image/x-icon'
    | 'image/tiff';

const BMP_DIB_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);

function sniffIsoBmffImageType(bytes: Uint8Array): SessionMediaSourceImageType | null {
    if (bytes.length < 16) return null;
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
    const boxEnd = Math.min(buffer.readUInt32BE(0), buffer.length);
    // Major brand at 8, minor version at 12, compatible brands from 16.
    const brands = [buffer.toString('ascii', 8, 12)];
    for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
        brands.push(buffer.toString('ascii', offset, offset + 4));
    }
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'image/avif';
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'image/heic';
    if (brands.some((brand) => HEIF_BRANDS.has(brand))) return 'image/heif';
    return null;
}

export function sniffSessionMediaSourceImageType(bytes: Uint8Array): SessionMediaSourceImageType | null {
    const supported = sniffSessionMediaMimeType(bytes);
    if (supported) return supported;
    if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
        const dibHeaderSize = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32LE(14);
        if (BMP_DIB_HEADER_SIZES.has(dibHeaderSize)) return 'image/bmp';
    }
    if (bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && (bytes[4]! > 0 || bytes[5]! > 0)) {
        return 'image/x-icon';
    }
    if (
        bytes.length >= 4
        && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
            || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
    ) {
        return 'image/tiff';
    }
    return sniffIsoBmffImageType(bytes);
}

export function sniffSessionMediaMimeTypeFromBase64(data: string): SupportedSessionMediaMimeType | null {
    try {
        const bytes = Buffer.from(data, 'base64');
        return bytes.byteLength > 0 ? sniffSessionMediaMimeType(bytes) : null;
    } catch {
        return null;
    }
}

export function resolveSessionMediaMimeType(input: Readonly<{
    bytes?: Uint8Array;
    declaredMimeType?: string;
    suggestedName?: string;
}>): SupportedSessionMediaMimeType | null {
    if (input.bytes) {
        return input.bytes.byteLength > 0 ? sniffSessionMediaMimeType(input.bytes) : null;
    }
    return normalizeSessionMediaMimeType(input.declaredMimeType)
        ?? (input.suggestedName ? inferSessionMediaMimeTypeFromName(input.suggestedName) : null);
}
