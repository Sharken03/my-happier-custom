/**
 * The launch answer of an async `pi-subagents` run: the `subagent` call returns at once with the
 * run id (`details.asyncId`) and no results. The CLI sends the call's real result when the run
 * ends, and that result replaces the launch answer.
 */
export function isPiAsyncSubagentLaunchToolResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const details = (value as Record<string, unknown>).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
  const record = details as Record<string, unknown>;
  return typeof record.asyncId === 'string'
    && record.asyncId.length > 0
    && Array.isArray(record.results)
    && record.results.length === 0;
}
