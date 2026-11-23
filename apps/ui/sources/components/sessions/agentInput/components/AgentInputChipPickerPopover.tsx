import React from 'react';

import { AgentInputSelectionPopover } from '@/components/sessions/agentInput/selection/AgentInputSelectionPopover';
import { BottomSheet } from '@/components/ui/overlays/BottomSheet';

import { AgentInputChipPickerSurface } from './AgentInputChipPickerSurface';
import type { AgentInputChipPickerOption } from './AgentInputChipPickerPanel';

export type AgentInputChipPickerPopoverProps = Readonly<{
    open: boolean;
    anchorRef: React.RefObject<any>;
    boundaryRef?: React.RefObject<any> | null;
    title: string;
    showCloseButton?: boolean;
    options: ReadonlyArray<AgentInputChipPickerOption>;
    selectedOptionId?: string | null;
    onSelect: (id: string) => void;
    onRequestClose: () => void;
    applyLabel?: string;
    railWidth?: number;
    railMaxWidth?: number | `${number}%`;
    detailPaneHeaderAccessory?: React.ReactNode;
    maxHeightCap?: number;
    maxWidthCap?: number;
    /**
     * `popover` anchors the picker to the chip; `sheet` opens it as a bottom sheet over the whole
     * screen, the same way the Tool calls route opens its sheet.
     */
    presentation?: 'popover' | 'sheet';
}>;

export function AgentInputChipPickerPopover(props: AgentInputChipPickerPopoverProps) {
    if (props.presentation === 'sheet') {
        if (!props.open) return null;
        return (
            <BottomSheet onRequestClose={props.onRequestClose} testID="agent-input-chip-picker-sheet">
                {(detent) => (
                    <AgentInputChipPickerSurface
                        testID="agent-input-chip-picker-popover"
                        title={props.title}
                        showCloseButton={props.showCloseButton}
                        options={props.options}
                        selectedOptionId={props.selectedOptionId}
                        onSelect={props.onSelect}
                        onRequestClose={props.onRequestClose}
                        applyLabel={props.applyLabel}
                        railWidth={props.railWidth}
                        railMaxWidth={props.railMaxWidth}
                        detailPaneHeaderAccessory={props.detailPaneHeaderAccessory}
                        maxHeight={detent.height}
                        scrollLocked={!detent.scrollEnabled}
                    />
                )}
            </BottomSheet>
        );
    }

    return (
        <AgentInputSelectionPopover
            open={props.open}
            anchorRef={props.anchorRef}
            boundaryRef={props.boundaryRef}
            maxHeightCap={props.maxHeightCap ?? 420}
            maxWidthCap={props.maxWidthCap ?? 720}
            onRequestClose={props.onRequestClose}
        >
            {({ maxHeight }) => (
                <AgentInputChipPickerSurface
                    testID="agent-input-chip-picker-popover"
                    // Agent-input popovers shouldn't render their own header chrome; the model section
                    // already provides the relevant header (e.g. MODEL) and refresh affordance.
                    title=""
                    // Align with other AgentInput popovers (close by outside press / selecting options).
                    showCloseButton={props.showCloseButton ?? false}
                    options={props.options}
                    selectedOptionId={props.selectedOptionId}
                    onSelect={props.onSelect}
                    onRequestClose={props.onRequestClose}
                    applyLabel={props.applyLabel}
                    railWidth={props.railWidth}
                    railMaxWidth={props.railMaxWidth}
                    detailPaneHeaderAccessory={props.detailPaneHeaderAccessory}
                    maxHeight={maxHeight}
                />
            )}
        </AgentInputSelectionPopover>
    );
}
