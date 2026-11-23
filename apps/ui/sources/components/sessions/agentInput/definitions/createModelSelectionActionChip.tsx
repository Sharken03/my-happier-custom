import * as React from 'react';
import { Pressable, View, type View as ViewInstance } from 'react-native';

import { Icon } from '@/components/ui/icons/Icon';
import { AgentInputChipLabel } from '../components/AgentInputChipLabel';

export function createModelSelectionActionChip(params: Readonly<{
    anchorRef: React.RefObject<ViewInstance | null>;
    tint: string;
    showLabel: boolean;
    label: string;
    chipStyle: (pressed: boolean) => any;
    textStyle: any;
    onPress: () => void;
}>): React.ReactNode {
    const testID = 'agent-input-model-chip';
    const MODEL_CHIP_LOGO_SIZE = 14;
    return (
        <Pressable
            ref={params.anchorRef}
            key="model"
            testID={testID}
            onPress={params.onPress}
            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
            style={(state) => params.chipStyle(state.pressed)}
        >
            <View style={{
                width: MODEL_CHIP_LOGO_SIZE,
                height: MODEL_CHIP_LOGO_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 4,
            }}>
                <Icon
                    name="sparkle"
                    size={MODEL_CHIP_LOGO_SIZE}
                    color={params.tint}
                />
            </View>
            {params.showLabel ? (
                <AgentInputChipLabel label={params.label} textStyle={params.textStyle} />
            ) : null}
        </Pressable>
    );
}