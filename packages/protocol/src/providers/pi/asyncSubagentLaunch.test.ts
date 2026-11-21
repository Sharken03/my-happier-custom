import { describe, expect, it } from 'vitest';

import { isPiAsyncSubagentLaunchToolResult } from './asyncSubagentLaunch.js';

describe('isPiAsyncSubagentLaunchToolResult', () => {
  it('matches the launch answer and not the final result', () => {
    expect(isPiAsyncSubagentLaunchToolResult({ content: 'Detached.', details: { asyncId: 'run-1', results: [] } })).toBe(true);
    expect(isPiAsyncSubagentLaunchToolResult({ content: 'Done', details: { runId: 'run-1', results: [{ sessionFile: '/s.jsonl' }] } })).toBe(false);
    expect(isPiAsyncSubagentLaunchToolResult({ content: 'x', details: { mode: 'single', results: [] } })).toBe(false);
    expect(isPiAsyncSubagentLaunchToolResult('Detached.')).toBe(false);
  });
});
