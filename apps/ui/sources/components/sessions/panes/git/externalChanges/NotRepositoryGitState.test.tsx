import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const changeSetState = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/sync/domains/session/changes/hooks/useDerivedSessionChangeSet', () => ({
    useDerivedSessionChangeSet: () => ({ sessionChangeSet: changeSetState.value, latestTurnScopedChangeSet: null }),
}));
vi.mock('./SessionExternalRepositoryChanges', () => ({
    SessionExternalRepositoryChanges: () => {
        const { View } = require('react-native');
        return <View testID="external-changes" />;
    },
}));
vi.mock('@/components/sessions/sourceControl/states', () => ({
    NotSourceControlRepositoryState: () => {
        const { View } = require('react-native');
        return <View testID="not-repo-state" />;
    },
}));

import { NotRepositoryGitState } from './NotRepositoryGitState';

describe('NotRepositoryGitState', () => {
    it('lists the files the chat changed in other repositories above the not-a-repository state', async () => {
        changeSetState.value = { sessionId: 's1', turns: [], files: [{ filePath: '/repo/a.txt' }], rolledBackTurnIds: [] };
        const screen = await renderScreen(<NotRepositoryGitState sessionId="s1" scmSnapshot={null} canInitializeRepository={false} />);
        expect(screen.findByTestId('external-changes')).not.toBeNull();
        expect(screen.findByTestId('not-repo-state')).not.toBeNull();
    });

    it('shows only the not-a-repository state when the chat changed nothing', async () => {
        changeSetState.value = null;
        const screen = await renderScreen(<NotRepositoryGitState sessionId="s1" scmSnapshot={null} canInitializeRepository={false} />);
        expect(screen.findByTestId('external-changes')).toBeNull();
        expect(screen.findByTestId('not-repo-state')).not.toBeNull();
    });
});
