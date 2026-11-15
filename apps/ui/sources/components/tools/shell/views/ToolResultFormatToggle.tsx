import * as React from 'react';
import { Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { formatToolResultJson } from './formatToolResultJson';

/**
 * State for a Format toggle on a result text. `formatted` is null when the text is not JSON;
 * then no toggle shows. `shown` is the text to render now.
 */
export function useToolResultFormat(text: string | null, enabled: boolean): Readonly<{
    formatted: string | null;
    on: boolean;
    toggle: () => void;
    shown: string | null;
}> {
    const [on, setOn] = React.useState(false);
    const formatted = React.useMemo(
        () => (enabled && text !== null ? formatToolResultJson(text) : null),
        [enabled, text],
    );
    const toggle = React.useCallback(() => setOn((value) => !value), []);
    return { formatted, on, toggle, shown: on && formatted !== null ? formatted : text };
}

/** The Format / Raw button above a JSON result. */
export function ToolResultFormatToggle(props: Readonly<{ on: boolean; onToggle: () => void }>) {
    return (
        <Pressable onPress={props.onToggle} style={styles.button} accessibilityRole="button">
            <Text style={styles.text}>{props.on ? t('toolView.showRaw') : t('toolView.formatJson')}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    button: {
        alignSelf: 'flex-start',
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.text.secondary,
    },
    text: {
        fontSize: 13,
        color: theme.colors.text.secondary,
    },
}));
