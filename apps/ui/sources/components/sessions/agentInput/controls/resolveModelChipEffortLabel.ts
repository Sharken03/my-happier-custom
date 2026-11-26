import type { readSessionModelsState } from '@/sync/domains/sessionControl/readSessionControlMetadata';

/** The session models state as the metadata reader returns it. */
type SessionModelsState = ReturnType<typeof readSessionModelsState>;

/**
 * The model-scoped effort option: the protocol's canonical reasoning_effort (actionSpecs, session
 * spawn), or an ACP agent's own thought_level (agy acp), which the CLI attaches to the model too
 * (isAcpModelScopedConfigOption).
 */
function isEffortOption(option: Readonly<{ id: string; category?: string }>): boolean {
    return option.id === 'reasoning_effort' || option.id === 'thought_level' || option.category === 'thought_level';
}

/**
 * The effort shown after the model name on the composer's model chip ("Model + effort" style):
 * the selected model's effort option, as the user overrode it or as the session reports it,
 * named by the option's own choice name. Null when the model has no effort option. Reads only the
 * session metadata the composer already holds, so a closed chip triggers no probe.
 */
export function resolveModelChipEffortLabel(params: Readonly<{
    modelsState: SessionModelsState;
    selectedModelId: string | null;
    overrides: Readonly<Record<string, Readonly<{ value: unknown }>>> | null | undefined;
}>): string | null {
    const state = params.modelsState;
    if (!state) return null;
    const models = state.availableModels ?? [];
    const model = models.find((entry) => entry.id === (params.selectedModelId ?? state.currentModelId))
        ?? models.find((entry) => entry.id === state.currentModelId);
    const option = model?.modelOptions?.find(isEffortOption);
    if (!option) return null;
    const raw = params.overrides?.[option.id]?.value ?? option.currentValue;
    if (raw === null || raw === undefined || raw === '') return null;
    const value = String(raw);
    const choice = option.options?.find((entry) => String(entry.value) === value);
    return choice?.name ?? `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
