import type { SessionModelsState } from '@/sync/domains/sessionControl/schema';

/** The model-scoped reasoning effort option; the protocol's canonical id (actionSpecs, session spawn). */
const REASONING_EFFORT_OPTION_ID = 'reasoning_effort';

/**
 * The effort shown after the model name on the composer's model chip ("Model + effort" style):
 * the selected model's reasoning_effort, as the user overrode it or as the session reports it,
 * named by the option's own choice name. Null when the model has no effort option. Reads only the
 * session metadata the composer already holds, so a closed chip triggers no probe.
 */
export function resolveModelChipEffortLabel(params: Readonly<{
    modelsState: SessionModelsState | null;
    selectedModelId: string | null;
    overrides: Readonly<Record<string, Readonly<{ value: unknown }>>> | null | undefined;
}>): string | null {
    const state = params.modelsState;
    if (!state) return null;
    const model = state.availableModels.find((entry) => entry.id === (params.selectedModelId ?? state.currentModelId))
        ?? state.availableModels.find((entry) => entry.id === state.currentModelId);
    const option = model?.modelOptions.find((entry) => entry.id === REASONING_EFFORT_OPTION_ID);
    if (!option) return null;
    const raw = params.overrides?.[REASONING_EFFORT_OPTION_ID]?.value ?? option.currentValue;
    if (raw === null || raw === undefined || raw === '') return null;
    const value = String(raw);
    const choice = option.options.find((entry) => String(entry.value) === value);
    return choice?.name ?? `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
