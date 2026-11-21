import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withPiSubagentDiffStats } from './piSubagentDiffStats';

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const call = (id: string, name: string, args: unknown) =>
  line({ type: 'message', id: `a-${id}`, message: { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: args }] } });
const result = (id: string, toolName: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'message', id: `r-${id}`, message: { role: 'toolResult', toolCallId: id, toolName, content: [], ...extra } });

describe('withPiSubagentDiffStats', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-diff-stats-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('adds the lines that the child sessions changed to a finished subagent result', async () => {
    const grandchild = join(dir, 'grandchild.jsonl');
    await writeFile(grandchild, call('g1', 'write', { path: 'b', content: 'x\n' }) + result('g1', 'write'));
    const child = join(dir, 'child.jsonl');
    await writeFile(child, [
      line({ type: 'session', id: 's' }),
      call('c1', 'write', { path: 'a', content: 'one\ntwo\nthree\n' }),
      result('c1', 'write'),
      call('c2', 'edit', { path: 'a', edits: [{ oldText: 'two', newText: 'two edited' }] }),
      result('c2', 'edit'),
      call('c3', 'edit', { path: 'a', edits: [{ oldText: 'zzz', newText: 'y' }] }),
      result('c3', 'edit', { isError: true }),
      call('c4', 'read', { path: 'a' }),
      result('c4', 'read'),
      call('c5', 'subagent', { agent: 'scout' }),
      result('c5', 'subagent', { details: { results: [{ sessionFile: grandchild }] } }),
    ].join(''));

    const event = {
      type: 'tool_execution_end',
      toolName: 'subagent',
      toolCallId: 'parent',
      result: { content: [{ type: 'text', text: 'done' }], details: { mode: 'single', results: [{ sessionFile: child }] } },
    };
    const out = withPiSubagentDiffStats(event) as { result: { details: Record<string, unknown> } };
    // write 3 + edit 1/1 + grandchild write 1; the failed edit is skipped.
    expect(out.result.details.happierDiffStats).toEqual({ added: 5, removed: 1 });
    expect(out.result.details.mode).toBe('single');
  });

  it('leaves other events and calls without child sessions unchanged', () => {
    const update = { type: 'tool_execution_update', toolName: 'subagent', toolCallId: 'p', partialResult: {} };
    expect(withPiSubagentDiffStats(update)).toBe(update);
    const asyncLaunch = { type: 'tool_execution_end', toolName: 'subagent', toolCallId: 'p', result: { details: { results: [] } } };
    expect(withPiSubagentDiffStats(asyncLaunch)).toBe(asyncLaunch);
    const edit = { type: 'tool_execution_end', toolName: 'edit', toolCallId: 'e', result: { details: {} } };
    expect(withPiSubagentDiffStats(edit)).toBe(edit);
  });
});
