import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSessionDetailsPanelCommonModuleMocks } from '../sessionDetailsPanelTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const externalChangesProps = vi.hoisted(() => ({ current: null as any }));
const sessionChangeSetMock = vi.hoisted(() => ({
    sessionId: 's1',
    turns: [],
    files: [{
        filePath: '/repo/other-repository/file.ts',
        changeKind: 'modified',
        oldText: 'old line',
        newText: 'new line',
        source: 'provider_tool',
        confidence: 'exact',
        provider: 'pi',
    }],
    rolledBackTurnIds: [],
    confidenceSummary: { source: 'provider_tool', confidence: 'exact' },
}));

vi.mock('react-native-reanimated', () => ({}));

installSessionDetailsPanelCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: any) => React.createElement('View', props, props.children),
            ScrollView: (props: any) => React.createElement('ScrollView', props, props.children),
            Pressable: (props: any) => React.createElement('Pressable', props, props.children),
            Text: (props: any) => React.createElement('Text', props, props.children),
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'web',
                select: (value: any) => value?.default ?? null,
            },
            AppState: {
                addEventListener: () => ({ remove: () => {} }),
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useSetting: () => null,
            useSettingMutable: () => [null, vi.fn()],
            useAllMachines: () => [{ id: 'm1', active: true, activeAt: 1, metadata: { host: '8T', homeDir: '/home' } }],
            useProjectForSession: () => null,
            useProjectSessions: () => [],
            useMachine: () => ({ online: true }),
            useSession: () => ({ active: true, metadata: { machineId: 'm1', path: '/chats/plain-folder' } }),
            useSessionProjectScmCommitSelectionPaths: () => [],
            useSessionProjectScmCommitSelectionPatches: () => [],
            useSessionProjectScmInFlightOperation: () => null,
            useSessionProjectScmOperationLog: () => [],
            useSessionProjectScmSnapshot: () => nonRepositorySnapshot,
            useSessionProjectScmSnapshotError: () => null,
            useSessionRealtimeScmTranscriptConsumer: () => {},
            useSessionProjectScmTouchedPaths: () => [],
        });
    },
});

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        scopeState: {},
        openRight: vi.fn(),
        setRightTab: vi.fn(),
        openDetailsTab: vi.fn(),
    }),
}));

vi.mock('./useSessionRightPanelGitTabState', () => ({
    useSessionRightPanelGitTabState: () => ({
        activeGitSubTab: 'commit',
        setActiveGitSubTab: vi.fn(),
        commitDraftMessage: '',
        setCommitDraftMessage: vi.fn(),
    }),
}));

vi.mock('./useSessionRightPanelGitOpenDetails', () => ({
    useSessionRightPanelGitOpenDetails: () => ({
        openFileInDetails: vi.fn(),
        openFileInDetailsPinned: vi.fn(),
        openCommitInDetails: vi.fn(),
    }),
}));

vi.mock('@/hooks/session/files/useScmCommitHistory', () => ({
    useScmCommitHistory: () => ({
        historyEntries: [],
        historyLoading: false,
        historyHasMore: false,
        loadCommitHistory: vi.fn(),
    }),
}));

vi.mock('@/hooks/session/files/useFilesScmOperations', () => ({
    useFilesScmOperations: () => ({
        scmOperationBusy: false,
        scmOperationStatus: null,
        commitPreflight: { allowed: false, message: null },
        pullPreflight: { allowed: false, reason: 'not_a_repository' },
        pushPreflight: { allowed: false, reason: 'not_a_repository' },
        runRemoteOperation: vi.fn(),
        createCommitFromMessage: vi.fn(),
        commitMessageGeneratorEnabled: false,
        generateCommitMessageSuggestion: vi.fn(),
    }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/hooks/session/sourceControl/usePublishBranchAction', () => ({
    usePublishBranchAction: () => ({ canPublish: false, publishBusy: false, publishBranch: vi.fn() }),
}));

vi.mock('@/components/sessions/sourceControl/states', () => ({
    NotSourceControlRepositoryState: () => React.createElement('NotSourceControlRepositoryState', { testID: 'not-a-repository-state' }),
    SourceControlUnavailableState: () => React.createElement('SourceControlUnavailableState'),
    SourceControlSessionInactiveState: () => React.createElement('SourceControlSessionInactiveState'),
}));

vi.mock('@/components/sessions/model/resolveSessionMachineReachability', () => ({
    resolveSessionMachineReachability: () => true,
}));

vi.mock('@/utils/sessions/machineUtils', () => ({
    isMachineOnline: () => true,
}));

vi.mock('@/components/sessions/model/useSessionMachineTarget', () => ({
    useSessionMachineTarget: () => ({ machineId: 'm1', basePath: '/home' }),
}));

vi.mock('@/scm/registry/scmUiBackendRegistry', () => ({
    scmUiBackendRegistry: {
        getPluginForSnapshot: () => ({
            displayName: 'Git',
            commitActionConfig: () => ({ label: 'Commit' }),
            remoteActionConfig: () => ({ fetch: true, pull: true, push: true }),
            inferRemoteTarget: () => ({ remote: 'origin', branch: 'main' }),
            mapCapabilitiesToUiPolicy: () => ({ supportedDiffAreas: ['pending'], changeSetModel: 'index' }),
        }),
    },
}));

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: {
        invalidateFromUserAndAwait: vi.fn(),
        invalidateFromAutoRefreshAndAwait: vi.fn(async () => {}),
    },
}));

vi.mock('@/sync/domains/session/changes/hooks/useDerivedSessionChangeSet', () => ({
    useDerivedSessionChangeSet: () => ({
        turnChangeSets: [],
        latestTurnChangeSet: null,
        latestTurnScopedChangeSet: null,
        sessionChangeSet: sessionChangeSetMock,
        latestTurnDiffByPath: null,
        providerDiffByPath: null,
    }),
}));

vi.mock('./externalChanges/SessionExternalRepositoryChanges', () => ({
    SessionExternalRepositoryChanges: (props: any) => {
        externalChangesProps.current = props;
        return React.createElement('SessionExternalRepositoryChanges', { ...props, testID: 'session-external-repository-changes-stub' });
    },
}));

vi.mock('./SessionRightPanelGitCommitTabContent', () => ({
    SessionRightPanelGitCommitTabContent: () => React.createElement('CommitTab'),
}));

vi.mock('./SessionRightPanelGitUpdateTab', () => ({
    SessionRightPanelGitUpdateTab: () => React.createElement('UpdateTab'),
}));

vi.mock('./SessionRightPanelGitHistoryTab', () => ({
    SessionRightPanelGitHistoryTab: () => React.createElement('HistoryTab'),
}));

const nonRepositorySnapshot = makeNonRepositorySnapshot();

function makeNonRepositorySnapshot() {
    return {
        fetchedAt: 1,
        projectKey: 'm1:/chats/plain-folder',
        repo: { isRepo: false, rootPath: null, backendId: 'git', mode: null },
        capabilities: {
            readStatus: true,
            readDiffFile: false,
            readDiffCommit: false,
            readLog: false,
            writeCommit: false,
            writeInclude: false,
            writeExclude: false,
            supportedDiffAreas: ['pending'],
        },
        branch: { head: null, upstream: null, ahead: 0, behind: 0, detached: false },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
    } as any;
}

describe('SessionRightPanelGitView (folder outside a repository)', () => {
    it('still lists the files the chat changed in other repositories', async () => {
        externalChangesProps.current = null;
        const { SessionRightPanelGitView } = await import('./SessionRightPanelGitView');

        const screen = await renderScreen(<SessionRightPanelGitView sessionId="s1" scopeId="session:s1" />);

        expect(screen.findAllByTestId('not-a-repository-state')).toHaveLength(1);
        expect(screen.findAllByTestId('session-external-repository-changes-stub')).toHaveLength(1);
        expect(externalChangesProps.current?.sessionChangeSet).toBe(sessionChangeSetMock);
        expect(externalChangesProps.current?.sessionId).toBe('s1');
        expect(externalChangesProps.current?.scmSnapshot?.repo?.isRepo).toBe(false);
    });
});
