import * as React from 'react';

import { Text } from '@/components/ui/text/Text';

/**
 * The widest a chip label grows before it ends in "…". Long model names ("Nemotron 3 Ultra 550B
 * (free)") otherwise push the other chips onto a new line on a phone in portrait.
 */
const MAX_CHIP_LABEL_WIDTH = 150;
const cappedLabelStyle = { maxWidth: MAX_CHIP_LABEL_WIDTH, flexShrink: 1 } as const;

export const AgentInputChipLabel = React.memo(function AgentInputChipLabel(props: Readonly<{
    label: string;
    count?: number | null;
    textStyle?: any;
    countTextStyle?: any;
}>) {
    const hasCount = typeof props.count === 'number' && Number.isFinite(props.count) && props.count > 0;

    return (
        <Text numberOfLines={1} ellipsizeMode="tail" style={[props.textStyle, cappedLabelStyle]}>
            {props.label}
            {hasCount ? (
                <Text style={props.countTextStyle}>
                    {` (${props.count})`}
                </Text>
            ) : null}
        </Text>
    );
});
