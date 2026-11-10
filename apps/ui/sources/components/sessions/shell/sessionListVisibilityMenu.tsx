import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { Icon } from '@/components/ui/icons/Icon';
import {
    SESSION_LIST_VISIBILITY_SCOPES,
    type SessionListVisibilityScope,
} from '@/sync/domains/session/listing/sessionListOrderingRules';

// The Active/Inactive/Archived section headers in this fork are already literal English
// (see sessionListViewData.ts), so this filter keeps the same plain labels instead of
// adding translation keys to every locale file.
function getScopeLabel(scope: SessionListVisibilityScope): string {
    if (scope === 'all') return 'All';
    if (scope === 'archived') return 'Archived';
    return 'Active';
}

export const SessionListVisibilityMenu = React.memo((props: Readonly<{
    value: SessionListVisibilityScope;
    onChange: (scope: SessionListVisibilityScope) => void;
}>) => {
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);

    const items = React.useMemo<DropdownMenuItem[]>(() => SESSION_LIST_VISIBILITY_SCOPES.map((scope) => ({
        id: scope,
        title: getScopeLabel(scope),
    })), []);

    const handleSelect = React.useCallback((itemId: string) => {
        if (itemId === 'all' || itemId === 'active' || itemId === 'archived') {
            props.onChange(itemId);
        }
    }, [props.onChange]);

    return (
        <DropdownMenu
            open={open}
            onOpenChange={setOpen}
            items={items}
            selectedId={props.value}
            onSelect={handleSelect}
            search={false}
            matchTriggerWidth={false}
            maxWidthCap={180}
            placement="bottom"
            popoverAnchorAlign="end"
            trigger={({ toggle, open: triggerOpen }) => (
                <Pressable
                    testID="session-list-visibility-menu-trigger"
                    accessibilityRole="button"
                    accessibilityLabel="Session visibility"
                    onPress={toggle}
                    style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 10,
                        height: 28,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: theme.colors.border.subtle,
                        backgroundColor: theme.colors.surface.base,
                        gap: 5,
                        opacity: pressed ? 0.78 : 1,
                    })}
                >
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 12,
                            color: theme.colors.text.secondary,
                            ...Typography.default('semiBold'),
                        }}
                    >
                        {getScopeLabel(props.value)}
                    </Text>
                    <Icon name={triggerOpen ? 'caret-up' : 'caret-down'} size={14} color={theme.colors.text.secondary} />
                </Pressable>
            )}
        />
    );
});
