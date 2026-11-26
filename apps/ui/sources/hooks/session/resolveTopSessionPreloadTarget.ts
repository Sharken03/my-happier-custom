import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

export type SessionPreloadTarget = Readonly<{ sessionId: string; serverId: string | null }>;

/**
 * The chat the reader is most likely to open next is the one at the top of the list they are looking
 * at, so the app-start preload targets the first row of the drawn list rather than the last chat
 * that had focus: those are usually the same row, but a pinned or attention-promoted chat moves
 * above it, and a hidden chat render costs about a second — preloading the wrong one wastes it.
 *
 * The caller passes the visible rows (SessionsList, which already computes them), so the pinned,
 * attention and working bands are honoured without this helper rebuilding the list.
 *
 * Headers, folders and hidden system sessions are skipped: only a row that opens a chat qualifies.
 * Returns the first `limit` such rows in list order; the first one is the top row.
 */
export function resolveSessionPreloadTargets(
    rows: readonly SessionListViewItem[] | null | undefined,
    limit: number,
): SessionPreloadTarget[] {
    const targets: SessionPreloadTarget[] = [];
    for (const row of rows ?? []) {
        if (targets.length >= limit) break;
        if (row.type !== 'session') continue;
        if (!isUserFacingSession(row.session)) continue;
        const sessionId = String(row.session.id ?? '').trim();
        if (!sessionId) continue;
        targets.push({ sessionId, serverId: row.serverId ?? null });
    }
    return targets;
}
