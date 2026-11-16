import { isSubAgentTranscriptToolName } from '@happier-dev/protocol/tools/v2';

import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';

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

function readCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

/**
 * The lines that a subagent changed, as the CLI counted them from the subagent's own session:
 * `result.details.happierDiffStats`. Null when the result has no count, for example while the
 * subagent runs or for a provider that does not send it.
 */
export function readSubagentResultDiffStats(tool: Readonly<{ name: string; result?: ToolCall['result'] }>): ToolCallsGroupDiffStats | null {
    if (!isSubAgentTranscriptToolName(tool.name ?? '')) return null;
    const result = isRecord(tool.result) ? tool.result : null;
    const details = result && isRecord(result.details) ? result.details : null;
    const stats = details && isRecord(details.happierDiffStats) ? details.happierDiffStats : null;
    if (!stats) return null;
    const added = readCount(stats.added);
    const removed = readCount(stats.removed);
    return added === null || removed === null ? null : { added, removed };
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
 * Lines added and removed by the edit tools of a group, read from the tool inputs, and the CLI's
 * count in a subagent call's result.
 * Calls that ended in an error are skipped. Other tools count as zero.
 */
export function computeToolCallsGroupDiffStats(
    tools: readonly (Pick<ToolCall, 'name' | 'input'> & { state?: ToolCall['state']; result?: ToolCall['result'] })[],
): ToolCallsGroupDiffStats {
    const parts: { added: number; removed: number }[] = [];
    for (const tool of tools) {
        if (tool.state === 'error') continue;
        const subagentStats = readSubagentResultDiffStats({ name: tool.name, result: tool.result });
        parts.push(subagentStats ?? countToolCall(tool.name ?? '', tool.input));
    }
    return sum(parts);
}

/**
 * The tools of a group's calls and of the tool calls under them, such as the edits of a subagent.
 * A subagent's calls are children of its call; they are there only while its sidechain is loaded.
 * A subagent call whose result holds the CLI's count stands for all its calls, so its children
 * are not added a second time.
 */
export function collectToolCallsGroupDiffTools(messages: readonly Message[]): ToolCall[] {
    const tools: ToolCall[] = [];
    const visit = (list: readonly Message[]) => {
        for (const message of list) {
            if (message.kind !== 'tool-call') continue;
            if (message.tool) tools.push(message.tool);
            if (message.tool && readSubagentResultDiffStats(message.tool)) continue;
            if (message.children?.length) visit(message.children);
        }
    };
    visit(messages);
    return tools;
}

/** The lines that one call changed, with the calls under it, such as a subagent's edits. */
export function computeToolCallMessageDiffStats(message: Message): ToolCallsGroupDiffStats {
    return computeToolCallsGroupDiffStats(collectToolCallsGroupDiffTools([message]));
}
