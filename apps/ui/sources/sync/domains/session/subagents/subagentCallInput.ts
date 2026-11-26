import type { ToolCall } from '@/sync/domains/messages/messageTypes';

/**
 * Readers of what a subagent call says about its agent and its task, for every surface that shows
 * a subagent (transcript card, tool-calls sheet, Agents panel).
 */

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function readNonBlankString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.trim().length > 0 ? value : null;
}

/**
 * The fields of a subagent call. A pi-subagents workflow call (`{ workflow, args }`) holds the
 * `agent`, `task`, `tasks` and `chain` fields in `args`.
 */
function readSubagentInput(tool: Pick<ToolCall, 'input'>): Record<string, unknown> | null {
    const input = asRecord(tool.input);
    if (!input || readNonBlankString(input.workflow) === null) return input;
    return asRecord(input.args) ?? input;
}

/** The subagent type of a call, such as "Explore" or "general-purpose". Null when the input has none. */
export function readSubagentCallType(tool: Pick<ToolCall, 'input'>): string | null {
    const input = readSubagentInput(tool);
    if (!input) return null;
    // `agent` is the pi-subagents name of the same field.
    for (const key of ['subagent_type', 'agent_type', 'role', 'nickname', 'agent'] as const) {
        const value = readNonBlankString(input[key]);
        if (value) return value.trim();
    }
    return null;
}

/** The task prompt that the parent gave to the subagent. Null when the input has none. */
export function readSubagentCallPrompt(tool: Pick<ToolCall, 'input'>): string | null {
    const input = readSubagentInput(tool);
    if (!input) return null;
    return readNonBlankString(input.prompt)
        ?? readNonBlankString(input.task)
        ?? readNonBlankString(input.message)
        ?? readPiSubagentStepTasks(input.tasks)
        ?? readPiSubagentStepTasks(input.chain);
}

/** The parallel (`tasks`) or chain (`chain`) steps of a pi-subagents call, one "agent: task" each. */
function readPiSubagentStepTasks(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    const parts: string[] = [];
    for (const item of value) {
        const step = asRecord(item);
        const task = readNonBlankString(step?.task);
        if (!task) continue;
        const agent = readNonBlankString(step?.agent);
        parts.push(agent ? `${agent.trim()}: ${task}` : task);
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
}
