import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';

/**
 * The Favorites view's own mark in an Agent rail.
 *
 * It sits beside Agent marks, so it answers the same question they do — "which
 * view am I choosing" — and must not borrow any one Agent's identity.
 */
export function FavoriteModelsPickerIcon(props: Readonly<{ size?: number }>) {
    const { theme } = useUnistyles();
    return (
        <Icon
            name="star"
            size={props.size ?? 12}
            color={theme.dark ? theme.colors.text.primary : theme.colors.button.primary.background}
            weight={theme.dark ? 'fill' : 'regular'}
        />
    );
}
