import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

export type SessionPreloadTarget = Readonly<{ sessionId: string; serverId: string | null }>;

/**
 * The chats the reader is most likely to open next are the ones at the top of the list they are
 * looking at, so the app-start preload keeps the first rows of the drawn list rendered rather than
 * the last chat that had focus: those are usually the same row, but a pinned or attention-promoted
 * chat moves above it, and a hidden chat costs about a second to render, while preloading it turns
 * a ~1.45 s open into a ~0.55 s one (measured on the 8T).
 *
 * The caller passes the visible rows (SessionsListWrapper, the production list surface, which
 * already computes them), so the pinned, attention and working bands are honoured without this
 * helper rebuilding the list; it also passes how many hidden chats it wants
 * (MAX_PRELOADED_SESSION_ROUTES) — one hidden session tree costs 13-15 MB.
 *
 * Headers, folders and hidden system sessions are skipped: only a row that opens a chat qualifies.
 * A chat drawn twice is kept once: the stack keys a preloaded route by its session and server, so a
 * second request for it would replace the first rather than add a route.
 */
export function resolveSessionPreloadTargets(
    rows: readonly SessionListViewItem[] | null | undefined,
    limit: number,
): SessionPreloadTarget[] {
    const max = Math.max(0, Math.trunc(limit));
    const targets: SessionPreloadTarget[] = [];
    for (const row of rows ?? []) {
        if (targets.length >= max) break;
        if (row.type !== 'session') continue;
        if (!isUserFacingSession(row.session)) continue;
        const sessionId = String(row.session.id ?? '').trim();
        if (!sessionId) continue;
        const serverId = row.serverId ?? null;
        if (targets.some((target) => target.sessionId === sessionId && target.serverId === serverId)) continue;
        targets.push({ sessionId, serverId });
    }
    return targets;
}
