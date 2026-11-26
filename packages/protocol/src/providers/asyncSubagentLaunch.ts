import { isClaudeAsyncAgentLaunchToolResult } from './claude/sessionTasks.js';
import { isPiAsyncSubagentLaunchToolResult } from './pi/asyncSubagentLaunch.js';

/**
 * Is this tool result only the launch answer of an async subagent, so the agent still runs?
 *
 * Claude and `pi-subagents` both answer an async subagent call at once and send the real result
 * later. Readers that decide if a subagent is running ask this, not a provider reader, so that each
 * provider with async subagents gets the same status.
 */
export function isAsyncSubagentLaunchToolResult(value: unknown): boolean {
  return isClaudeAsyncAgentLaunchToolResult(value) || isPiAsyncSubagentLaunchToolResult(value);
}
