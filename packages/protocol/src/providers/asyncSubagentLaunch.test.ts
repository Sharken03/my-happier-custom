import { describe, expect, it } from 'vitest';

import { isAsyncSubagentLaunchToolResult } from './asyncSubagentLaunch.js';

describe('isAsyncSubagentLaunchToolResult', () => {
  it('matches the launch answer of each provider', () => {
    expect(isAsyncSubagentLaunchToolResult(JSON.stringify({ isAsync: true, status: 'async_launched', agentId: 'a1' }))).toBe(true);
    expect(isAsyncSubagentLaunchToolResult({ content: 'Detached.', details: { asyncId: 'run-1', results: [] } })).toBe(true);
  });

  it('does not match a real result', () => {
    expect(isAsyncSubagentLaunchToolResult('All findings closed.')).toBe(false);
    expect(isAsyncSubagentLaunchToolResult({ content: 'Done', details: { runId: 'run-1', results: [{ sessionFile: '/s.jsonl' }] } })).toBe(false);
  });
});
