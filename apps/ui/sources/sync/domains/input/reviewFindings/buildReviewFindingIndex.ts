import type {
    ReviewFindingsV1,
    ReviewFindingsV2,
    ReviewResolutionState,
} from '@happier-dev/protocol';

import type { ReviewFindingIndexEntry } from './reviewFindingIndexTypes';

export type ReviewFindingsPayload = ReviewFindingsV1 | ReviewFindingsV2;

function isV2(payload: ReviewFindingsPayload): payload is ReviewFindingsV2 {
    return 'overviewMarkdown' in payload && typeof (payload as ReviewFindingsV2).overviewMarkdown === 'string';
}

type ResolutionEntry = Readonly<{ state: ReviewResolutionState; updatedAtMs?: number }>;

/**
 * Pure mapping from one run's `review_findings.v1|v2` payload into flat index
 * entries. v1 payloads carry no overlays, so every finding is indexed as
 * unpublished and implicitly `open`; v2 payloads read the `publication` and
 * `resolution` overlays per finding id.
 */
export function buildReviewFindingIndex(
    payload: ReviewFindingsPayload,
    runId: string,
): readonly ReviewFindingIndexEntry[] {
    const publishedByFindingId = new Map<string, boolean>();
    const publishedAtByFindingId = new Map<string, number>();
    const resolutionByFindingId = new Map<string, ResolutionEntry>();

    if (isV2(payload)) {
        for (const entry of payload.publication?.findings ?? []) {
            publishedByFindingId.set(entry.id, entry.published);
            if (entry.publishedAtMs !== undefined) publishedAtByFindingId.set(entry.id, entry.publishedAtMs);
        }
        for (const entry of payload.resolution?.findings ?? []) {
            resolutionByFindingId.set(entry.id, {
                state: entry.state,
                ...(entry.updatedAtMs !== undefined ? { updatedAtMs: entry.updatedAtMs } : {}),
            });
        }
    }

    return (payload.findings ?? []).map((finding) => {
        const published = publishedByFindingId.get(finding.id) ?? false;
        const resolution = resolutionByFindingId.get(finding.id);
        const updatedAtMs = resolution?.updatedAtMs
            ?? (published ? publishedAtByFindingId.get(finding.id) : undefined)
            ?? payload.generatedAtMs;

        return {
            runId,
            findingId: finding.id,
            severity: finding.severity,
            category: finding.category,
            ...(finding.filePath !== undefined ? { filePath: finding.filePath } : {}),
            ...(finding.startLine !== undefined ? { startLine: finding.startLine } : {}),
            title: finding.title,
            published,
            resolutionState: resolution?.state ?? 'open',
            updatedAtMs,
        };
    });
}
