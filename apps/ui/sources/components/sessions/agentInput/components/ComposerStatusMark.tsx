import * as React from 'react';
import type { ViewStyle } from 'react-native';

import { StatusDot } from '@/components/ui/status/StatusDot';
import { WorkingQuillMark } from '@/components/ui/status/WorkingQuillMark';
import { useSetting } from '@/sync/domains/state/storage';

/**
 * The mark before the composer status text: a quill writing on a page while the agent works,
 * when that setting is on, and the status dot otherwise.
 */
export const ComposerStatusMark = React.memo(function ComposerStatusMark(props: Readonly<{
    working: boolean;
    isPulsing?: boolean;
    dotColor: string;
    inkColor: string;
    dotStyle?: ViewStyle;
    quillStyle?: ViewStyle;
}>) {
    const quillEnabled = useSetting('composerWorkingQuillMarkEnabled') === true;
    if (props.working && quillEnabled) {
        return (
            <WorkingQuillMark
                testID="agent-input-status-quill"
                inkColor={props.inkColor}
                quillColor={props.dotColor}
                size={14}
                style={props.quillStyle}
            />
        );
    }
    return (
        <StatusDot
            testID="agent-input-status-dot"
            color={props.dotColor}
            isPulsing={props.isPulsing}
            size={6}
            style={props.dotStyle}
        />
    );
});
