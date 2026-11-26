import type { AgentInputControlDescriptor } from './agentInputControlTypes';

export const AGENT_INPUT_CONTROL_REGISTRY = [
    { id: 'engine', line: 'primary' },
    { id: 'mode', line: 'primary' },
    { id: 'goal', line: 'primary' },
    { id: 'permission', line: 'primary' },
    { id: 'actionMenu', line: 'primary' },
    { id: 'profile', line: 'primary' },
    { id: 'env', line: 'primary' },
    { id: 'server', line: 'primary' },
    { id: 'connectedServices', line: 'primary' },
    { id: 'mcp', line: 'primary' },
    { id: 'checkout', line: 'primary' },
    { id: 'automation', line: 'primary' },
    { id: 'stop', line: 'primary' },
    { id: 'recipient', line: 'primary' },
    { id: 'delivery', line: 'primary' },
    { id: 'attachments', line: 'primary' },
    { id: 'linkedFiles', line: 'primary' },
    { id: 'files', line: 'primary' },
    { id: 'reviewComments', line: 'primary' },
    { id: 'storage', line: 'primary' },
    { id: 'windowsRemoteSessionMode', line: 'primary' },
    { id: 'providerOption', line: 'primary' },
    { id: 'shortcuts', line: 'primary' },
    { id: 'machine', line: 'secondary' },
    { id: 'path', line: 'secondary' },
    { id: 'resume', line: 'secondary' },
] as const satisfies ReadonlyArray<AgentInputControlDescriptor>;

/**
 * The composer controls a user may switch off (setting agentInputHiddenControls), in display order.
 * The action menu and Stop stay: without them a collapsed composer or a running turn has no control.
 * Recipient, delivery and the Windows launch mode appear only where they decide where a message goes.
 */
export const AGENT_INPUT_USER_HIDEABLE_CONTROL_IDS = [
    'engine', 'mode', 'goal', 'permission', 'profile', 'env', 'server', 'connectedServices', 'mcp', 'checkout',
    'automation', 'attachments', 'linkedFiles', 'files', 'reviewComments', 'storage', 'providerOption', 'shortcuts',
    'machine', 'path', 'resume',
] as const satisfies ReadonlyArray<AgentInputControlDescriptor['id']>;

export type AgentInputUserHideableControlId = typeof AGENT_INPUT_USER_HIDEABLE_CONTROL_IDS[number];

export function findAgentInputControlDescriptor(id: AgentInputControlDescriptor['id']): AgentInputControlDescriptor | null {
    return AGENT_INPUT_CONTROL_REGISTRY.find((control) => control.id === id) ?? null;
}
