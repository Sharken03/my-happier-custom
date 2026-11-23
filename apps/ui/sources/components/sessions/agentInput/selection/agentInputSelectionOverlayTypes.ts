import type { OptionPickerOption } from '../../pickers/OptionPickerOverlay';
import type { AgentInputPopoverAnchor } from '../agentInputContracts';

export type AgentInputSelectionOverlayId =
    | 'agent'
    | 'machine'
    | 'sessionMode'
    | 'permission'
    | 'path'
    | 'resume'
    | 'profile'
    | 'envVars'
    | 'collapsedExtra'
    | 'modelPicker';

export type AgentInputModelPickerOverlayData = Readonly<{
    sessionId: string;
    selectedModelId: string;
    modelOptions: ReadonlyArray<OptionPickerOption>;
    onSelectModel: (value: string) => void;
    onClose: () => void;
}>;

type AgentInputBaseSelectionOverlayState = Readonly<{
    anchor: AgentInputPopoverAnchor;
}>;

export type AgentInputSelectionOverlayState =
    | (AgentInputBaseSelectionOverlayState & Readonly<{
        id: Exclude<AgentInputSelectionOverlayId, 'collapsedExtra' | 'modelPicker'>;
    }>)
    | (AgentInputBaseSelectionOverlayState & Readonly<{
        id: 'collapsedExtra';
        chipKey: string;
    }>)
    | (AgentInputBaseSelectionOverlayState & AgentInputModelPickerOverlayData & Readonly<{
        id: 'modelPicker';
    }>);
