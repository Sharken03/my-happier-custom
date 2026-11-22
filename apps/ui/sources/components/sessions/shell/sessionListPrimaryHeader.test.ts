import { describe, expect, it } from 'vitest';

import type { SessionListViewItem } from '@/sync/domains/state/storage';

import { withSessionListControlsHeader } from './sessionListPrimaryHeader';

const session = { type: 'session', session: { id: 's1' } } as unknown as SessionListViewItem;
const activeHeader: SessionListViewItem = { type: 'header', title: 'Active', headerKind: 'active', groupKey: 'active' };

describe('withSessionListControlsHeader', () => {
    it('adds a Sessions header to an Active list without sessions', () => {
        const items = withSessionListControlsHeader([], 'active');
        expect(items).toEqual([{ type: 'header', title: 'Sessions', headerKind: 'sessions', groupKey: 'sessions:controls-fallback' }]);
    });

    it('keeps an Active list with sessions as it is', () => {
        const list = [session];
        expect(withSessionListControlsHeader(list, 'active')).toBe(list);
    });

    it('adds an Archived header only when no primary header is there', () => {
        expect(withSessionListControlsHeader([], 'archived')[0]).toMatchObject({ title: 'Archived', headerKind: 'sessions' });
        const list = [activeHeader, session];
        expect(withSessionListControlsHeader(list, 'archived')).toBe(list);
    });
});
