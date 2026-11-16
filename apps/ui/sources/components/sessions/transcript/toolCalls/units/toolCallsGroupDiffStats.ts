import {
    createDiffLineCounter,
    isSubAgentTranscriptToolName,
    readHappierDiffStats,
    sumDiffLineStats,
    type DiffLineStats,
} from '@happier-dev/protocol/tools/v2';

import type { Message, ToolCall } from '@/sync/domains/messages/messageTypes';

export type ToolCallsGroupDiffStats = DiffLineStats;

/**
 * The lines that a subagent changed, as the CLI counted them from the subagent's own session:
 * `result.details.happierDiffStats`. Null when the result has no count, for example while the
 * subagent runs or for a provider that does not send it.
 */
export function readSubagentResultDiffStats(tool: Readonly<{ name: string; result?: ToolCall['result'] }>): ToolCallsGroupDiffStats | null {
    if (!isSubAgentTranscriptToolName(tool.name ?? '')) return null;
    const result = typeof tool.result === 'object' && tool.result !== null ? (tool.result as Record<string, unknown>) : null;
    return result ? readHappierDiffStats(result.details) : null;
}

/**
 * Lines added and removed by the edit tools of a group, read from the tool inputs, and the CLI's
 * count in a subagent call's result.
 * Calls that ended in an error are skipped. Other tools count as zero.
 */
export function computeToolCallsGroupDiffStats(
    tools: readonly (Pick<ToolCall, 'name' | 'input'> & { state?: ToolCall['state']; result?: ToolCall['result'] })[],
): ToolCallsGroupDiffStats {
    const parts: DiffLineStats[] = [];
    const counter = createDiffLineCounter();
    for (const tool of tools) {
        if (tool.state === 'error') continue;
        const subagentStats = readSubagentResultDiffStats({ name: tool.name, result: tool.result });
        parts.push(subagentStats ?? counter.count(tool.name ?? '', tool.input));
    }
    return sumDiffLineStats(parts);
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
