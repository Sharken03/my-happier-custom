import type { AgentInputActionBarLayout } from '@/components/sessions/agentInput/layout/actionBarLogic';

import {
    AGENT_INPUT_CONTROL_REGISTRY,
    AGENT_INPUT_USER_HIDEABLE_CONTROL_IDS,
    findAgentInputControlDescriptor,
} from './agentInputControlRegistry';
import type { AgentInputControlId, AgentInputResolvedControlLines } from './agentInputControlTypes';

const USER_HIDEABLE = new Set<string>(AGENT_INPUT_USER_HIDEABLE_CONTROL_IDS);

function sortControlIdsInRegistryOrder(
    controlIds: readonly AgentInputControlId[],
    hiddenControlIds: readonly string[],
): AgentInputControlId[] {
    const requested = new Set(controlIds);
    const hidden = new Set(hiddenControlIds.filter((id) => USER_HIDEABLE.has(id)));
    return AGENT_INPUT_CONTROL_REGISTRY
        .map((control) => control.id)
        .filter((controlId) => requested.has(controlId) && !hidden.has(controlId));
}

export function resolveAgentInputControlLines(params: Readonly<{
    layout: AgentInputActionBarLayout;
    controlIds: readonly AgentInputControlId[];
    /** Controls the user switched off (setting agentInputHiddenControls); only hideable ones apply. */
    hiddenControlIds?: readonly string[];
}>): AgentInputResolvedControlLines {
    const orderedControlIds = sortControlIdsInRegistryOrder(params.controlIds, params.hiddenControlIds ?? []);

    if (params.layout === 'collapsed') {
        return {
            layout: params.layout,
            primary: [],
            secondary: [],
            collapsed: orderedControlIds,
        };
    }

    const primary: AgentInputControlId[] = [];
    const secondary: AgentInputControlId[] = [];
    for (const controlId of orderedControlIds) {
        const descriptor = findAgentInputControlDescriptor(controlId);
        if (!descriptor) continue;
        if (descriptor.line === 'secondary') {
            secondary.push(controlId);
            continue;
        }
        primary.push(controlId);
    }

    return {
        layout: params.layout,
        primary,
        secondary,
        collapsed: [],
    };
}
