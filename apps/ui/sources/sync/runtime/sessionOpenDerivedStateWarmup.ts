import { buildSessionMetadataStabilitySignature } from '@/sync/domains/session/metadata/sessionMetadataStability';
import { readSessionModelsState } from '@/sync/domains/sessionControl/readSessionControlMetadata';
import type { Metadata } from '@/sync/domains/state/storageTypes';

/**
 * Fills the per-metadata caches that the session screen reads when the session opens.
 *
 * Both values are cached per metadata object, so the first open of a session pays for them. On a
 * phone that is about 40 ms for a model catalog with hundreds of entries, plus the metadata
 * stability signature. A background prewarm (the rows after the top one at app start) calls this,
 * so the cost falls while the reader looks at the list, not after the tap.
 */
export function warmSessionOpenDerivedState(metadata: Metadata | null | undefined): void {
    if (!metadata) return;
    readSessionModelsState(metadata);
    buildSessionMetadataStabilitySignature(metadata);
}
