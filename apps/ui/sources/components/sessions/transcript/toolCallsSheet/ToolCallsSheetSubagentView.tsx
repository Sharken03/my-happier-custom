import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { MessageView } from '@/components/sessions/transcript/MessageView';
import { ToolStatusIndicator } from '@/components/tools/shell/presentation/ToolStatusIndicator';
import { resolveToolTranscriptSidechainId } from '@/components/tools/shell/views/resolveToolTranscriptSidechainId';
import { Icon } from '@/components/ui/icons/Icon';
import { Text, TextSelectabilityScope } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useEnsureSidechainsLoaded } from '@/hooks/session/useEnsureSidechainsLoaded';
import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { resolveSessionSubagentVisibleMessages } from '@/sync/domains/session/subagents/visibleMessages/resolveSessionSubagentVisibleMessages';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSessionMessages } from '@/sync/store/hooks';
import { t } from '@/text';
import { deriveTranscriptInteractionFromSession } from '@/utils/sessions/deriveTranscriptInteraction';

import {
    collectToolCallsGroupDiffTools,
    computeToolCallsGroupDiffStats,
    readSubagentResultDiffStats,
} from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupDiffStats';
import { ToolCallsGroupDiffStatsText } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupDiffStatsText';

import { ToolCallsSheetScrollView } from './ToolCallsBottomSheet';
import {
    readToolCallsSheetSubagentPrompt,
    readToolCallsSheetSubagentReport,
    readToolCallsSheetSubagentType,
    shouldShowToolCallsSheetSubagentPrompt,
    shouldShowToolCallsSheetSubagentReport,
} from './toolCallsSheetSubagent';

const EMPTY_RUNS: readonly never[] = [];

type ToolCallsSheetSubagentViewProps = Readonly<{
    message: ToolCallMessage;
    sessionId: string;
    session: Session;
    onBack: () => void;
}>;

/**
 * The detail of a subagent call in the Tool calls sheet: its task prompt, its own tool calls and
 * messages, and its final report. The messages come from the same store hooks as the sidechain
 * view of the full tool screen, so the list grows while the subagent runs. It mounts only while
 * this detail shows. The rows scroll in ToolCallsSheetScrollView, so a swipe moves the sheet.
 */
export function ToolCallsSheetSubagentView(props: ToolCallsSheetSubagentViewProps) {
    const { message, sessionId, session } = props;
    const { theme } = useUnistyles();
    const tool = message.tool;

    const { messages: committedMessages } = useSessionMessages(sessionId);
    const sidechainId = React.useMemo(
        () => resolveToolTranscriptSidechainId({ tool, normalizedToolName: tool.name }),
        [tool],
    );
    const sidechainIds = React.useMemo(() => [sidechainId], [sidechainId]);
    useEnsureSidechainsLoaded({ enabled: sidechainId !== null, sessionId, sidechainIds });

    const visibleMessages = React.useMemo(() => resolveSessionSubagentVisibleMessages({
        session,
        tool,
        messages: committedMessages,
        focusedMessages: message.children,
        activeExecutionRuns: EMPTY_RUNS,
    }), [committedMessages, message.children, session, tool]);

    const interaction = React.useMemo(() => ({
        ...deriveTranscriptInteractionFromSession({
            accessLevel: session.accessLevel,
            canApprovePermissions: session.canApprovePermissions,
            active: session.active,
            presence: session.presence,
        }),
        disableToolNavigation: true,
    }), [session.accessLevel, session.active, session.canApprovePermissions, session.presence]);

    // The CLI's count in the result, or the edits among the subagent's loaded calls.
    const diffStats = React.useMemo(
        () => readSubagentResultDiffStats(tool) ?? computeToolCallsGroupDiffStats(collectToolCallsGroupDiffTools(message.children)),
        [message.children, tool],
    );
    const subagentType = readToolCallsSheetSubagentType(tool);
    const prompt = shouldShowToolCallsSheetSubagentPrompt(visibleMessages) ? readToolCallsSheetSubagentPrompt(tool) : null;
    const fullReport = readToolCallsSheetSubagentReport(tool);
    const report = fullReport && shouldShowToolCallsSheetSubagentReport(fullReport, visibleMessages) ? fullReport : null;

    return (
        <View style={styles.container} testID="tool-calls-sheet-detail">
            <View style={styles.header}>
                <Pressable
                    testID="tool-calls-sheet-back"
                    onPress={props.onBack}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.back')}
                    style={styles.headerButton}
                >
                    <Icon name="arrow-left" size={22} color={theme.colors.text.primary} />
                </Pressable>
                <View style={styles.headerCenter}>
                    <Text style={styles.title} numberOfLines={1}>{subagentType ?? t('tools.names.subAgent')}</Text>
                    <ToolCallsGroupDiffStatsText stats={diffStats} />
                    <ToolStatusIndicator tool={tool} />
                </View>
                <View style={styles.headerButtonSpace} />
            </View>
            <View style={styles.body} testID="tool-calls-sheet-subagent">
                <ToolCallsSheetScrollView contentContainerStyle={styles.content}>
                    <TextSelectabilityScope selectable>
                        <View>
                            {prompt ? <Text style={styles.prompt}>{prompt}</Text> : null}
                            {visibleMessages.map((item) => (
                                <MessageView
                                    key={item.id}
                                    message={item}
                                    metadata={session.metadata ?? null}
                                    sessionId={sessionId}
                                    interaction={interaction}
                                />
                            ))}
                            {report ? <Text style={styles.report}>{report}</Text> : null}
                        </View>
                    </TextSelectabilityScope>
                </ToolCallsSheetScrollView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.surface.base,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    headerButton: {
        width: 32,
        alignItems: 'center',
        padding: 4,
    },
    headerButtonSpace: {
        width: 32,
    },
    headerCenter: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    title: {
        color: theme.colors.text.primary,
        fontSize: 18,
        textAlign: 'center',
        ...Typography.default('semiBold'),
        flexShrink: 1,
    },
    body: {
        flex: 1,
        minHeight: 0,
    },
    content: {
        paddingHorizontal: 16,
        paddingBottom: 32,
    },
    prompt: {
        color: theme.colors.text.secondary,
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 16,
        ...Typography.default(),
    },
    report: {
        color: theme.colors.text.primary,
        fontSize: 15,
        lineHeight: 22,
        marginTop: 16,
        ...Typography.default(),
    },
}));
