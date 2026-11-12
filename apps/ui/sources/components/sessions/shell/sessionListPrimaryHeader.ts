import type { SessionListViewItem } from '@/sync/domains/state/storage';

type SessionListHeaderKind = Extract<SessionListViewItem, { type: 'header' }>['headerKind'];

const SESSION_LIST_PRIMARY_HEADER_KINDS = new Set<SessionListHeaderKind>([
    'attention',
    'working',
    'pinned',
    'active',
    'inactive',
    'archived',
    'sessions',
]);

export function isSessionListPrimaryHeaderKind(headerKind: SessionListHeaderKind | null | undefined): boolean {
    return typeof headerKind === 'string' && SESSION_LIST_PRIMARY_HEADER_KINDS.has(headerKind);
}

type SessionListHeaderItem = Extract<SessionListViewItem, { type: 'header' }>;

/**
 * The header controls (search, visibility menu, view menu) render on a primary section header.
 * A list without one (an empty visibility scope, a search with no match) gets a bare header at
 * the top, so the user can still change the filter.
 */
export function withPrimaryHeaderFallback(
    items: ReadonlyArray<SessionListViewItem>,
    fallbackHeader: Readonly<{ title: string; headerKind: 'sessions' | 'archived' }>,
): ReadonlyArray<SessionListViewItem> {
    for (const item of items) {
        if (item.type === 'header' && isSessionListPrimaryHeaderKind(item.headerKind)) return items;
    }
    const header: SessionListHeaderItem = {
        type: 'header',
        title: fallbackHeader.title,
        headerKind: fallbackHeader.headerKind,
        groupKey: `${fallbackHeader.headerKind}:controls-fallback`,
    };
    return [header, ...items];
}
