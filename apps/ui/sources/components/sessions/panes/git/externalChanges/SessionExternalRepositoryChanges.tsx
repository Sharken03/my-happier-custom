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
import { sessionScmDiffFile, sessionScmStatusSnapshot } from '@/sync/ops';
import { t } from '@/text';

import {
    groupByRepository,
    isAbsoluteFilePath,
    resolveRepositoryRoots,
    type ExternalChangedFile,
    type ExternalRepositoryGroup,
} from './externalRepositoryChanges';

const NO_GROUPS: readonly ExternalRepositoryGroup<SessionChangeSetFile>[] = [];

/**
 * "Other repositories" below the chat's own changes: the files the chat's tool calls changed
 * outside its repository, grouped by the repository that holds each one, with the working-tree
 * diff on tap (the agent's own edit when the change is already committed or outside git).
 */
export const SessionExternalRepositoryChanges = React.memo(function SessionExternalRepositoryChanges(props: Readonly<{
    sessionId: string;
    sessionChangeSet: SessionChangeSet | null;
    scmSnapshot: ScmWorkingSnapshot | null;
}>) {
    const { theme } = useUnistyles();
    const externalFiles = React.useMemo(() => {
        const projection = deriveSessionWorkingTreeProjection({ sessionChangeSet: props.sessionChangeSet, snapshot: props.scmSnapshot });
        return (projection?.unmatchedSessionFiles ?? []).filter((file) => isAbsoluteFilePath(file.filePath));
    }, [props.scmSnapshot, props.sessionChangeSet]);
    const filesKey = externalFiles.map((file) => file.filePath).join('\n');

    const [groups, setGroups] = React.useState<readonly ExternalRepositoryGroup<SessionChangeSetFile>[]>(NO_GROUPS);
    const { sessionId } = props;
    React.useEffect(() => {
        if (externalFiles.length === 0) {
            setGroups(NO_GROUPS);
            return;
        }
        let cancelled = false;
        void resolveRepositoryRoots(externalFiles.map((file) => file.filePath), async (folder) => {
            const response = await sessionScmStatusSnapshot(sessionId, { cwd: folder });
            const repo = response.success ? response.snapshot?.repo : undefined;
            return repo?.isRepo && repo.rootPath ? repo.rootPath : null;
        }).then((roots) => {
            if (cancelled) return;
            setGroups(groupByRepository(externalFiles.map((file) => ({ filePath: file.filePath, change: file })), roots));
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
                        <ExternalChangedFileRow key={file.filePath} sessionId={sessionId} rootPath={group.rootPath} file={file} />
                    ))}
                </View>
            ))}
        </View>
    );
});

type DiffState = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'ready'; unifiedDiff: string | null; committed: boolean }>;

function ExternalChangedFileRow(props: Readonly<{
    sessionId: string;
    rootPath: string | null;
    file: ExternalChangedFile<SessionChangeSetFile>;
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
            setDiff({ kind: 'ready', unifiedDiff: null, committed: false });
            return;
        }
        setDiff({ kind: 'loading' });
        void sessionScmDiffFile(sessionId, { cwd: rootPath, path: file.displayPath, area: 'both' }).then((response) => {
            const text = response.success && typeof response.diff === 'string' ? response.diff.trim() : '';
            setDiff({ kind: 'ready', unifiedDiff: text || null, committed: response.success && !text });
        });
    }, [diff, expanded, file.displayPath, rootPath, sessionId]);

    const change = file.change;
    const agentDiff = typeof change.unifiedDiff === 'string' && change.unifiedDiff.trim() ? change.unifiedDiff : null;
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
                <Text style={[styles.rowText, { color: theme.colors.text.primary }]} numberOfLines={1} ellipsizeMode="head">
                    {file.displayPath}
                </Text>
            </Pressable>
            {expanded && diff?.kind === 'ready' ? (
                <View style={styles.diff}>
                    {diff.committed ? (
                        <Text style={[styles.note, { color: theme.colors.text.secondary }]}>{t('files.externalChangeCommitted')}</Text>
                    ) : null}
                    {diff.unifiedDiff ? (
                        <DiffViewer mode="unified" filePath={file.displayPath} unifiedDiff={diff.unifiedDiff} />
                    ) : agentDiff ? (
                        <DiffViewer mode="unified" filePath={file.displayPath} unifiedDiff={agentDiff} />
                    ) : (
                        <DiffViewer mode="text" filePath={file.displayPath} oldText={change.oldText ?? ''} newText={change.newText ?? ''} contextLines={3} />
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
