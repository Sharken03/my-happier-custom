import * as React from 'react';
import { type StyleProp, type TextStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

import type { ToolCallsGroupDiffStats } from './toolCallsGroupDiffStats';

/** "+N −M" in green and red. Renders nothing when both counts are 0. */
export const ToolCallsGroupDiffStatsText = React.memo(function ToolCallsGroupDiffStatsText(props: Readonly<{
    stats: ToolCallsGroupDiffStats;
    style?: StyleProp<TextStyle>;
}>) {
    const { added, removed } = props.stats;
    if (added === 0 && removed === 0) return null;
    return (
        <Text testID="tool-calls-diff-stats" style={[styles.base, props.style]} numberOfLines={1}>
            {added > 0 ? <Text style={styles.added}>{`+${added}`}</Text> : null}
            {added > 0 && removed > 0 ? ' ' : null}
            {removed > 0 ? <Text style={styles.removed}>{`−${removed}`}</Text> : null}
        </Text>
    );
});

const styles = StyleSheet.create((theme) => ({
    base: {
        fontSize: 12,
        flexShrink: 0,
        ...Typography.default('regular'),
    },
    added: {
        color: theme.colors.diff.success,
    },
    removed: {
        color: theme.colors.diff.error,
    },
}));
