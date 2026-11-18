import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
    files: new Map<string, string>(),
    iosShare: vi.fn(async (_uri: string, _options?: Record<string, unknown>) => {}),
    iosAvailable: vi.fn(async () => true),
    androidShare: vi.fn(async (_uri: string, _name: string, _title?: string) => {}),
    androidSave: vi.fn(async (_uri: string, _name: string) => ({ canceled: false })),
}));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
// Genuine Expo and native-module boundaries: the real cache writer runs beneath them.
vi.mock('expo-file-system', async () => {
    const { createExpoFileSystemMock } = await import('@/dev/testkit/mocks/expoFileSystem');
    const fixture = createExpoFileSystemMock();
    sdk.files = fixture.files;
    return fixture.module;
});
vi.mock('expo-sharing', () => ({ shareAsync: sdk.iosShare, isAvailableAsync: sdk.iosAvailable }));
vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: () => ({ shareFile: sdk.androidShare, saveFile: sdk.androidSave }),
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

import { Platform } from 'react-native';

import { resolveViewerImageFileName, saveViewerImage, shareViewerImage } from './imageViewerActions';

const pngBytes = new Uint8Array([137, 80, 78, 71]);
const fetchMock = vi.fn(async (_uri: string) => new Response(new Blob([pngBytes], { type: 'image/png' })));

beforeEach(() => {
    sdk.files.clear();
    for (const fn of [sdk.iosShare, sdk.androidShare, sdk.androidSave]) fn.mockClear();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('resolveViewerImageFileName', () => {
    it('keeps a title that is already an image file name', () => {
        expect(resolveViewerImageFileName({ title: 'shot.webp', uri: 'blob:x', mimeType: 'image/webp' })).toBe('shot.webp');
    });

    it('takes the URL file name for a markdown image with alt text', () => {
        expect(resolveViewerImageFileName({ title: 'A chart', uri: 'https://img.example.org/a/chart.png?x=1', mimeType: null })).toBe('chart.png');
    });

    it('adds the extension of the MIME type when the source has no file name', () => {
        expect(resolveViewerImageFileName({ title: 'A chart', uri: 'blob:abc', mimeType: 'image/jpeg' })).toBe('A chart.jpg');
    });
});

describe('native share and save', () => {
    it('shares a local preview file through the Android chooser without copying it', async () => {
        Platform.OS = 'android';
        await shareViewerImage({ uri: 'file:///cache/happier-previews/p-shot.png', name: 'shot.png', mimeType: 'image/png' });
        expect(sdk.androidShare).toHaveBeenCalledWith('file:///cache/happier-previews/p-shot.png', 'shot.png', 'shot.png');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('downloads a remote image into the cache and opens the Android save dialog', async () => {
        Platform.OS = 'android';
        let savedBytes = '';
        sdk.androidSave.mockImplementation(async (uri: string) => {
            savedBytes = sdk.files.get(uri) ?? '';
            return { canceled: false };
        });
        await saveViewerImage({ uri: 'https://img.example.org/chart.png', name: 'chart.png', mimeType: 'image/png' });
        const [uri, name] = sdk.androidSave.mock.calls[0] ?? [];
        expect(uri).toMatch(/^file:\/\/\/cache\/happier-downloads\/.+-chart\.png$/);
        expect(name).toBe('chart.png');
        expect(savedBytes.length).toBeGreaterThan(0);
        // The temporary copy is removed once the save dialog has the bytes.
        expect(sdk.files.has(uri as string)).toBe(false);
    });

    it('uses the iOS share sheet for save, which offers Save Image', async () => {
        Platform.OS = 'ios';
        await saveViewerImage({ uri: 'file:///cache/happier-previews/p-shot.png', name: 'shot.png', mimeType: 'image/png' });
        expect(sdk.iosShare).toHaveBeenCalledWith('file:///cache/happier-previews/p-shot.png', expect.objectContaining({ mimeType: 'image/png' }));
        expect(sdk.androidSave).not.toHaveBeenCalled();
    });
});

describe('web share and save', () => {
    beforeEach(() => {
        Platform.OS = 'web';
    });

    it('hands the image file to the Web Share API when the browser can share files', async () => {
        const share = vi.fn(async (_data: { files?: File[] }) => {});
        vi.stubGlobal('navigator', { canShare: () => true, share });
        await shareViewerImage({ uri: 'blob:preview', name: 'shot.png', mimeType: 'image/png' });
        const file = share.mock.calls[0]?.[0].files?.[0];
        expect(file?.name).toBe('shot.png');
        expect(file?.type).toBe('image/png');
    });

    it('downloads the image when the browser cannot share files', async () => {
        const anchors: Array<{ href: string; download: string; clicked: boolean }> = [];
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('document', {
            createElement: () => {
                const anchor = { href: '', download: '', clicked: false, click() { anchor.clicked = true; } };
                anchors.push(anchor);
                return anchor;
            },
        });
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        try {
            await shareViewerImage({ uri: 'blob:preview', name: 'shot.png', mimeType: 'image/png' });
            expect(anchors).toEqual([expect.objectContaining({ href: 'blob:download', download: 'shot.png', clicked: true })]);
        } finally {
            createObjectURL.mockRestore();
            revokeObjectURL.mockRestore();
        }
    });

    it('opens a remote image the browser may not read in a new tab', async () => {
        const anchors: Array<{ href: string; target: string; clicked: boolean }> = [];
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        vi.stubGlobal('document', {
            createElement: () => {
                const anchor = { href: '', target: '', rel: '', clicked: false, click() { anchor.clicked = true; } };
                anchors.push(anchor);
                return anchor;
            },
        });
        await saveViewerImage({ uri: 'https://img.example.org/chart.png', name: 'chart.png', mimeType: null });
        expect(anchors).toEqual([expect.objectContaining({ href: 'https://img.example.org/chart.png', target: '_blank', clicked: true })]);
    });

    it('ignores a share the user cancels', async () => {
        const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
        vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn(async () => { throw abort; }) });
        await expect(shareViewerImage({ uri: 'blob:preview', name: 'shot.png', mimeType: 'image/png' })).resolves.toBeUndefined();
    });
});
