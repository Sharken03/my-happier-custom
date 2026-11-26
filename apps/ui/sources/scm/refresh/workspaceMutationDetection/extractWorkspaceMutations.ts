import type { NormalizedMessage } from '@/sync/typesRaw';
import { resolveToolMutationClassification } from '@/sync/domains/tools/toolMutationClassification';

export type WorkspaceMutationExtractionResult = Readonly<{
    paths: ReadonlySet<string>;
    hasUnknownMutations: boolean;
}>;

type MutationToolKind =
    | 'single-path'
    | 'patch'
    | 'path-pair'
    | 'opaque-executor'
    | 'container'
    | 'unknown';

const FILE_PATH_FIELD_KEYS = ['path', 'filePath', 'file_path', 'filename', 'fileName'] as const;
const PATH_PAIR_FIELD_KEYS = ['path', 'from', 'to', 'src', 'dest'] as const;

function normalizeMutationToolName(name: string): string | null {
    const normalizedName = name.trim().toLowerCase();
    return normalizedName.length > 0 ? normalizedName : null;
}

function readHappierMetaRecord(input: unknown): Record<string, unknown> | null {
    if (input === null || input === undefined) return null;
    if (typeof input !== 'object') return null;

    const record = input as Record<string, unknown>;
    for (const happierKey of ['_happier', '_happy'] as const) {
        const meta = record[happierKey];
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
        return meta as Record<string, unknown>;
    }

    return null;
}

function readCanonicalMutationToolName(input: unknown): string | null {
    const meta = readHappierMetaRecord(input);
    if (meta) {
        const canonicalToolName = meta.canonicalToolName;
        if (typeof canonicalToolName === 'string') {
            const normalizedName = normalizeMutationToolName(canonicalToolName);
            if (normalizedName) return normalizedName;
        }
    }

    return null;
}

function hasWorkspaceMutationSignal(input: unknown): boolean {
    const meta = readHappierMetaRecord(input);
    return meta?.workspaceMutationSignal === 'turn-change-set';
}

function resolveMutationToolKind(name: string): MutationToolKind | null {
    const normalizedName = normalizeMutationToolName(name);
    if (!normalizedName) return null;
    const sharedClassification = resolveToolMutationClassification(normalizedName);
    switch (sharedClassification) {
        case 'single_path':
            return 'single-path';
        case 'patch':
            return 'patch';
        case 'path_pair':
            return 'path-pair';
        case 'opaque_executor':
            return 'opaque-executor';
        case 'container':
            return 'container';
        case 'mutating_unknown':
            return 'unknown';
        case 'read_only':
            return null;
        default:
            return null;
    }
}

function resolveMutationToolKindFromToolCall(name: string, input: unknown): MutationToolKind | null {
    const canonicalToolName = readCanonicalMutationToolName(input);
    if (canonicalToolName) {
        const canonicalToolKind = resolveMutationToolKind(canonicalToolName);
        if (canonicalToolKind) return canonicalToolKind;
    }

    return resolveMutationToolKind(name);
}

function resolveNormalizedMutationToolNameFromToolCall(name: string, input: unknown): string | null {
    return readCanonicalMutationToolName(input) ?? normalizeMutationToolName(name);
}

function readStringField(input: unknown, keys: readonly string[]): string | null {
    if (input === null || input === undefined) return null;
    if (typeof input !== 'object') return null;
    const record = input as Record<string, unknown>;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}

function collectStringFields(input: unknown, keys: readonly string[]): string[] {
    if (input === null || input === undefined) return [];
    if (typeof input !== 'object') return [];

    const record = input as Record<string, unknown>;
    const out: string[] = [];
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            out.push(value);
        }
    }
    return out;
}

function collectPathsFromChangeList(input: unknown, key: string): string[] {
    if (input === null || input === undefined) return [];
    if (typeof input !== 'object') return [];
    const record = input as Record<string, unknown>;
    const raw = record[key];
    if (!Array.isArray(raw)) return [];

    const out: string[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const path = (entry as Record<string, unknown>).path;
        if (typeof path === 'string' && path.trim().length > 0) {
            out.push(path);
        }
    }
    return out;
}

function collectPathsFromChangeMap(input: unknown, key: string): string[] {
    if (input === null || input === undefined) return [];
    if (typeof input !== 'object') return [];
    const record = input as Record<string, unknown>;
    const raw = record[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.keys(raw).filter((path) => path.trim().length > 0);
}

function collectPathsFromStringArrayField(input: unknown, key: string): string[] {
    if (input === null || input === undefined) return [];
    if (typeof input !== 'object') return [];
    const record = input as Record<string, unknown>;
    const raw = record[key];
    if (!Array.isArray(raw)) return [];

    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
            out.push(entry);
        }
    }
    return out;
}

function collectPathsFromDiffFiles(input: unknown): string[] {
    if (input === null || input === undefined) return [];
    if (typeof input !== 'object') return [];
    const record = input as Record<string, unknown>;
    const raw = record.files;
    if (!Array.isArray(raw)) return [];

    const out: string[] = [];
    for (const entry of raw) {
        const path = readStringField(entry, FILE_PATH_FIELD_KEYS);
        if (path) out.push(path);
    }
    return out;
}

/**
 * The paths one tool call changes, from its name and input. `hasUnknownMutations` is true when
 * the call can change files but names no paths (for example a shell command).
 */
export function extractToolCallMutation(name: string, toolInput: unknown): Readonly<{
    paths: readonly string[];
    hasUnknownMutations: boolean;
}> {
    const toolKind = resolveMutationToolKindFromToolCall(name, toolInput);

    if (resolveNormalizedMutationToolNameFromToolCall(name, toolInput) === 'diff' && hasWorkspaceMutationSignal(toolInput)) {
        const diffPaths = collectPathsFromDiffFiles(toolInput);
        return { paths: diffPaths, hasUnknownMutations: diffPaths.length === 0 };
    }

    if (toolKind === 'single-path') {
        const paths: string[] = [];
        const path = readStringField(toolInput, FILE_PATH_FIELD_KEYS);
        if (path) paths.push(path);
        paths.push(...collectPathsFromStringArrayField(toolInput, 'file_paths'));
        return { paths, hasUnknownMutations: false };
    }

    if (toolKind === 'patch') {
        const paths = [
            ...collectPathsFromChangeList(toolInput, 'changes'),
            ...collectPathsFromChangeMap(toolInput, 'changes'),
        ];
        const singlePath = readStringField(toolInput, FILE_PATH_FIELD_KEYS);
        if (singlePath) paths.push(singlePath);
        paths.push(...collectPathsFromStringArrayField(toolInput, 'file_paths'));
        return { paths, hasUnknownMutations: false };
    }

    if (toolKind === 'path-pair') {
        return { paths: collectStringFields(toolInput, PATH_PAIR_FIELD_KEYS), hasUnknownMutations: false };
    }

    if (toolKind === 'opaque-executor' || toolKind === 'unknown') {
        // Best-effort only: shell commands can mutate any files, but extracting paths is brittle.
        return { paths: [], hasUnknownMutations: true };
    }

    if (toolKind === 'container') {
        return { paths: [], hasUnknownMutations: false };
    }

    // Unknown tools: if we can't safely extract paths, mark unknown mutations only when
    // the tool is plausibly mutating (heuristic: it has an input with a command string).
    const command = readStringField(toolInput, ['command', 'cmd']);
    return { paths: [], hasUnknownMutations: Boolean(command) };
}

export function extractWorkspaceMutationsFromNormalizedMessages(input: Readonly<{
    messages: readonly NormalizedMessage[];
}>): WorkspaceMutationExtractionResult {
    const paths = new Set<string>();
    let hasUnknownMutations = false;

    for (const message of input.messages) {
        if (!message || message.role !== 'agent') continue;
        if (!Array.isArray(message.content)) continue;

        for (const part of message.content) {
            if (!part || typeof part !== 'object') continue;
            const type = (part as any).type;
            if (type === 'tool-call') {
                const name = typeof (part as any).name === 'string' ? String((part as any).name) : '';
                const mutation = extractToolCallMutation(name, (part as any).input as unknown);
                for (const path of mutation.paths) paths.add(path);
                if (mutation.hasUnknownMutations) hasUnknownMutations = true;
                continue;
            }

            if (type === 'tool-result') {
                // Tool results may contain structured “files changed” metadata, but providers vary a lot.
                // Keep this best-effort and conservative.
                const content = (part as any).content as unknown;
                const changed = collectPathsFromChangeList(content, 'changedFiles');
                for (const path of changed) paths.add(path);
            }
        }
    }

    return { paths, hasUnknownMutations };
}
