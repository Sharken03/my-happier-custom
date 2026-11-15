import * as React from 'react';
import { BackHandler, FlatList, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSessionTurnWorking } from '@/sync/store/hooks';
import { Deferred } from '@/components/ui/forms/Deferred';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { ToolHeader } from '@/components/tools/shell/presentation/ToolHeader';
import { ToolStatusIndicator } from '@/components/tools/shell/presentation/ToolStatusIndicator';
import { ToolTimelineRow } from '@/components/tools/shell/views/ToolTimelineRow';
import { SessionMessageDetailsView } from '@/components/sessions/transcript/details/SessionMessageDetailsView';
import { resolveToolCallsGroupStatus } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupChrome';
import { summarizeToolCallsGroup } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupSummary';
import { deriveTranscriptInteractionFromSession } from '@/utils/sessions/deriveTranscriptInteraction';
import {
    createToolCallsSheetState,
    resolveToolCallsSheetBack,
    selectToolCall,
    type ToolCallsSheetState,
} from './toolCallsSheetState';

const TIMELINE_ICON_CENTER_X = 16 + 9;
const TIMELINE_ICON_GAP = 11;

type ToolCallsSheetViewProps = Readonly<{
    sessionId: string;
    session: Session;
    calls: readonly ToolCallMessage[];
    isTranscriptTail: boolean;
    onClose: () => void;
}>;

/** The Tool calls sheet content: the list of calls, or the detail of the selected call. */
export const ToolCallsSheetView = React.memo(function ToolCallsSheetView(props: ToolCallsSheetViewProps) {
    const { theme } = useUnistyles();
    const { calls, onClose } = props;
    const [state, setState] = React.useState<ToolCallsSheetState>(() =>
        createToolCallsSheetState(calls.map((call) => call.id)),
    );
    const selectedCall = state.selectedId === null ? null : calls.find((call) => call.id === state.selectedId) ?? null;

    const interaction = React.useMemo(() => deriveTranscriptInteractionFromSession({
        accessLevel: props.session.accessLevel,
        canApprovePermissions: props.session.canApprovePermissions,
        active: props.session.active,
        presence: props.session.presence,
    }), [props.session.accessLevel, props.session.active, props.session.canApprovePermissions, props.session.presence]);

    const handleBack = React.useCallback(() => {
        const result = resolveToolCallsSheetBack(
            selectedCall ? state : { selectedId: null },
            calls.length,
        );
        if (result.kind === 'close') {
            onClose();
            return;
        }
        setState(result.state);
    }, [calls.length, onClose, selectedCall, state]);

    // In detail mode the hardware back button goes to the list. In the list it falls through to the
    // navigator, which closes the sheet.
    React.useEffect(() => {
        if (!selectedCall || calls.length <= 1) return;
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            handleBack();
            return true;
        });
        return () => subscription.remove();
    }, [calls.length, handleBack, selectedCall]);

    const turnWorking = useSessionTurnWorking(props.sessionId, props.isTranscriptTail);
    const groupStatus = resolveToolCallsGroupStatus({
        toolMessages: calls,
        permissionDisabledReason: interaction.permissionDisabledReason,
        turnWorking: props.isTranscriptTail ? turnWorking : false,
    });
    const title = React.useMemo(
        () => summarizeToolCallsGroup(calls.map((call) => call.tool.name)) ?? t('session.toolCalls'),
        [calls],
    );

    const renderItem = React.useCallback(({ item, index }: { item: ToolCallMessage; index: number }) => (
        <View style={styles.listRow}>
            {index > 0 ? <View style={[styles.timeline, styles.timelineAbove, { backgroundColor: theme.colors.border.default }]} /> : null}
            {index < calls.length - 1 ? <View style={[styles.timeline, styles.timelineBelow, { backgroundColor: theme.colors.border.default }]} /> : null}
            <ToolTimelineRow
                tool={item.tool}
                metadata={props.session.metadata}
                messages={item.children}
                sessionId={props.sessionId}
                messageId={item.id}
                jumpHighlightSeq={item.seq ?? null}
                interaction={interaction}
                titleOnly
                onPressOverride={() => setState((current) => selectToolCall(current, item.id))}
            />
        </View>
    ), [calls.length, interaction, props.session.metadata, props.sessionId, theme.colors.border.default]);

    if (selectedCall) {
        return (
            <View style={styles.container} testID="tool-calls-sheet-detail">
                <View style={styles.header}>
                    <Pressable
                        testID="tool-calls-sheet-back"
                        onPress={handleBack}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.back')}
                        style={styles.headerButton}
                    >
                        <Icon name="arrow-left" size={20} color={theme.colors.text.primary} />
                    </Pressable>
                    <View style={styles.headerTitle}>
                        <ToolHeader tool={selectedCall.tool} />
                    </View>
                    <ToolStatusIndicator tool={selectedCall.tool} />
                </View>
                <View style={styles.detailContent}>
                    <Deferred>
                        <SessionMessageDetailsView
                            message={selectedCall}
                            sessionId={props.sessionId}
                            session={props.session}
                            jumpChildId={null}
                        />
                    </Deferred>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container} testID="tool-calls-sheet-list">
            <View style={styles.header}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                {groupStatus === 'running' ? (
                    <ActivitySpinner testID="tool-calls-sheet-running" size="small" color={theme.colors.text.secondary} />
                ) : null}
                <View style={styles.headerSpacer} />
                <Pressable
                    testID="tool-calls-sheet-close"
                    onPress={onClose}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    style={styles.headerButton}
                >
                    <Icon name="x" size={20} color={theme.colors.text.primary} />
                </Pressable>
            </View>
            <FlatList
                data={calls}
                keyExtractor={(call) => call.id}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
            />
        </View>
    );
});

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
        padding: 4,
    },
    headerSpacer: {
        flex: 1,
    },
    headerTitle: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        color: theme.colors.text.primary,
        fontSize: 16,
        ...Typography.default('semiBold'),
        flexShrink: 1,
    },
    detailContent: {
        flex: 1,
        minHeight: 0,
    },
    listContent: {
        paddingBottom: 24,
    },
    listRow: {
        paddingHorizontal: 16,
        paddingVertical: 4,
    },
    // The line runs in the icon column, from the row edge to just short of the icon.
    timeline: {
        position: 'absolute',
        left: TIMELINE_ICON_CENTER_X,
        width: 1,
    },
    timelineAbove: {
        top: 0,
        bottom: '50%',
        marginBottom: TIMELINE_ICON_GAP,
    },
    timelineBelow: {
        top: '50%',
        bottom: 0,
        marginTop: TIMELINE_ICON_GAP,
    },
}));
