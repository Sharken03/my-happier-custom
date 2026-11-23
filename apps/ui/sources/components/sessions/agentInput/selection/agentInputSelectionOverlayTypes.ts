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
    | (AgentInputBaseSelectionOverlayState & Readonly<{
        id: 'modelPicker';
        sessionId: string;
        selectedModelId: string;
        modelOptions: ReadonlyArray<any>;
        onSelectModel: (value: string) => void;
        onClose: () => void;
    }>);
