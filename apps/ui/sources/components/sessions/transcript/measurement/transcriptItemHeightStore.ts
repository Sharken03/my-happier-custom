import { MMKV } from 'react-native-mmkv';

/** Measured row heights that outlive the app process, keyed by the height signature key. */
export type TranscriptItemHeightStore = Readonly<{
    get(key: string): number | undefined;
    set(key: string, heightPx: number): void;
    delete(key: string): void;
    clear(): void;
}>;

const STORE_ID = 'transcript-item-heights.v1';
const ENTRY_COUNT_KEY = '#count';

/**
 * Heights in their own MMKV file (memory mapped: a read or a write is a synchronous lookup, with
 * no bridge round trip and no JSON). `maxEntries` bounds the file on disk: one entry is a signature
 * key of about 200 bytes plus a number. A full store starts over, because MMKV keeps no usage
 * order to evict by; the rows on screen are measured and stored again as they paint.
 */
export function createPersistedTranscriptItemHeightStore(options: Readonly<{ maxEntries: number }>): TranscriptItemHeightStore {
    const storage = new MMKV({ id: STORE_ID });
    let entryCount = storage.getNumber(ENTRY_COUNT_KEY) ?? 0;

    return {
        get(key) {
            return storage.getNumber(key);
        },
        set(key, heightPx) {
            const isNewEntry = storage.getNumber(key) === undefined;
            if (isNewEntry && entryCount >= options.maxEntries) this.clear();
            storage.set(key, heightPx);
            if (isNewEntry) {
                entryCount += 1;
                storage.set(ENTRY_COUNT_KEY, entryCount);
            }
        },
        delete(key) {
            if (storage.getNumber(key) === undefined) return;
            storage.delete(key);
            entryCount = Math.max(0, entryCount - 1);
            storage.set(ENTRY_COUNT_KEY, entryCount);
        },
        clear() {
            storage.clearAll();
            entryCount = 0;
        },
    };
}
