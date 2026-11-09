import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { NormalizedToolTurnChangeTracker } from '@/agent/tools/diff/normalizedToolTurnChangeTracker';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

type CanonicalFileToolCall = Readonly<{ toolName: 'Edit' | 'MultiEdit' | 'Write'; args: Record<string, unknown> }>;

function readEdit(value: unknown): Readonly<{ old_string: string; new_string: string }> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.oldText !== 'string' || typeof record.newText !== 'string') return null;
    return { old_string: record.oldText, new_string: record.newText };
}

/**
 * Pi's `edit` ({ path, edits: [{ oldText, newText }] }, or one oldText/newText pair) and `write`
 * ({ path, content }) in the canonical Edit / MultiEdit / Write shape that the shared tracker
 * reads, with the path absolute: Pi resolves a relative path against the session folder.
 */
export function toCanonicalPiFileToolCall(params: Readonly<{
    toolName: string;
    args: Record<string, unknown>;
    cwd: string;
    env?: NodeJS.ProcessEnv;
}>): CanonicalFileToolCall | null {
    const rawPath = typeof params.args.path === 'string' ? params.args.path.trim() : '';
    if (!rawPath) return null;
    const expanded = expandHomeDirPath(rawPath, params.env ?? process.env);
    const filePath = isAbsolute(expanded) ? expanded : resolve(params.cwd, expanded);

    if (params.toolName === 'write') {
        return { toolName: 'Write', args: { file_path: filePath } };
    }
    if (params.toolName !== 'edit') return null;

    const edits = Array.isArray(params.args.edits)
        ? params.args.edits.map(readEdit)
        : [readEdit(params.args)];
    if (edits.length === 0 || edits.some((edit) => edit === null)) return null;
    if (edits.length === 1) {
        return { toolName: 'Edit', args: { file_path: filePath, ...edits[0] } };
    }
    return { toolName: 'MultiEdit', args: { file_path: filePath, edits } };
}

/** Collects the files a Pi turn changed, for the canonical turn Diff the app reads. */
export class PiTurnChangeTracker extends NormalizedToolTurnChangeTracker {
    constructor() {
        // Turn ids must stay unique across restarts of the same chat, so each process has its own.
        super({ provider: 'pi', turnIdPrefix: `pi-turn-${randomUUID().slice(0, 8)}` });
    }

    observePiToolCall(params: Readonly<{
        callId: string;
        toolName: string;
        args: Record<string, unknown>;
        cwd: string;
    }>): void {
        const canonical = toCanonicalPiFileToolCall(params);
        if (!canonical) return;
        this.observeToolCall({ callId: params.callId, toolName: canonical.toolName, args: canonical.args });
    }
}
