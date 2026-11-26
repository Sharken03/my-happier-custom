import type { SessionListViewItem } from '@/sync/domains/state/storage';
import type { SessionListVisibilityScope } from '@/sync/domains/session/listing/sessionListOrderingRules';

type SessionListHeaderKind = Extract<SessionListViewItem, { type: 'header' }>['headerKind'];

const SESSION_LIST_PRIMARY_HEADER_KINDS = new Set<SessionListHeaderKind>([
    'attention',
    'working',
    'pinned',
    'active',
    'inactive',
    'sessions',
]);

export function isSessionListPrimaryHeaderKind(headerKind: SessionListHeaderKind | null | undefined): boolean {
    return typeof headerKind === 'string' && SESSION_LIST_PRIMARY_HEADER_KINDS.has(headerKind);
}

type SessionListHeaderItem = Extract<SessionListViewItem, { type: 'header' }>;

/**
 * The header controls (visibility menu, search, view menu) render on a primary section header.
 * An Archived scope list without one (no archived sessions, a search with no match) gets a bare
 * header at the top, so the user can still switch back to Active.
 */
export function withPrimaryHeaderFallback(
    items: ReadonlyArray<SessionListViewItem>,
    fallbackHeader: Readonly<{ title: string }>,
): ReadonlyArray<SessionListViewItem> {
    for (const item of items) {
        if (item.type === 'header' && isSessionListPrimaryHeaderKind(item.headerKind)) return items;
    }
    const header: SessionListHeaderItem = {
        type: 'header',
        title: fallbackHeader.title,
        headerKind: 'sessions',
        groupKey: 'sessions:controls-fallback',
    };
    return [header, ...items];
}

/**
 * The list items with a header for the controls when the list needs one. The Archived scope
 * always gets the controls. The Active scope gets them when it shows no session (for example
 * only drafts), so the user can still open Archived or show stopped sessions.
 */
export function withSessionListControlsHeader(
    items: ReadonlyArray<SessionListViewItem>,
    scope: SessionListVisibilityScope,
): ReadonlyArray<SessionListViewItem> {
    if (scope === 'archived') return withPrimaryHeaderFallback(items, { title: 'Archived' });
    if (items.some((item) => item.type === 'session')) return items;
    return withPrimaryHeaderFallback(items, { title: 'Sessions' });
}
