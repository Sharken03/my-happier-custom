import type { ToolCall } from '@/sync/domains/messages/messageTypes';
import { toolCallKind, type ToolCallKind } from '@/components/sessions/transcript/toolCalls/units/toolCallsGroupSummary';

export type ToolCallSheetLabel = Readonly<{
    /** The kind of call, which selects the verb ("Ran", "Read", ...). */
    kind: ToolCallKind;
    running: boolean;
    /** What the call worked on: its description, command, path, pattern or URL. Null when unknown. */
    target: string | null;
    /** The tool name, shown after "Used" for a call of kind 'other'. */
    toolName: string;
}>;

const TARGET_INPUT_KEYS = ['command', 'cmd', 'file_path', 'path', 'notebook_path', 'pattern', 'query', 'url', 'urls', 'subagent_type'] as const;

/** The parts of a Claude-app style row in the Tool calls sheet, such as "Ran" + "Count my markers". */
export function resolveToolCallSheetLabel(tool: Pick<ToolCall, 'name' | 'state' | 'input' | 'description'>): ToolCallSheetLabel {
    return {
        kind: toolCallKind(tool.name) ?? 'other',
        running: tool.state === 'running',
        target: resolveTarget(tool),
        toolName: tool.name,
    };
}

function resolveTarget(tool: Pick<ToolCall, 'input' | 'description'>): string | null {
    const description = firstLine(tool.description) ?? firstLine(readInput(tool.input, 'description'));
    if (description) return description;
    for (const key of TARGET_INPUT_KEYS) {
        const value = firstLine(readInput(tool.input, key));
        if (value) return value;
    }
    return null;
}

function readInput(input: unknown, key: string): unknown {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    return (input as Record<string, unknown>)[key];
}

/** The first non-empty line of a string, or of the first string in an array. */
function firstLine(value: unknown): string | null {
    const text = Array.isArray(value)
        ? value.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : value;
    if (typeof text !== 'string') return null;
    const line = text.split('\n').find((part) => part.trim().length > 0)?.trim();
    return line && line.length > 0 ? line : null;
}
