import * as React from 'react';
import { Pressable, View, type View as RNView } from 'react-native';
import { ResumeChip } from './ResumeChip';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import { Text } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';
import { chatFolderParent } from '@/utils/sessions/newChatFolder';
import { AGENT_INPUT_CHIP_ICON_SIZE_PX, AGENT_INPUT_CHIP_ICON_STYLE } from '@/components/sessions/agentInput/definitions/agentInputChipIconMetrics';



/** A chat's own new folder reads as "New chat (own folder)"; other folders as ~/... when the home is known. */
function formatComposerPath(path: string, homeDir: string | null | undefined): string {
    if (chatFolderParent(path) !== null) return t('newSession.pathPicker.newChatOwnFolder');
    return homeDir ? formatPathRelativeToHome(path, homeDir) : path;
}

export type PathAndResumeRowStyles = {
    pathRow: any;
    actionButtonsLeft: any;
    actionChip: any;
    actionChipIconOnly: any;
    actionChipPressed: any;
    actionChipText: any;
};

export type PathAndResumeRowProps = {
    styles: PathAndResumeRowStyles;
    leadingControls?: ReadonlyArray<React.ReactNode>;
    fillAvailableWidth?: boolean;
    showChipLabels: boolean;
    iconColor: string;
    currentPath?: string | null;
    currentPathHomeDir?: string | null;
    pathChipAnchorRef?: React.RefObject<RNView | null>;
    onPathClick?: () => void;
    emptyPathLabel: string;
    resumeSessionId?: string | null;
    resumeChipAnchorRef?: React.RefObject<RNView | null>;
    onResumeClick?: () => void;
    resumeLabelTitle: string;
    resumeLabelOptional: string;
};

export function PathAndResumeRow(props: PathAndResumeRowProps) {
    const leadingControls = props.leadingControls?.filter(Boolean) ?? [];
    const hasPath = Boolean(props.onPathClick);
    const hasResume = Boolean(props.onResumeClick);
    if (leadingControls.length === 0 && !hasPath && !hasResume) return null;
    const widthFillStyle = props.fillAvailableWidth === false ? null : { flex: 1, minWidth: 0 };

    return (
        <View style={[props.styles.pathRow, widthFillStyle]} testID="agentInput-pathResumeRow">
            <View style={[props.styles.actionButtonsLeft, widthFillStyle]}>
                {leadingControls}
                {hasPath ? (
                    <Pressable
                        ref={props.pathChipAnchorRef}
                        testID="agent-input-path-chip"
                        onPress={props.onPathClick}
                        // No slop upward: the send button's own slop reaches down over this row.
                        hitSlop={{ top: 0, bottom: 10, left: 0, right: 0 }}
                        style={(p) => ([
                            props.styles.actionChip,
                            p.pressed ? props.styles.actionChipPressed : null,
                            // Keep the path chip readable on mobile: let the row wrap it as a whole instead of
                            // compressing the text into an icon-only sliver.
                            { flexShrink: 0, minWidth: 0, maxWidth: '100%' },
                        ])}
                    >
                        {normalizeNodeForView(
                            <Icon
                                name="folder"
                                size={AGENT_INPUT_CHIP_ICON_SIZE_PX}
                                color={props.iconColor} style={AGENT_INPUT_CHIP_ICON_STYLE} />,
                        )}
                        <Text
                            numberOfLines={1}
                            ellipsizeMode="middle"
                            style={[props.styles.actionChipText, { flexShrink: 1 }]}
                        >
                            {typeof props.currentPath === 'string' && props.currentPath.length > 0
                                ? formatComposerPath(props.currentPath, props.currentPathHomeDir)
                                : props.emptyPathLabel}
                        </Text>
                    </Pressable>
                ) : null}

                {hasResume ? (
                        <ResumeChip
                        anchorRef={props.resumeChipAnchorRef}
                        onPress={props.onResumeClick!}
                        showLabel={props.showChipLabels}
                        resumeSessionId={props.resumeSessionId}
                        labelTitle={props.resumeLabelTitle}
                        labelOptional={props.resumeLabelOptional}
                        iconColor={props.iconColor}
                        pressableStyle={(pressed) => ([
                            props.styles.actionChip,
                            !props.showChipLabels ? props.styles.actionChipIconOnly : null,
                            pressed ? props.styles.actionChipPressed : null,
                            // Prefer wrapping the chip onto a new line over shrinking it to fit the current line.
                            // Still cap to the row width so extremely long IDs don't overflow horizontally.
                            { flexShrink: 0, maxWidth: '100%' },
                        ])}
                        textStyle={props.styles.actionChipText}
                    />
                ) : null}
            </View>
        </View>
    );
}
