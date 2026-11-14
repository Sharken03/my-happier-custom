import * as React from 'react';
import { Platform, useColorScheme } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { HugeiconsIcon } from '@hugeicons/react-native';
import { StarIcon as HugeStarIcon } from '@hugeicons/core-free-icons';
import { StarIcon as PhosphorStarIcon } from 'phosphor-react-native';

import { useIconStrokeWidth } from './iconFamily';

export type StarIconProps = Readonly<{
    size?: number;
    color?: string;
    /** @default 'regular' on light, 'fill' on dark */
    weight?: 'regular' | 'fill';
    style?: React.CSSProperties;
    testID?: string;
}>;

/**
 * Platform-aware star icon.
 *
 * On native (Android/iOS), Phosphor's StarIcon has rendering issues with certain weights.
 * This component uses HugeIcons on native and Phosphor on web for consistent appearance.
 */
export const StarIcon = React.memo(function StarIcon(props: StarIconProps) {
    const { theme } = useUnistyles();
    const colorScheme = useColorScheme();
    const strokeWidth = useIconStrokeWidth();

    const nominalSize = props.size ?? 20;
    const weight = props.weight ?? (colorScheme === 'dark' ? 'fill' : 'regular');
    const color = props.color ?? (colorScheme === 'dark' ? theme.colors.text.primary : theme.colors.button.primary.background);

    // On native, use HugeIcons which renders reliably via react-native-svg
    // On web, use Phosphor for the tighter, more compact star design
    if (Platform.OS !== 'web') {
        const hugeStroke = strokeWidth * (20 / nominalSize); // Scale stroke for size
        return (
            <HugeiconsIcon
                icon={HugeStarIcon}
                size={nominalSize}
                color={color}
                strokeWidth={hugeStroke}
                style={props.style}
                testID={props.testID}
            />
        );
    }

    return (
        <PhosphorStarIcon
            size={nominalSize}
            color={color}
            weight={weight}
            style={props.style}
            testID={props.testID}
        />
    );
});

StarIcon.displayName = 'StarIcon';