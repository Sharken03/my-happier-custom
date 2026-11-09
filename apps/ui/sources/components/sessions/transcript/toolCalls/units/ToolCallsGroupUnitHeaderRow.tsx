import * as React from 'react';
import { View } from 'react-native';

import type { ToolCallMessage } from '@/sync/domains/messages/messageTypes';
import { useSessionTurnWorking } from '@/sync/store/hooks';

import { TranscriptEnterWrapper } from '@/components/sessions/transcript/motion/TranscriptEnterWrapper';
import { TRANSCRIPT_WEB_TOOL_GROUP_PREPEND_ANCHOR_TEST_ID_PREFIX } from '@/components/sessions/transcript/viewport/prepend/webTranscriptPrependAnchor';
import {
    type TranscriptSessionCommonProps,
    useTranscriptSessionCommon,
} from '@/components/sessions/transcript/transcriptSessionCommon';

import {
    resolveToolCallsGroupChromeVariant,
    resolveToolCallsGroupStatus,
    toolCallsGroupChromeModeForVariant,
    ToolCallsGroupHeaderChrome,
    ToolCallsGroupUnitRowFrame,
} from './toolCallsGroupChrome';
import type { ToolCallsGroupUnitRowCommonProps } from './unitRowProps';

type ToolCallsGroupUnitHeaderRowProps = ToolCallsGroupUnitRowCommonProps & Readonly<{
    toolMessages: ToolCallMessage[];
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
    /** The turn still works and this group is its latest activity; see `resolveToolCallsGroupStatus`. */
    turnWorking?: boolean;
}>;

export const ToolCallsGroupUnitHeaderRow = React.memo(function ToolCallsGroupUnitHeaderRow(
    props: ToolCallsGroupUnitHeaderRowProps,
) {
    const transcriptSessionCommon = useTranscriptSessionCommon(props.sessionId);

    return (
        <ToolCallsGroupUnitHeaderRowWithSessionCommon
            {...props}
            forkCommon={transcriptSessionCommon.fork}
            messageDisplayCommon={transcriptSessionCommon.messageDisplay}
            toolChromeCommon={transcriptSessionCommon.toolChrome}
            toolRouteCommon={transcriptSessionCommon.toolRoute}
        />
    );
});

export const ToolCallsGroupUnitHeaderRowWithSessionCommon = React.memo(function ToolCallsGroupUnitHeaderRowWithSessionCommon(
    props: ToolCallsGroupUnitHeaderRowProps & TranscriptSessionCommonProps,
) {
    const variant = resolveToolCallsGroupChromeVariant(props.toolChromeCommon);
    const chromeMode = toolCallsGroupChromeModeForVariant(variant);
    const { setExpanded } = props;
    const onToggle = React.useCallback(() => setExpanded(!props.expanded), [setExpanded, props.expanded]);

    const status = resolveToolCallsGroupStatus({
        toolMessages: props.toolMessages,
        permissionDisabledReason: props.interaction.permissionDisabledReason,
        turnWorking: props.turnWorking,
    });

    if (props.toolMessages.length === 0) return null;

    const createdAt = props.toolMessages[0]?.createdAt ?? Date.now();
    const webPrependAnchorId = props.toolMessages[props.toolMessages.length - 1]?.id ?? props.groupId;

    return (
        <View testID={`${TRANSCRIPT_WEB_TOOL_GROUP_PREPEND_ANCHOR_TEST_ID_PREFIX}${webPrependAnchorId}`}>
            <TranscriptEnterWrapper id={props.groupId} createdAt={createdAt}>
                <ToolCallsGroupUnitRowFrame
                    variant={variant}
                    position="header"
                    unitTestID="transcript-tool-calls-unit-header"
                >
                    <ToolCallsGroupHeaderChrome
                        chromeMode={chromeMode}
                        status={status}
                        toolMessages={props.toolMessages}
                        expanded={props.expanded}
                        onToggle={onToggle}
                    />
                </ToolCallsGroupUnitRowFrame>
            </TranscriptEnterWrapper>
        </View>
    );
});

/**
 * The header row the transcript list mounts. Only the group that ends the transcript reads the
 * session's turn state, so a turn that starts or stops re-renders that one header.
 */
export const ToolCallsGroupUnitLiveHeaderRow = React.memo(function ToolCallsGroupUnitLiveHeaderRow(
    props: Omit<ToolCallsGroupUnitHeaderRowProps, 'turnWorking'> & TranscriptSessionCommonProps & Readonly<{
        isTranscriptTail: boolean;
    }>,
) {
    const { isTranscriptTail, ...headerProps } = props;
    const turnWorking = useSessionTurnWorking(props.sessionId, isTranscriptTail);

    return <ToolCallsGroupUnitHeaderRowWithSessionCommon {...headerProps} turnWorking={turnWorking} />;
});
