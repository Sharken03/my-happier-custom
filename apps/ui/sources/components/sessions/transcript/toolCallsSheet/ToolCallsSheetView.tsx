import * as React from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { computeToolCallsGroupDiffStats } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupDiffStats';
import { ToolCallsGroupDiffStatsText } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupDiffStatsText';
import { summarizeToolCallsGroup } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupSummary';
import { deriveTranscriptInteractionFromSession } from '@/utils/sessions/deriveTranscriptInteraction';
import {
    createToolCallsSheetState,
    resolveToolCallsSheetBack,
    selectToolCall,
    type ToolCallsSheetState,
} from './toolCallsSheetState';
import { resolveToolCallSheetLabel } from './toolCallSheetLabel';
import { TOOL_CALLS_SHEET_DECELERATION_RATE, ToolCallsSheetScrollView, useToolCallsSheetControls } from './ToolCallsBottomSheet';

const EMPTY_CALLS: readonly ToolCallMessage[] = [];

const TIMELINE_ICON_CENTER_X = 16 + 9;
const TIMELINE_ICON_GAP = 11;

type ToolCallsSheetViewProps = Readonly<{
    sessionId: string;
    /** Null while the session or the group loads. The sheet then shows its frame and a spinner. */
    session: Session | null;
    calls: readonly ToolCallMessage[] | null;
    isTranscriptTail: boolean;
}>;

/**
 * The Tool calls sheet content: the list of calls, or the detail of the selected call. It renders
 * inside ToolCallsBottomSheet, which moves the sheet on a swipe on the list or the detail.
 */
export const ToolCallsSheetView = React.memo(function ToolCallsSheetView(props: ToolCallsSheetViewProps) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const { session } = props;
    const { close: onClose, scroll } = useToolCallsSheetControls();
    const calls = props.session ? props.calls : null;
    const callList = calls ?? EMPTY_CALLS;
    const [state, setState] = React.useState<ToolCallsSheetState | null>(() =>
        calls ? createToolCallsSheetState(calls.map((call) => call.id)) : null,
    );
    // The first state comes when the group has loaded: a group with one call opens in its detail.
    React.useEffect(() => {
        if (state === null && calls) setState(createToolCallsSheetState(calls.map((call) => call.id)));
    }, [calls, state]);
    const selectedId = state?.selectedId ?? null;
    const selectedCall = selectedId === null ? null : callList.find((call) => call.id === selectedId) ?? null;

    const interaction = React.useMemo(() => deriveTranscriptInteractionFromSession({
        accessLevel: session?.accessLevel ?? null,
        canApprovePermissions: session?.canApprovePermissions ?? null,
        active: session?.active ?? null,
        presence: session?.presence ?? null,
    }), [session?.accessLevel, session?.active, session?.canApprovePermissions, session?.presence]);

    const handleBack = React.useCallback(() => {
        const result = resolveToolCallsSheetBack(
            selectedCall ? { selectedId: selectedCall.id } : { selectedId: null },
            callList.length,
        );
        if (result.kind === 'close') {
            onClose();
            return;
        }
        setState(result.state);
    }, [callList.length, onClose, selectedCall]);

    // The hardware back button goes from a detail to the list, and from the list it closes the
    // sheet with its animation.
    React.useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            handleBack();
            return true;
        });
        return () => subscription.remove();
    }, [handleBack]);

    const turnWorking = useSessionTurnWorking(props.sessionId, props.isTranscriptTail);
    const groupStatus = resolveToolCallsGroupStatus({
        toolMessages: callList,
        permissionDisabledReason: interaction.permissionDisabledReason,
        turnWorking: props.isTranscriptTail ? turnWorking : false,
    });
    const title = React.useMemo(
        () => summarizeToolCallsGroup(callList.map((call) => call.tool.name)) ?? t('session.toolCalls'),
        [callList],
    );
    const diffStats = React.useMemo(
        () => computeToolCallsGroupDiffStats(callList.map((call) => call.tool)),
        [callList],
    );

    const renderItem = React.useCallback(({ item, index }: { item: ToolCallMessage; index: number }) => {
        // As in the Claude app: a bold verb and the target in grey, such as "Ran" + "List files".
        const label = resolveToolCallSheetLabel(item.tool);
        return (
        <View style={styles.listRow}>
            {index > 0 ? <View style={[styles.timeline, styles.timelineAbove, { backgroundColor: theme.colors.border.default }]} /> : null}
            {index < callList.length - 1 ? <View style={[styles.timeline, styles.timelineBelow, { backgroundColor: theme.colors.border.default }]} /> : null}
            <ToolTimelineRow
                tool={item.tool}
                metadata={session?.metadata ?? null}
                messages={item.children}
                sessionId={props.sessionId}
                messageId={item.id}
                jumpHighlightSeq={item.seq ?? null}
                interaction={interaction}
                titleOnly
                label={{
                    title: t('session.toolCallsSheetVerb', { kind: label.kind, running: label.running, toolName: label.toolName }),
                    subtitle: label.target,
                }}
                onPressOverride={() => setState((current) => selectToolCall(current ?? { selectedId: null }, item.id))}
            />
        </View>
        );
    }, [callList.length, interaction, session?.metadata, props.sessionId, theme.colors.border.default]);

    if (selectedCall && session) {
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
                        <Icon name="arrow-left" size={22} color={theme.colors.text.primary} />
                    </Pressable>
                    <View style={styles.headerCenter}>
                        <ToolHeader tool={selectedCall.tool} />
                        <ToolStatusIndicator tool={selectedCall.tool} />
                    </View>
                    <View style={styles.headerButtonSpace} />
                </View>
                <View style={styles.detailContent}>
                    <Deferred>
                        <SessionMessageDetailsView
                            message={selectedCall}
                            sessionId={props.sessionId}
                            session={session}
                            jumpChildId={null}
                            ScrollComponent={ToolCallsSheetScrollView}
                        />
                    </Deferred>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container} testID="tool-calls-sheet-list">
            {/* The title centred, close on the right. */}
            <View style={styles.header}>
                <View style={styles.headerButtonSpace} />
                <View style={styles.headerCenter}>
                    <Text style={styles.title} numberOfLines={2}>{title}</Text>
                    <ToolCallsGroupDiffStatsText stats={diffStats} />
                    {groupStatus === 'running' ? (
                        <ActivitySpinner testID="tool-calls-sheet-running" size="small" color={theme.colors.text.secondary} />
                    ) : null}
                </View>
                <Pressable
                    testID="tool-calls-sheet-close"
                    onPress={onClose}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    style={styles.headerButton}
                >
                    <Icon name="x" size={22} color={theme.colors.text.primary} />
                </Pressable>
            </View>
            <GestureDetector gesture={scroll.nativeGesture}>
                <Animated.FlatList
                    ref={scroll.listRef}
                    onScroll={scroll.onScroll}
                    scrollEventThrottle={16}
                    scrollEnabled={scroll.scrollEnabled}
                    decelerationRate={TOOL_CALLS_SHEET_DECELERATION_RATE}
                    overScrollMode="never"
                    data={callList}
                    keyExtractor={(call) => call.id}
                    renderItem={renderItem}
                    contentContainerStyle={[styles.listContent, { paddingBottom: 24 + insets.bottom }]}
                    ListEmptyComponent={calls ? null : (
                        <View style={styles.loading}>
                            <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                        </View>
                    )}
                />
            </GestureDetector>
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
        width: 32,
        alignItems: 'center',
        padding: 4,
    },
    // Keeps the centre column centred: the same width as the button on the other side.
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
    loading: {
        paddingVertical: 32,
        alignItems: 'center',
    },
    // The tool detail view has no side padding on phones (the message route is full width), so
    // the sheet adds it.
    detailContent: {
        flex: 1,
        minHeight: 0,
        paddingHorizontal: 16,
    },
    listContent: {
        paddingBottom: 24,
    },
    listRow: {
        paddingHorizontal: 16,
        paddingVertical: 10,
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
