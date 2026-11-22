import { z } from 'zod';

import type { ModelOption, PreflightModelList } from '@/sync/domains/models/modelOptions';
import { readNonBlankSessionControlIdentifier } from '@/sync/domains/sessionControl/opaqueIdentifiers';

export const FavoriteModelSelectionV1Schema = z.object({
    backendTargetKey: z.string(),
    modelId: z.string(),
    providerAgentId: z.string().optional(),
    builtInAgentId: z.string().nullable().optional(),
    configuredBackendId: z.string().nullable().optional(),
    backendLabel: z.string().optional(),
    modelLabel: z.string().optional(),
    addedAtMs: z.number().int().nonnegative().optional(),
    /** New chats started with this model; the picker can sort favorites by it. */
    useCount: z.number().int().nonnegative().optional(),
});

export type FavoriteModelSelectionV1 = z.infer<typeof FavoriteModelSelectionV1Schema>;

export type FavoriteModelBackendIdentity = Readonly<{
    backendTargetKey: string;
    providerAgentId?: string | null;
    builtInAgentId?: string | null;
    configuredBackendId?: string | null;
}>;

export type FavoriteModelAvailabilityMode = 'dynamic' | 'static-only';

export type AvailableFavoriteModel = Readonly<{
    modelId: string;
    modelLabel: string;
    modelDescription: string;
    backendLabel?: string;
}>;

function normalizeOptionalString(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeFavoriteModelId(value: string | null | undefined): string {
    return readNonBlankSessionControlIdentifier(value) ?? '';
}

export function isFavoriteModelSelectableId(value: string | null | undefined): boolean {
    const modelId = normalizeFavoriteModelId(value);
    return modelId.length > 0 && modelId !== 'default';
}

export function favoriteModelSelectionMatchesBackend(
    selection: FavoriteModelSelectionV1,
    backend: FavoriteModelBackendIdentity,
): boolean {
    const selectionTargetKey = normalizeOptionalString(selection.backendTargetKey);
    const backendTargetKey = normalizeOptionalString(backend.backendTargetKey);
    if (selectionTargetKey && backendTargetKey && selectionTargetKey === backendTargetKey) {
        return true;
    }

    const selectionBuiltInAgentId = normalizeOptionalString(selection.builtInAgentId);
    const backendBuiltInAgentId = normalizeOptionalString(backend.builtInAgentId);
    if (selectionBuiltInAgentId && backendBuiltInAgentId && selectionBuiltInAgentId === backendBuiltInAgentId) {
        return true;
    }

    const selectionConfiguredBackendId = normalizeOptionalString(selection.configuredBackendId);
    const backendConfiguredBackendId = normalizeOptionalString(backend.configuredBackendId);
    return Boolean(
        selectionConfiguredBackendId
        && backendConfiguredBackendId
        && selectionConfiguredBackendId === backendConfiguredBackendId,
    );
}

/**
 * The favorite-identity of a resolved catalog entry, from the entry's own target.
 *
 * Every surface that stars or reads favorites for one Agent resolves the same
 * identity here, so a favorite written on one surface is found by the others.
 */
export function buildFavoriteModelBackendIdentityForEntry(entry: Readonly<{
    targetKey: string;
    providerAgentId?: string | null;
    builtInAgentId?: string | null;
    target: Readonly<{ kind: string; backendId?: string; agentId?: string }>;
}>): FavoriteModelBackendIdentity {
    return {
        backendTargetKey: entry.targetKey,
        providerAgentId: entry.providerAgentId ?? null,
        builtInAgentId: entry.builtInAgentId ?? null,
        configuredBackendId: entry.target.kind === 'configuredAcpBackend'
            ? entry.target.backendId ?? null
            : null,
    };
}

/**
 * The favorite model values of one backend, as the model picker's selection values.
 *
 * Available-favorite resolution needs a model list to filter against; a picker that
 * already shows one backend's models only needs to know which of them are favorites.
 */
export function resolveFavoriteModelValuesForBackend(params: Readonly<{
    favorites: readonly FavoriteModelSelectionV1[];
    backend: FavoriteModelBackendIdentity;
}>): ReadonlySet<string> {
    const values = new Set<string>();
    for (const favorite of params.favorites) {
        if (!favoriteModelSelectionMatchesBackend(favorite, params.backend)) continue;
        const modelId = normalizeFavoriteModelId(favorite.modelId);
        if (isFavoriteModelSelectableId(modelId)) values.add(modelId);
    }
    return values;
}

function addModelOptionAvailability(
    out: Map<string, AvailableFavoriteModel>,
    option: ModelOption,
): void {
    const modelId = normalizeFavoriteModelId(option.value);
    if (!isFavoriteModelSelectableId(modelId) || out.has(modelId)) return;
    out.set(modelId, {
        modelId,
        modelLabel: option.label || modelId,
        modelDescription: option.description ?? '',
    });
}

export function buildFavoriteModelAvailabilityById(params: Readonly<{
    mode: FavoriteModelAvailabilityMode;
    modelOptions: readonly ModelOption[];
    preflightModels: PreflightModelList | null | undefined;
}>): ReadonlyMap<string, AvailableFavoriteModel> {
    const out = new Map<string, AvailableFavoriteModel>();

    if (params.mode === 'static-only') {
        for (const option of params.modelOptions) {
            addModelOptionAvailability(out, option);
        }
        return out;
    }

    for (const model of params.preflightModels?.availableModels ?? []) {
        const modelId = normalizeFavoriteModelId(model.id);
        if (!isFavoriteModelSelectableId(modelId) || out.has(modelId)) continue;
        out.set(modelId, {
            modelId,
            modelLabel: model.name || modelId,
            modelDescription: model.description ?? '',
        });
    }

    for (const option of params.modelOptions) {
        addModelOptionAvailability(out, option);
    }

    return out;
}

export function resolveAvailableFavoriteModelsForBackend(params: Readonly<{
    favorites: readonly FavoriteModelSelectionV1[];
    backend: FavoriteModelBackendIdentity;
    availabilityById: ReadonlyMap<string, AvailableFavoriteModel>;
    backendLabel?: string | null;
}>): readonly AvailableFavoriteModel[] {
    const out: AvailableFavoriteModel[] = [];
    const seen = new Set<string>();

    for (const favorite of params.favorites) {
        if (!favoriteModelSelectionMatchesBackend(favorite, params.backend)) continue;
        const modelId = normalizeFavoriteModelId(favorite.modelId);
        if (!isFavoriteModelSelectableId(modelId) || seen.has(modelId)) continue;

        const available = params.availabilityById.get(modelId);
        if (!available) continue;
        seen.add(modelId);
        out.push({
            modelId,
            modelLabel: available.modelLabel || favorite.modelLabel || modelId,
            modelDescription: available.modelDescription,
            backendLabel: params.backendLabel ?? favorite.backendLabel,
        });
    }

    return out;
}

export function toggleFavoriteModelSelection(params: Readonly<{
    favorites: readonly FavoriteModelSelectionV1[];
    backend: FavoriteModelBackendIdentity;
    modelId: string;
    modelLabel?: string | null;
    backendLabel?: string | null;
    addedAtMs?: number;
}>): FavoriteModelSelectionV1[] {
    const modelId = normalizeFavoriteModelId(params.modelId);
    if (!isFavoriteModelSelectableId(modelId)) return [...params.favorites];

    const withoutExisting = params.favorites.filter((favorite) => (
        !favoriteModelSelectionMatchesBackend(favorite, params.backend)
        || normalizeFavoriteModelId(favorite.modelId) !== modelId
    ));
    if (withoutExisting.length !== params.favorites.length) {
        return withoutExisting;
    }

    const providerAgentId = normalizeOptionalString(params.backend.providerAgentId);
    const builtInAgentId = normalizeOptionalString(params.backend.builtInAgentId);
    const configuredBackendId = normalizeOptionalString(params.backend.configuredBackendId);
    const backendLabel = normalizeOptionalString(params.backendLabel);
    const modelLabel = normalizeOptionalString(params.modelLabel);

    return [
        ...params.favorites,
        {
            backendTargetKey: params.backend.backendTargetKey,
            modelId,
            ...(providerAgentId ? { providerAgentId } : {}),
            ...(builtInAgentId ? { builtInAgentId } : {}),
            ...(configuredBackendId ? { configuredBackendId } : {}),
            ...(backendLabel ? { backendLabel } : {}),
            ...(modelLabel ? { modelLabel } : {}),
            ...(typeof params.addedAtMs === 'number' && Number.isFinite(params.addedAtMs)
                ? { addedAtMs: Math.trunc(params.addedAtMs) }
                : {}),
        },
    ];
}

/**
 * The favorites with one more use on the favorite that matches the backend and model of a
 * new chat. Returns null when no favorite matches, so the caller writes no setting.
 */
export function countFavoriteModelUse(params: Readonly<{
    favorites: readonly FavoriteModelSelectionV1[];
    backend: FavoriteModelBackendIdentity;
    modelId: string | null | undefined;
}>): FavoriteModelSelectionV1[] | null {
    const modelId = normalizeFavoriteModelId(params.modelId);
    if (!isFavoriteModelSelectableId(modelId)) return null;
    let matched = false;
    const next = params.favorites.map((favorite) => {
        if (matched) return favorite;
        if (!favoriteModelSelectionMatchesBackend(favorite, params.backend)) return favorite;
        if (normalizeFavoriteModelId(favorite.modelId) !== modelId) return favorite;
        matched = true;
        return { ...favorite, useCount: (favorite.useCount ?? 0) + 1 };
    });
    return matched ? next : null;
}

/** The favorites with the most used first. Favorites with the same count keep their order. */
export function sortFavoriteModelSelectionsByUse(
    favorites: readonly FavoriteModelSelectionV1[],
): readonly FavoriteModelSelectionV1[] {
    if (!favorites.some((favorite) => (favorite.useCount ?? 0) > 0)) return favorites;
    return favorites
        .map((favorite, index) => ({ favorite, index }))
        .sort((a, b) => ((b.favorite.useCount ?? 0) - (a.favorite.useCount ?? 0)) || (a.index - b.index))
        .map((item) => item.favorite);
}
