import { describe, expect, it } from 'vitest';

import { createDefaultTranscriptItemHeightCache, type TranscriptItemHeightValiditySignature } from './transcriptItemHeightCache';
import { createPersistedTranscriptItemHeightStore } from './transcriptItemHeightStore';

const signature = (itemId: string): TranscriptItemHeightValiditySignature => ({
    itemId,
    kind: 'message',
    structuralKey: 's',
    widthBucket: 'w360',
    fontScaleKey: 'f1',
    groupingMode: 'g',
    forkContextKey: 'k',
    expansionKey: 'e',
    rowState: 'stable',
});

describe('persisted transcript item heights', () => {
    it('serves a measured height to a cache created after an app restart', () => {
        const first = createDefaultTranscriptItemHeightCache({ store: createPersistedTranscriptItemHeightStore({ maxEntries: 10 }) });
        first.set(signature('m1'), { heightPx: 155 });

        const afterRestart = createDefaultTranscriptItemHeightCache({ store: createPersistedTranscriptItemHeightStore({ maxEntries: 10 }) });
        expect(afterRestart.get(signature('m1'))).toEqual({ heightPx: 155 });
        expect(afterRestart.get(signature('m2'))).toBeUndefined();
    });

    it('forgets an invalidated height', () => {
        const store = createPersistedTranscriptItemHeightStore({ maxEntries: 10 });
        const cache = createDefaultTranscriptItemHeightCache({ store });
        cache.set(signature('m1'), { heightPx: 155 });
        cache.delete(signature('m1'));

        expect(createDefaultTranscriptItemHeightCache({ store }).get(signature('m1'))).toBeUndefined();
    });

    it('starts over when the store is full, and keeps serving new heights', () => {
        const store = createPersistedTranscriptItemHeightStore({ maxEntries: 2 });
        const cache = createDefaultTranscriptItemHeightCache({ store });
        cache.set(signature('m1'), { heightPx: 10 });
        cache.set(signature('m2'), { heightPx: 20 });
        cache.set(signature('m3'), { heightPx: 30 });

        const afterRestart = createDefaultTranscriptItemHeightCache({ store: createPersistedTranscriptItemHeightStore({ maxEntries: 2 }) });
        expect(afterRestart.get(signature('m1'))).toBeUndefined();
        expect(afterRestart.get(signature('m3'))).toEqual({ heightPx: 30 });
    });
});
