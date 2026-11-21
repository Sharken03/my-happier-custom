import type { AgentInputChipPickerOption } from '@/components/sessions/agentInput/components/AgentInputChipPickerTypes';

/**
 * Which rail row reads as selected when the host has not chosen one.
 *
 * A rail may lead with a row that opens a view rather than an Agent — the
 * Favorites view leads the in-session rail — so the unarmed default cannot be
 * "the first row": that row would read as selected and the Agent actually
 * running this Session would read as merely offered. The default is the row
 * the composer owns for its own Agent, wherever the caller placed it.
 */
export function resolveAgentPickerSelectedOptionId(params: Readonly<{
    requestedOptionId?: string | null;
    options: ReadonlyArray<Pick<AgentInputChipPickerOption, 'id'>>;
    currentAgentOptionIds: ReadonlySet<string>;
}>): string | null {
    if (typeof params.requestedOptionId === 'string' && params.requestedOptionId.length > 0) {
        return params.requestedOptionId;
    }
    const runningRow = params.options.find((option) => params.currentAgentOptionIds.has(option.id));
    return runningRow?.id ?? params.options[0]?.id ?? null;
}
