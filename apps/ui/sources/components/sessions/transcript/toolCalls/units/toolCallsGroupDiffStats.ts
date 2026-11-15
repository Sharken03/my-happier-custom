import type { ToolCall } from '@/sync/domains/messages/messageTypes';

export type ToolCallsGroupDiffStats = Readonly<{ added: number; removed: number }>;

/** Lines of a text; an empty text has none. A final line break does not add a line. */
function splitLines(text: string): string[] {
    if (text.length === 0) return [];
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/**
 * Cheap line diff of one replacement. It drops the common first and last lines, then matches the
 * rest as multisets: a line that appears in both texts is not counted. Order is ignored.
 */
function countReplacement(oldText: string, newText: string): { added: number; removed: number } {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
        oldEnd--;
        newEnd--;
    }
    const pool = new Map<string, number>();
    for (let i = start; i < oldEnd; i++) pool.set(oldLines[i], (pool.get(oldLines[i]) ?? 0) + 1);
    let added = 0;
    for (let i = start; i < newEnd; i++) {
        const left = pool.get(newLines[i]) ?? 0;
        if (left > 0) pool.set(newLines[i], left - 1);
        else added++;
    }
    let removed = 0;
    for (const left of pool.values()) removed += left;
    return { added, removed };
}

/** Counts the '+' and '-' lines of patch text, without the '+++' and '---' file headers. */
function countPatchText(text: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
    }
    return { added, removed };
}

function str(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null;
}

/** One edit object: Claude (old_string, new_string) or Pi (oldText, newText). */
function countEditObject(edit: unknown): { added: number; removed: number } {
    if (!isRecord(edit)) return { added: 0, removed: 0 };
    const oldText = str(edit.old_string) ?? str(edit.oldText) ?? str(edit.oldString) ?? '';
    const newText = str(edit.new_string) ?? str(edit.newText) ?? str(edit.newString) ?? '';
    return countReplacement(oldText, newText);
}

const PATCH_TEXT_KEYS = ['patchText', 'patch', 'input', 'diff', 'unified_diff'] as const;

function countPatchInput(input: Record<string, any>): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const key of PATCH_TEXT_KEYS) {
        const text = str(input[key]);
        if (text === null) continue;
        const counts = countPatchText(text);
        return counts;
    }
    // Codex style: a map (or list) of per-file changes with a unified diff or the new content.
    const changes = input.changes;
    const entries = Array.isArray(changes) ? changes : isRecord(changes) ? Object.values(changes) : [];
    for (const change of entries) {
        if (!isRecord(change)) continue;
        const diff = str(change.unified_diff) ?? str(change.diff);
        if (diff !== null) {
            const counts = countPatchText(diff);
            added += counts.added;
            removed += counts.removed;
        } else if (change.type === 'add' && str(change.content) !== null) {
            added += splitLines(change.content).length;
        }
    }
    return { added, removed };
}

function countToolCall(name: string, input: unknown): { added: number; removed: number } {
    if (!isRecord(input)) return { added: 0, removed: 0 };
    switch (name.trim().toLowerCase()) {
        case 'edit': {
            // Pi's edit may carry a list of edits; Claude's carries one.
            if (Array.isArray(input.edits)) return sum(input.edits.map(countEditObject));
            return countEditObject(input);
        }
        case 'multiedit':
            return Array.isArray(input.edits) ? sum(input.edits.map(countEditObject)) : { added: 0, removed: 0 };
        case 'write':
        case 'write_file':
            return { added: splitLines(str(input.content) ?? '').length, removed: 0 };
        case 'apply_patch':
        case 'patch':
        case 'codexpatch':
        case 'geminipatch':
            return countPatchInput(input);
        default:
            return { added: 0, removed: 0 };
    }
}

function sum(parts: readonly { added: number; removed: number }[]): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const part of parts) {
        added += part.added;
        removed += part.removed;
    }
    return { added, removed };
}

/**
 * Lines added and removed by the edit tools of a group, read from the tool inputs.
 * Calls that ended in an error are skipped. Other tools count as zero.
 */
export function computeToolCallsGroupDiffStats(
    tools: readonly (Pick<ToolCall, 'name' | 'input'> & { state?: ToolCall['state'] })[],
): ToolCallsGroupDiffStats {
    const parts: { added: number; removed: number }[] = [];
    for (const tool of tools) {
        if (tool.state === 'error') continue;
        parts.push(countToolCall(tool.name ?? '', tool.input));
    }
    return sum(parts);
}
