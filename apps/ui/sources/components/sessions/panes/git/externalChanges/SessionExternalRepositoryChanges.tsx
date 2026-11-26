import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { SessionChangeSet, SessionChangeSetFile } from '@happier-dev/protocol';

import { DiffViewer } from '@/components/ui/code/diff/DiffViewer';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { deriveSessionWorkingTreeProjection } from '@/sync/domains/session/changes/derivation/deriveSessionWorkingTreeProjection';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { useSessionMessages } from '@/sync/domains/state/storage';
import { sessionScmDiffFile, sessionScmStatusSnapshot } from '@/sync/ops';
import { t } from '@/text';

import {
    deriveToolCallChangedPaths,
    groupByRepository,
    isAbsoluteFilePath,
    mergeExternalChangedFiles,
    resolveAgentChangeView,
    resolveRepositoryRoots,
    workingTreeChangedPaths,
    type ExternalChangedFile,
    type ExternalRepositoryGroup,
} from './externalRepositoryChanges';

type ExternalChange = SessionChangeSetFile | null;

const NO_GROUPS: readonly ExternalRepositoryGroup<ExternalChange>[] = [];
const NO_PATHS: readonly string[] = [];
const NO_CHANGED_PATHS: ReadonlyMap<string, ReadonlySet<string>> = new Map();

/**
 * "Other repositories" below the chat's own changes: the files the chat's tool calls changed
 * outside its repository, grouped by the repository that holds each one, with the working-tree
 * diff on tap (the agent's own edit when the working tree no longer has the change, or outside git).
 * The files come from the session change set, from the transcript's file-changing tool calls (for
 * agents without a change set, such as ACP agents) and from `extraPaths` (Pi subagents' edits).
 */
export const SessionExternalRepositoryChanges = React.memo(function SessionExternalRepositoryChanges(props: Readonly<{
    sessionId: string;
    sessionChangeSet: SessionChangeSet | null;
    scmSnapshot: ScmWorkingSnapshot | null;
    /** More absolute paths the chat changed, for example in Pi subagents. */
    extraPaths?: readonly string[];
}>) {
    const { theme } = useUnistyles();
    const { messages } = useSessionMessages(props.sessionId);
    const toolCallPaths = React.useMemo(() => deriveToolCallChangedPaths(messages), [messages]);
    const extraPaths = props.extraPaths ?? NO_PATHS;
    const externalFiles = React.useMemo(() => {
        const projection = deriveSessionWorkingTreeProjection({ sessionChangeSet: props.sessionChangeSet, snapshot: props.scmSnapshot });
        const repo = props.scmSnapshot?.repo;
        return mergeExternalChangedFiles({
            changeSetFiles: (projection?.unmatchedSessionFiles ?? []).filter((file) => isAbsoluteFilePath(file.filePath)),
            extraPaths: [...toolCallPaths, ...extraPaths],
            ownRootPath: repo?.isRepo && repo.rootPath ? repo.rootPath : null,
        });
    }, [extraPaths, props.scmSnapshot, props.sessionChangeSet, toolCallPaths]);
    const filesKey = externalFiles.map((file) => file.filePath).join('\n');

    const [groups, setGroups] = React.useState<readonly ExternalRepositoryGroup<ExternalChange>[]>(NO_GROUPS);
    // Per repository root, the paths its working tree has changed now. A listed file outside it was
    // committed or undone since the agent changed it.
    const [changedPathsByRoot, setChangedPathsByRoot] = React.useState(NO_CHANGED_PATHS);
    const { sessionId } = props;
    React.useEffect(() => {
        if (externalFiles.length === 0) {
            setGroups(NO_GROUPS);
            return;
        }
        let cancelled = false;
        const changedPaths = new Map<string, ReadonlySet<string>>();
        void resolveRepositoryRoots(externalFiles.map((file) => file.filePath), async (folder) => {
            const response = await sessionScmStatusSnapshot(sessionId, { cwd: folder });
            const snapshot = response.success ? response.snapshot : undefined;
            const root = snapshot?.repo?.isRepo && snapshot.repo.rootPath ? snapshot.repo.rootPath : null;
            if (root && snapshot) changedPaths.set(root, workingTreeChangedPaths(snapshot.entries));
            return root;
        }).then((roots) => {
            if (cancelled) return;
            setChangedPathsByRoot(changedPaths);
            setGroups(groupByRepository(externalFiles, roots));
        });
        return () => { cancelled = true; };
        // filesKey stands for externalFiles: the same paths need no new lookups.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filesKey, sessionId]);

    if (groups.length === 0) return null;
    return (
        <View style={styles.container} testID="session-external-repository-changes">
            <Text style={[styles.sectionTitle, { color: theme.colors.text.secondary }]}>{t('files.otherRepositoriesTitle')}</Text>
            {groups.map((group) => (
                <View key={group.rootPath ?? 'outside'} style={styles.group}>
                    <Text style={[styles.groupTitle, { color: theme.colors.text.primary }]} numberOfLines={1} ellipsizeMode="head">
                        {group.rootPath ?? t('files.outsideGitTitle')}
                    </Text>
                    {group.files.map((file) => (
                        <ExternalChangedFileRow
                            key={file.filePath}
                            sessionId={sessionId}
                            rootPath={group.rootPath}
                            file={file}
                            inWorkingTree={group.rootPath ? changedPathsByRoot.get(group.rootPath)?.has(file.displayPath) ?? true : true}
                        />
                    ))}
                </View>
            ))}
        </View>
    );
});

type DiffState = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'ready'; unifiedDiff: string | null; notInWorkingTree: boolean }>;

function ExternalChangedFileRow(props: Readonly<{
    sessionId: string;
    rootPath: string | null;
    file: ExternalChangedFile<ExternalChange>;
    /** False when the repository's working tree does not have the file changed now. */
    inWorkingTree: boolean;
}>) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const [diff, setDiff] = React.useState<DiffState | null>(null);
    const { sessionId, rootPath, file } = props;

    const onPress = React.useCallback(() => {
        const next = !expanded;
        setExpanded(next);
        if (!next || diff) return;
        if (!rootPath) {
            setDiff({ kind: 'ready', unifiedDiff: null, notInWorkingTree: false });
            return;
        }
        setDiff({ kind: 'loading' });
        void sessionScmDiffFile(sessionId, { cwd: rootPath, path: file.displayPath, area: 'both' }).then((response) => {
            const text = response.success && typeof response.diff === 'string' ? response.diff.trim() : '';
            setDiff({ kind: 'ready', unifiedDiff: text || null, notInWorkingTree: response.success && !text });
        });
    }, [diff, expanded, file.displayPath, rootPath, sessionId]);

    const change = file.change;
    const agentView = change ? resolveAgentChangeView(change) : ({ kind: 'none' } as const);
    return (
        <View>
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                testID={`session-external-change:${file.filePath}`}
                style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.colors.surface.pressed } : null]}
            >
                <Icon name={expanded ? 'caret-down' : 'caret-right'} size={14} color={theme.colors.text.secondary} />
                <Text style={[styles.rowText, { color: props.inWorkingTree ? theme.colors.text.primary : theme.colors.text.secondary }]} numberOfLines={1} ellipsizeMode="head">
                    {file.displayPath}
                </Text>
            </Pressable>
            {expanded && diff?.kind === 'ready' ? (
                <View style={styles.diff}>
                    {diff.notInWorkingTree ? (
                        <Text style={[styles.note, { color: theme.colors.text.secondary }]}>{t('files.externalChangeNotInWorkingTree')}</Text>
                    ) : null}
                    {diff.unifiedDiff ? (
                        <DiffViewer mode="unified" filePath={file.displayPath} unifiedDiff={diff.unifiedDiff} />
                    ) : agentView.kind === 'unified' ? (
                        <DiffViewer mode="unified" filePath={file.displayPath} unifiedDiff={agentView.unifiedDiff} />
                    ) : agentView.kind === 'text' ? (
                        <DiffViewer mode="text" filePath={file.displayPath} oldText={agentView.oldText} newText={agentView.newText} contextLines={3} />
                    ) : (
                        <Text style={[styles.note, { color: theme.colors.text.secondary }]}>{t('files.externalChangeNoDiff')}</Text>
                    )}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    container: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 24,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 12,
        textTransform: 'uppercase',
        ...Typography.default('semiBold'),
    },
    group: {
        gap: 2,
    },
    groupTitle: {
        fontSize: 13,
        ...Typography.mono(),
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 6,
        borderRadius: 6,
    },
    rowText: {
        flex: 1,
        fontSize: 13,
        ...Typography.mono(),
    },
    diff: {
        paddingVertical: 6,
        gap: 6,
    },
    note: {
        fontSize: 12,
        ...Typography.default(),
    },
}));
