import { Platform } from 'react-native';

import { loadSyncTuning } from '@/sync/runtime/syncTuning';
import { LruMap } from '@/utils/cache/lruMap';

import { createPersistedTranscriptItemHeightStore, type TranscriptItemHeightStore } from './transcriptItemHeightStore';

export type TranscriptItemHeightRowState =
    | 'stable'
    | 'streaming'
    | 'thinking'
    | 'pending-action'
    | 'tool-progress';

export type TranscriptItemHeightValiditySignature = Readonly<{
    itemId: string;
    kind: string;
    structuralKey: string;
    widthBucket: string;
    fontScaleKey: string;
    groupingMode: string;
    forkContextKey: string;
    expansionKey: string;
    rowState: TranscriptItemHeightRowState;
    /**
     * The row's key in the on-disk height store, built from ids that survive an app restart.
     * Absent for a row with no such identity, which is then kept in memory only. Not part of
     * {@link buildTranscriptItemHeightSignatureKey}: the in-memory key stays the local one.
     */
    persistedKey?: string;
}>;

export type TranscriptItemHeightCacheEntry = Readonly<{
    heightPx: number;
}>;

export type TranscriptItemHeightCache = Readonly<{
    delete(signature: TranscriptItemHeightValiditySignature): boolean;
    get(signature: TranscriptItemHeightValiditySignature): TranscriptItemHeightCacheEntry | undefined;
    set(signature: TranscriptItemHeightValiditySignature, entry: TranscriptItemHeightCacheEntry): boolean;
    clear(): void;
    size(): number;
}>;

export type TranscriptItemHeightCacheOptions = Readonly<{
    maxEntries?: number;
    /** Heights that outlive the process; read on a memory miss, written on every change. */
    store?: TranscriptItemHeightStore;
}>;

export function buildTranscriptItemHeightSignatureKey(
    signature: TranscriptItemHeightValiditySignature,
): string {
    return `${signature.itemId.length}:${signature.itemId}|` +
        `${signature.kind.length}:${signature.kind}|` +
        `${signature.structuralKey.length}:${signature.structuralKey}|` +
        `${signature.widthBucket.length}:${signature.widthBucket}|` +
        `${signature.fontScaleKey.length}:${signature.fontScaleKey}|` +
        `${signature.groupingMode.length}:${signature.groupingMode}|` +
        `${signature.forkContextKey.length}:${signature.forkContextKey}|` +
        `${signature.expansionKey.length}:${signature.expansionKey}|` +
        `${signature.rowState.length}:${signature.rowState}|`;
}

export function isTranscriptItemHeightSignatureStable(
    signature: TranscriptItemHeightValiditySignature,
): boolean {
    return (
        signature.rowState === 'stable' &&
        hasText(signature.itemId) &&
        hasText(signature.kind) &&
        hasText(signature.structuralKey) &&
        hasText(signature.widthBucket) &&
        hasText(signature.fontScaleKey) &&
        hasText(signature.groupingMode) &&
        hasText(signature.forkContextKey) &&
        hasText(signature.expansionKey)
    );
}

export function createDefaultTranscriptItemHeightCache(
    options: TranscriptItemHeightCacheOptions = {},
): TranscriptItemHeightCache {
    const maxEntries = options.maxEntries ?? loadSyncTuning().transcriptItemHeightCacheMaxEntries;
    const entries = new LruMap<string, TranscriptItemHeightCacheEntry>({ maxEntries });
    const store = options.store;

    return {
        delete(signature) {
            if (!isTranscriptItemHeightSignatureStable(signature)) return false;
            if (signature.persistedKey !== undefined) store?.delete(signature.persistedKey);
            return entries.delete(buildTranscriptItemHeightSignatureKey(signature));
        },
        get(signature) {
            if (!isTranscriptItemHeightSignatureStable(signature)) return undefined;
            const key = buildTranscriptItemHeightSignatureKey(signature);
            const inMemory = entries.get(key);
            if (inMemory !== undefined || store === undefined || signature.persistedKey === undefined) return inMemory;
            const storedHeightPx = store.get(signature.persistedKey);
            // Device QA only (exp/row-calibration).
            storeReads[storedHeightPx === undefined ? 'miss' : 'hit'] += 1;
            if ((storeReads.hit + storeReads.miss) % 10 === 1) console.log('HAPPIER_HEIGHT_STORE', JSON.stringify(storeReads));
            if (storedHeightPx === undefined || !isValidHeight(storedHeightPx)) return undefined;
            const restored = { heightPx: storedHeightPx };
            entries.set(key, restored);
            return restored;
        },
        set(signature, entry) {
            if (!isTranscriptItemHeightSignatureStable(signature)) return false;
            if (!isValidHeight(entry.heightPx)) return false;
            const key = buildTranscriptItemHeightSignatureKey(signature);
            if (signature.persistedKey !== undefined && entries.get(key)?.heightPx !== entry.heightPx) {
                store?.set(signature.persistedKey, entry.heightPx);
                storeReads.write += 1;
            }
            entries.set(key, {
                heightPx: entry.heightPx,
            });
            return true;
        },
        clear() {
            entries.clear();
            store?.clear();
        },
        size() {
            return entries.size;
        },
    };
}

export function createTestTranscriptItemHeightCache(
    options?: TranscriptItemHeightCacheOptions,
): TranscriptItemHeightCache {
    return createDefaultTranscriptItemHeightCache(options);
}

const storeReads = { hit: 0, miss: 0, write: 0 };

let defaultCacheInstance: TranscriptItemHeightCache | null = null;

export function getDefaultTranscriptItemHeightCache(
    options?: TranscriptItemHeightCacheOptions,
): TranscriptItemHeightCache {
    if (defaultCacheInstance === null) {
        // Native only: web MMKV is `localStorage`, a small quota shared with the rest of the app.
        const storeMaxEntries = Platform.OS === 'web' ? 0 : loadSyncTuning().transcriptItemHeightStoreMaxEntries;
        defaultCacheInstance = createDefaultTranscriptItemHeightCache({
            ...(storeMaxEntries > 0 ? { store: createPersistedTranscriptItemHeightStore({ maxEntries: storeMaxEntries }) } : {}),
            ...options,
        });
    }
    return defaultCacheInstance;
}

export function __resetDefaultTranscriptItemHeightCacheForTests(): void {
    defaultCacheInstance?.clear();
    defaultCacheInstance = null;
}

function hasText(value: string): boolean {
    return value.length > 0;
}

function isValidHeight(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}
