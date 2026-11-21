import { Platform } from 'react-native';

import { getImageExtensionForMimeType, isKnownImagePath } from '@/scm/utils/filePresentation';
import { createNativeCacheFileSink, shareNativeCacheFile } from '@/sync/runtime/files/nativeCacheFileSink';
import { saveFileBytes } from '@/sync/runtime/files/saveFileBytes';
import { t } from '@/text';

/** The image the viewer shows, as a source the share and save actions can read. */
export type ViewerImageFile = Readonly<{
    /** A loaded `file://`, `content://`, `blob:`, `data:` or `https:` URI. */
    uri: string;
    name: string;
    mimeType: string | null;
}>;

const DOWNLOAD_DIRECTORY_NAME = 'happier-downloads';

function lastPathSegment(uri: string): string | null {
    if (!/^(https?|file):/i.test(uri)) return null;
    try {
        const segment = decodeURIComponent(new URL(uri).pathname.split('/').filter(Boolean).at(-1) ?? '');
        return segment || null;
    } catch {
        return null;
    }
}

/** A file name with an image extension, from the viewer title, the URI or the MIME type. */
export function resolveViewerImageFileName(input: Readonly<{ title: string; uri: string; mimeType: string | null }>): string {
    const title = input.title.trim();
    if (title && isKnownImagePath(title)) return title;
    const fromUri = lastPathSegment(input.uri);
    if (fromUri && isKnownImagePath(fromUri)) return fromUri;
    const base = title || fromUri || 'image';
    const extension = input.mimeType ? getImageExtensionForMimeType(input.mimeType) : null;
    return extension ? `${base}.${extension}` : base;
}

function isLocalNativeUri(uri: string): boolean {
    return /^(file|content):/i.test(uri);
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

async function readBlob(uri: string): Promise<Blob> {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(t('errors.operationFailed'));
    return await response.blob();
}

/**
 * Runs `action` on a local file with the image bytes. A local URI is used as it is; it belongs
 * to the preview cache or the picker, so it is never deleted here. Other URIs are downloaded
 * into the cache first, and the copy is removed unless `action` hands it to another app.
 */
async function withNativeLocalFile(
    file: ViewerImageFile,
    action: (fileUri: string) => Promise<{ retainCopy: boolean }>,
): Promise<void> {
    if (isLocalNativeUri(file.uri)) {
        await action(file.uri);
        return;
    }
    const response = await fetch(file.uri);
    if (!response.ok) throw new Error(t('errors.operationFailed'));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const created = await createNativeCacheFileSink({ directoryName: DOWNLOAD_DIRECTORY_NAME, name: file.name });
    if (!created.ok) throw new Error(created.error);
    let retainCopy = false;
    try {
        await created.sink.writeBytes(bytes);
        await created.sink.close();
        retainCopy = (await action(created.sink.fileUri)).retainCopy;
    } finally {
        if (!retainCopy) await created.sink.cleanup();
    }
}

async function shareNativeFile(file: ViewerImageFile, fileUri: string): Promise<{ retainCopy: boolean }> {
    const result = await shareNativeCacheFile({
        fileUri,
        name: file.name,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        dialogTitle: file.name,
    });
    if (result.status === 'unavailable') throw new Error(t('files.fileSharingUnavailable'));
    return { retainCopy: result.status === 'shared' && result.retainCacheFile };
}

/**
 * Reads a web image, or null for a remote image the page may not read (no CORS headers). The
 * browser can still show that image, so the caller opens it in a new tab instead.
 */
async function readWebBlob(uri: string): Promise<Blob | null> {
    try {
        return await readBlob(uri);
    } catch (error) {
        if (/^https:/i.test(uri)) return null;
        throw error;
    }
}

function openInNewTab(uri: string): void {
    const anchor = document.createElement('a');
    anchor.href = uri;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
}

async function downloadOnWeb(file: ViewerImageFile, blob: Blob): Promise<void> {
    await saveFileBytes({
        name: file.name,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mimeType: file.mimeType ?? blob.type ?? 'application/octet-stream',
        dialogTitle: file.name,
    });
}

/**
 * Opens the system share sheet for the image. On web this is the Web Share API with the image
 * file; a browser that cannot share files downloads the image instead, and a remote image the
 * page may not read opens in a new tab. A cancelled share is not an error.
 */
export async function shareViewerImage(file: ViewerImageFile): Promise<void> {
    if (Platform.OS === 'web') {
        const blob = await readWebBlob(file.uri);
        if (!blob) {
            openInNewTab(file.uri);
            return;
        }
        const shareFile = new File([blob], file.name, { type: file.mimeType ?? blob.type });
        const nav = globalThis.navigator as (Navigator & { canShare?: (data: ShareData) => boolean }) | undefined;
        if (nav?.share && nav.canShare?.({ files: [shareFile] }) === true) {
            try {
                await nav.share({ files: [shareFile], title: file.name });
            } catch (error) {
                if (!isAbortError(error)) throw error;
            }
            return;
        }
        await downloadOnWeb(file, blob);
        return;
    }
    await withNativeLocalFile(file, (fileUri) => shareNativeFile(file, fileUri));
}

/**
 * Saves the image. Android opens the system save dialog, where the user picks a folder such as
 * Downloads. iOS opens the share sheet, which offers Save Image. Web downloads the file, or opens
 * a remote image the page may not read in a new tab.
 */
export async function saveViewerImage(file: ViewerImageFile): Promise<void> {
    if (Platform.OS === 'web') {
        const blob = await readWebBlob(file.uri);
        if (blob) await downloadOnWeb(file, blob);
        else openInNewTab(file.uri);
        return;
    }
    if (Platform.OS === 'android') {
        await withNativeLocalFile(file, async (fileUri) => {
            const { performAndroidFileAction } = await import('@/sync/runtime/files/nativeFileActions');
            await performAndroidFileAction({ fileUri, name: file.name, action: 'save' });
            return { retainCopy: false };
        });
        return;
    }
    await withNativeLocalFile(file, (fileUri) => shareNativeFile(file, fileUri));
}
