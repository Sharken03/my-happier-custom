import { isSubAgentTranscriptToolName } from '@happier-dev/protocol/tools/v2';

import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function readNonBlankString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.trim().length > 0 ? value : null;
}

/** True for a call of a subagent tool (Task, Agent, SubAgent, SubAgentRun). */
export function isToolCallsSheetSubagentCall(tool: Pick<ToolCall, 'name'>): boolean {
    return isSubAgentTranscriptToolName(tool.name);
}

/** The subagent type of a call, such as "Explore" or "general-purpose". Null when the input has none. */
export function readToolCallsSheetSubagentType(tool: Pick<ToolCall, 'input'>): string | null {
    const input = asRecord(tool.input);
    if (!input) return null;
    // `agent` is the pi-subagents name of the same field.
    for (const key of ['subagent_type', 'agent_type', 'role', 'nickname', 'agent'] as const) {
        const value = readNonBlankString(input[key]);
        if (value) return value.trim();
    }
    return null;
}

/** The task prompt that the parent gave to the subagent. Null when the input has none. */
export function readToolCallsSheetSubagentPrompt(tool: Pick<ToolCall, 'input'>): string | null {
    const input = asRecord(tool.input);
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

function readTextParts(value: unknown): string | null {
    if (typeof value === 'string') return readNonBlankString(value);
    if (!Array.isArray(value)) return null;
    const parts: string[] = [];
    for (const item of value) {
        const text = typeof item === 'string' ? item : readNonBlankString(asRecord(item)?.text);
        if (text && text.trim().length > 0) parts.push(text);
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
}

/** The final report of a subagent: the text of the call's result. Null while it runs or when the result has no text. */
export function readToolCallsSheetSubagentReport(tool: Pick<ToolCall, 'state' | 'result'>): string | null {
    if (tool.state === 'running') return null;
    const direct = readTextParts(tool.result);
    if (direct) return direct;
    const record = asRecord(tool.result);
    if (!record) return null;
    for (const key of ['content', 'result', 'text', 'output', 'report'] as const) {
        const text = readTextParts(record[key]);
        if (text) return text;
    }
    return null;
}

/**
 * True when the prompt block is needed. A sidechain often starts with the prompt as a user
 * message. Then the transcript already shows it.
 */
export function shouldShowToolCallsSheetSubagentPrompt(messages: readonly Pick<Message, 'kind'>[]): boolean {
    return !messages.some((message) => message.kind === 'user-text');
}

/**
 * True when the report block is needed. The subagent's last text message often is the report,
 * and then the transcript already shows it.
 */
export function shouldShowToolCallsSheetSubagentReport(
    report: string,
    messages: readonly Message[],
): boolean {
    const wanted = report.trim();
    return !messages.some((message) => message.kind === 'agent-text' && message.text.trim() === wanted);
}
