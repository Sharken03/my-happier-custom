import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { PiChatChangesFile } from '@happier-dev/protocol';

import { ScmChangeRow, resolveScmChangeStatsColumnWidth } from '@/components/sessions/sourceControl/changes/ScmChangeRow';
import { DiffViewer } from '@/components/ui/code/diff/DiffViewer';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { sessionPiChatChangesDiff, type PiChatChangesDiff } from '@/sync/ops/sessionPiChatChanges';

import { toPiChatChangeRow } from './piChatChanges';

/**
 * "Outside the repository": files a Pi chat changed outside any git repository, below the git list.
 * A tap shows the net diff, the file before the chat's first change against the file now.
 * Fork-only, so the text is plain English and not in the locale files.
 */
export const PiChatChangesSection = React.memo(function PiChatChangesSection(props: Readonly<{
    sessionId: string;
    files: readonly PiChatChangesFile[];
}>) {
    const { theme } = useUnistyles();
    const statsColumnWidth = React.useMemo(() => resolveScmChangeStatsColumnWidth(props.files.map(toPiChatChangeRow)), [props.files]);
    if (props.files.length === 0) return null;
    return (
        <View style={styles.container} testID="pi-chat-changes-section">
            <Text style={[styles.sectionTitle, { color: theme.colors.text.secondary }]}>Outside the repository</Text>
            {props.files.map((file) => (
                <PiChatChangeItem
                    key={file.path}
                    sessionId={props.sessionId}
                    file={file}
                    statsColumnWidth={statsColumnWidth}
                />
            ))}
        </View>
    );
});

type DiffState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'failed' }>
    | Readonly<{ kind: 'ready'; diff: PiChatChangesDiff }>;

function PiChatChangeItem(props: Readonly<{ sessionId: string; file: PiChatChangesFile; statsColumnWidth: number }>) {
    const { theme } = useUnistyles();
    const { sessionId, file } = props;
    const row = React.useMemo(() => toPiChatChangeRow(file), [file]);
    const [expanded, setExpanded] = React.useState(false);
    const [diff, setDiff] = React.useState<DiffState | null>(null);

    // A new list entry (the file changed again) drops the diff that was read before it.
    React.useEffect(() => { setDiff(null); }, [file.updatedAt]);

    const onPress = React.useCallback(() => {
        const next = !expanded;
        setExpanded(next);
        if (!next || (diff && diff.kind !== 'failed')) return;
        setDiff({ kind: 'loading' });
        void sessionPiChatChangesDiff(sessionId, file.path).then((result) => {
            setDiff(result ? { kind: 'ready', diff: result } : { kind: 'failed' });
        });
    }, [diff, expanded, file.path, sessionId]);

    const note = diff ? describeNote(diff) : null;
    return (
        <View>
            <ScmChangeRow theme={theme} file={row} onPress={onPress} density="compact" statsColumnWidth={props.statsColumnWidth} />
            {expanded && diff && diff.kind !== 'loading' ? (
                <View style={styles.diff}>
                    {note ? (
                        <Text testID={`pi-chat-change-note:${file.path}`} style={[styles.note, { color: theme.colors.text.secondary }]}>{note}</Text>
                    ) : diff.kind === 'ready' ? (
                        <DiffViewer
                            testID={`pi-chat-change-diff:${file.path}`}
                            mode="text"
                            filePath={file.path}
                            oldText={diff.diff.before ?? ''}
                            newText={diff.diff.after ?? ''}
                            contextLines={3}
                        />
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

function describeNote(state: DiffState): string | null {
    if (state.kind === 'failed') return 'Could not load the diff.';
    if (state.kind !== 'ready') return null;
    const { diff } = state;
    if (diff.tooLarge) return 'The file is too large to show a diff.';
    if (diff.binary) return 'Binary file, no diff to show.';
    if ((diff.before ?? '') === (diff.after ?? '')) return 'No changes: the file is back to how it was.';
    return null;
}

const styles = StyleSheet.create(() => ({
    container: {
        paddingTop: 16,
        paddingBottom: 24,
        gap: 4,
    },
    sectionTitle: {
        paddingHorizontal: 16,
        fontSize: 12,
        textTransform: 'uppercase',
        ...Typography.default('semiBold'),
    },
    diff: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    note: {
        fontSize: 12,
        ...Typography.default(),
    },
}));
