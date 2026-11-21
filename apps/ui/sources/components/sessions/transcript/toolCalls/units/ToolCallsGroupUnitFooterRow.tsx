import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import {
    type TranscriptSessionCommonProps,
    useTranscriptSessionCommon,
} from '@/components/sessions/transcript/transcriptSessionCommon';

import {
    resolveToolCallsGroupChromeVariant,
    ToolCallsGroupCollapseChrome,
    ToolCallsGroupUnitRowFrame,
} from './toolCallsGroupChrome';
import type { ToolCallsGroupUnitRowCommonProps } from './unitRowProps';

type ToolCallsGroupUnitFooterRowProps = ToolCallsGroupUnitRowCommonProps & Readonly<{
    hasVisibleTools: boolean;
    /** Show the bottom collapse control (set by the unit builder for expanded groups). */
    collapseControl?: boolean;
    setExpanded?: (expanded: boolean) => void;
}>;

export const ToolCallsGroupUnitFooterRow = React.memo(function ToolCallsGroupUnitFooterRow(
    props: ToolCallsGroupUnitFooterRowProps,
) {
    const transcriptSessionCommon = useTranscriptSessionCommon(props.sessionId);

    return (
        <ToolCallsGroupUnitFooterRowWithSessionCommon
            {...props}
            forkCommon={transcriptSessionCommon.fork}
            messageDisplayCommon={transcriptSessionCommon.messageDisplay}
            toolChromeCommon={transcriptSessionCommon.toolChrome}
            toolRouteCommon={transcriptSessionCommon.toolRoute}
        />
    );
});

// Bottom cap only: recomposes the grouped card's trailing paddings (cards:
// body 6 + contentRow 6; feed-background: body 6 + cap padding),
// plus the group bottom margin. Plain feed needs no card cap padding. The line terminates
// at the footer boundary.
export const ToolCallsGroupUnitFooterRowWithSessionCommon = React.memo(function ToolCallsGroupUnitFooterRowWithSessionCommon(
    props: ToolCallsGroupUnitFooterRowProps & TranscriptSessionCommonProps,
) {
    const variant = resolveToolCallsGroupChromeVariant(props.toolChromeCommon);
    const { setExpanded } = props;
    const onCollapse = React.useCallback(() => setExpanded?.(false), [setExpanded]);

    return (
        <ToolCallsGroupUnitRowFrame
            variant={variant}
            position="footer"
            hasVisibleTools={props.hasVisibleTools}
            unitTestID="transcript-tool-calls-unit-footer"
        >
            {props.collapseControl === true && setExpanded ? (
                <ToolCallsGroupCollapseChrome onCollapse={onCollapse} />
            ) : null}
            <View style={variant === 'cards' ? styles.footerBodyCards : variant === 'feed' && !props.hasVisibleTools ? styles.footerBodyPlainFeed : styles.footerBodyFeed} />
        </ToolCallsGroupUnitRowFrame>
    );
});

const styles = StyleSheet.create(() => ({
    footerBodyCards: {
        height: 12,
    },
    footerBodyFeed: {
        height: 6,
    },
    footerBodyPlainFeed: {
        height: 0,
    },
}));
