import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createSyncOpsModuleMock, renderScreen } from '@/dev/testkit';
import { installSessionGitPaneCommonModuleMocks } from './sessionGitPaneTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const stashListMock = vi.hoisted(() => vi.fn(async () => ({ success: true, managedCount: 0, managedStashes: [], totalCount: 0 })));

installSessionGitPaneCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            FlatList: (props: any) => {
                const header = props.ListHeaderComponent ? React.createElement(React.Fragment, null, props.ListHeaderComponent) : null;
                const items = Array.isArray(props.data)
                    ? props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: `item-${index}` }, props.renderItem?.({ item, index })))
                    : null;

                return React.createElement('FlatList', props, header, items);
            },
            ScrollView: 'ScrollView',
            Pressable: 'Pressable',
            Platform: {
                select: (value: any) => value?.default ?? null,
                OS: 'web',
            },
        });
    },
});

vi.mock('@/components/sessions/files/SourceControlBranchSummary', () => ({
    SourceControlBranchSummary: (props: any) => React.createElement('SourceControlBranchSummary', props),
}));

vi.mock('@/components/sessions/sourceControl/commitComposer/ScmCommitComposerCard', () => ({
    ScmCommitComposerCard: (props: any) => React.createElement('ScmCommitComposerCard', props),
}));

vi.mock('@/components/sessions/sourceControl/changes/ScmChangeRow', () => ({
    ScmChangeRow: (props: any) => React.createElement('ScmChangeRow', props),
    resolveScmChangeStatsColumnWidth: () => 38,
}));

vi.mock('@/sync/ops', async (importOriginal) => {
    return createSyncOpsModuleMock({
        importOriginal,
        overrides: {
            sessionScmStashList: stashListMock,
        },
    });
});

describe('SessionRightPanelGitCommitTab (files outside the repository)', () => {
    it('counts the files outside the repository and shows no empty text', async () => {
        const { SessionRightPanelGitCommitTab } = await import('./SessionRightPanelGitCommitTab');

        const screen = await renderScreen(<SessionRightPanelGitCommitTab
                    theme={{ colors: { divider: '#ddd', surface: '#fff', surfaceHigh: '#f6f6f6', text: '#000', textSecondary: '#666', success: '#0a0', warning: '#f90', textLink: '#09f', danger: '#c00' } }}
                    sessionId="s1"
                    sessionPath="/workspace"
                    backendLabel="Git"
                    commitActionLabel="Commit"
                    scmSnapshot={{
                        repo: { isRepo: true, rootPath: '/repo', backendId: 'git', mode: '.git' },
                        branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
                        capabilities: { readStash: true },
                        totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 0, pendingRemoved: 0 },
                        fetchedAt: Date.now(),
                        projectKey: 'p1',
                        hasConflicts: false,
                        entries: [],
                        stashCount: 0,
                    } as any}
                    scmWriteEnabled={true}
                    hasConflicts={false}
                    scmOperationBusy={false}
                    scmOperationStatus={null}
                    hasGlobalOperationInFlight={false}
                    inFlightScmOperation={null}
                    commitAllowed={false}
                    commitBlockedMessage={null}
                    changedFilesViewMode="repository"
                    attributionReliability="high"
                    allRepositoryChangedFiles={[] as any}
                    sessionAttributedFiles={[] as any}
                    repositoryOnlyFiles={[] as any}
                    suppressedInferredCount={0}
                    repositorySelectedCount={0}
                    onSelectAll={() => {}}
                    onSelectNone={() => {}}
                    disableSelectAll={true}
                    disableSelectNone={true}
                    onFilePress={() => {}}
                    onFilePressPinned={() => {}}
                    onToggleSelectionForFile={() => {}}
                    renderFileActions={() => null}
                    renderFileTrailingActions={() => null}
                    commitDraftMessage=""
                    onCommitDraftMessageChange={() => {}}
                    onCommitFromMessage={() => {}}
                    commitMessageGeneratorEnabled={false}
                    onGenerateCommitMessageSuggestion={async () => ({ ok: true, message: '' })}
                    scmStatusFiles={null}
                    showCommitComposer={false}
                    onOpenStashDetails={() => {}}
                    outsideRepositoryCount={2}
                />)

        await act(async () => {});

        const list = screen.findByType('FlatList');
        expect(list.props.ListEmptyComponent).toBeNull();
        expect(screen.findAll((node) => (node.type as unknown) === 'Text' && node.props.children === '2')).toHaveLength(1);
    });
});
