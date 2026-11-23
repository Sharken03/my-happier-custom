import { z } from 'zod';
import { opaqueSessionControlIdentifierSchema } from './opaqueIdentifiers';

const SessionModeOptionSchema = z.object({
    id: opaqueSessionControlIdentifierSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
});

const SessionModesStateSchema = z.object({
    v: z.literal(1),
    provider: opaqueSessionControlIdentifierSchema,
    updatedAt: z.number(),
    currentModeId: opaqueSessionControlIdentifierSchema,
    availableModes: z.array(SessionModeOptionSchema).default([]),
});

const SessionModelOptionChoiceSchema = z.object({
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
});

const SessionModelOptionSchema = z.object({
    id: opaqueSessionControlIdentifierSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1),
    currentValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    options: z.array(SessionModelOptionChoiceSchema).default([]),
});

const SessionModelSchema = z.object({
    id: opaqueSessionControlIdentifierSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    contextWindowTokens: z.number().int().positive().optional(),
    extendedContextModelId: opaqueSessionControlIdentifierSchema.optional(),
    costInputPerMTok: z.number().finite().nonnegative().optional(),
    costOutputPerMTok: z.number().finite().nonnegative().optional(),
    modelOptions: z.array(SessionModelOptionSchema).default([]),
});

const SessionModelsStateSchema = z.object({
    v: z.literal(1),
    provider: opaqueSessionControlIdentifierSchema,
    updatedAt: z.number(),
    currentModelId: opaqueSessionControlIdentifierSchema,
    availableModels: z.array(SessionModelSchema).default([]),
});

const SessionConfigOptionSelectOptionSchema = z.object({
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
});

const SessionConfigOptionSchema = z.object({
    id: opaqueSessionControlIdentifierSchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1),
    currentValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    options: z.array(SessionConfigOptionSelectOptionSchema).default([]),
});

const SessionConfigOptionsStateSchema = z.object({
    v: z.literal(1),
    provider: opaqueSessionControlIdentifierSchema,
    updatedAt: z.number(),
    configOptions: z.array(SessionConfigOptionSchema).default([]),
});

const SessionConfigOptionOverridesSchema = z.object({
    v: z.literal(1),
    updatedAt: z.number(),
    overrides: z.record(
        z.string(),
        z.object({
            updatedAt: z.number(),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        }),
    ),
});

const SessionModeOverrideSchema = z.object({
    v: z.literal(1),
    updatedAt: z.number(),
    modeId: opaqueSessionControlIdentifierSchema,
});

export type SessionModesState = z.infer<typeof SessionModesStateSchema>;
export type SessionModelsState = z.infer<typeof SessionModelsStateSchema>;
export type SessionConfigOptionsState = z.infer<typeof SessionConfigOptionsStateSchema>;
export type SessionConfigOptionOverridesState = z.infer<typeof SessionConfigOptionOverridesSchema>;
export type SessionModeOverrideState = z.infer<typeof SessionModeOverrideSchema>;

export function parseSessionModesState(raw: unknown): SessionModesState | null {
    const parsed = SessionModesStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/**
 * Caches one parse result per raw metadata object.
 *
 * Model and config option lists can hold hundreds of entries, and the composer reads them several
 * times per render. Metadata objects are replaced, not mutated, so a new value gets a new parse.
 */
function createRawObjectParseCache<T>(schema: z.ZodType<T>): (raw: unknown) => T | null {
    const cache = new WeakMap<object, T | null>();
    return (raw) => {
        if (raw === null || typeof raw !== 'object') {
            const parsed = schema.safeParse(raw);
            return parsed.success ? parsed.data : null;
        }
        if (cache.has(raw)) return cache.get(raw) ?? null;
        const parsed = schema.safeParse(raw);
        const result = parsed.success ? parsed.data : null;
        cache.set(raw, result);
        return result;
    };
}

const parseSessionModelsStateCached = createRawObjectParseCache<SessionModelsState>(SessionModelsStateSchema);
const parseSessionConfigOptionsStateCached = createRawObjectParseCache<SessionConfigOptionsState>(SessionConfigOptionsStateSchema);

export function parseSessionModelsState(raw: unknown): SessionModelsState | null {
    return parseSessionModelsStateCached(raw);
}

export function parseSessionConfigOptionsState(raw: unknown): SessionConfigOptionsState | null {
    return parseSessionConfigOptionsStateCached(raw);
}

export function parseSessionConfigOptionOverridesState(raw: unknown): SessionConfigOptionOverridesState | null {
    const parsed = SessionConfigOptionOverridesSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

export function parseSessionModeOverrideState(raw: unknown): SessionModeOverrideState | null {
    const parsed = SessionModeOverrideSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
