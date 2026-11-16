import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ACPMessageData } from '@/api/session/sessionMessageTypes';

import { createPiSubagentSidechainMirror, readPiSubagentSessionObservation } from './piSubagentSidechainMirror';

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

const userEntry = { type: 'message', id: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'Find the bug' }] } };
const assistantEntry = {
  type: 'message',
  id: 'a1',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Look at the parser' },
      { type: 'text', text: 'Reading the file' },
      { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: 'src/a.ts' } },
    ],
  },
};
const toolResultEntry = {
  type: 'message',
  id: 'r1',
  message: { role: 'toolResult', toolCallId: 'call_1', toolName: 'read', content: [{ type: 'text', text: 'file body' }], isError: false },
};

const editEntry = {
  type: 'message',
  id: 'a2',
  message: {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'call_2', name: 'edit', arguments: { path: 'src/a.ts', edits: [{ oldText: 'a\nb\n', newText: 'a\nc\nd\n' }] } }],
  },
};
const editResultEntry = {
  type: 'message',
  id: 'r2',
  message: { role: 'toolResult', toolCallId: 'call_2', toolName: 'edit', content: [{ type: 'text', text: 'ok' }], isError: false },
};
const answerEntry = { type: 'message', id: 'a3', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed the parser' }] } };

function updateEvent(sessionFile: string) {
  return {
    type: 'tool_execution_update',
    toolCallId: 'parent-call',
    toolName: 'subagent',
    partialResult: { content: [{ type: 'text', text: 'scout running' }], details: { mode: 'single', results: [{ agent: 'scout', sessionFile }] } },
  };
}

describe('readPiSubagentSessionObservation', () => {
  it('reads child session files from subagent update and end events only', () => {
    expect(readPiSubagentSessionObservation(updateEvent('/tmp/s/session.jsonl')))
      .toEqual({ kind: 'sessions', callId: 'parent-call', sessionFiles: ['/tmp/s/session.jsonl'], final: false });
    expect(readPiSubagentSessionObservation({
      type: 'tool_execution_end',
      toolCallId: 'parent-call',
      toolName: 'subagent',
      result: { details: { results: [{ sessionFile: '/tmp/s/session.jsonl' }] } },
    })).toEqual({ kind: 'sessions', callId: 'parent-call', sessionFiles: ['/tmp/s/session.jsonl'], final: true });
    expect(readPiSubagentSessionObservation({ ...updateEvent('/tmp/s/session.jsonl'), toolName: 'bash' })).toBeNull();
    expect(readPiSubagentSessionObservation(updateEvent('relative/session.jsonl'))).toBeNull();
  });
});

describe('createPiSubagentSidechainMirror', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-subagent-mirror-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends each new child message block once, under the parent tool call sidechain', async () => {
    const sessionFile = join(dir, 'session.jsonl');
    const sent: Array<{ body: ACPMessageData; localId: string }> = [];
    const mirror = createPiSubagentSidechainMirror({
      send: async (body, opts) => {
        sent.push({ body, localId: opts.localId });
      },
    });
    const observation = readPiSubagentSessionObservation(updateEvent(sessionFile))!;

    // The child has not created its file yet.
    await mirror.observe(observation);
    expect(sent).toEqual([]);

    // A line without its newline is still being written and must wait.
    const assistantLine = line(assistantEntry);
    await writeFile(sessionFile, line({ type: 'session', id: 's' }) + line(userEntry) + assistantLine.slice(0, 20));
    await mirror.observe(observation);
    expect(sent).toEqual([]);

    await appendFile(sessionFile, assistantLine.slice(20));
    await mirror.observe(observation);
    await appendFile(sessionFile, line(toolResultEntry));
    await mirror.observe(observation);
    await mirror.observe({ ...observation, final: true });

    expect(sent.map((item) => item.body)).toEqual([
      { type: 'thinking', text: 'Look at the parser', sidechainId: 'parent-call' },
      { type: 'message', message: 'Reading the file', sidechainId: 'parent-call' },
      {
        type: 'tool-call',
        callId: 'sc:parent-call:call_1',
        name: 'read',
        input: { path: 'src/a.ts' },
        id: 'pi-subagent-sc:parent-call:call_1',
        sidechainId: 'parent-call',
      },
      {
        type: 'tool-result',
        callId: 'sc:parent-call:call_1',
        output: { content: [{ type: 'text', text: 'file body' }] },
        id: 'pi-subagent-sc:parent-call:call_1-result',
        sidechainId: 'parent-call',
      },
    ]);
    expect(new Set(sent.map((item) => item.localId)).size).toBe(sent.length);
  });
});

describe('async pi-subagents runs', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-subagent-async-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('follows the async run status and mirrors its child session into the launching call', async () => {
    const asyncDir = join(dir, 'run');
    const sessionFile = join(dir, 'session.jsonl');
    const sent: ACPMessageData[] = [];
    const mirror = createPiSubagentSidechainMirror({
      send: async (body) => {
        sent.push(body);
      },
      asyncStatusPollMs: 5,
    });

    const launch = readPiSubagentSessionObservation({
      type: 'tool_execution_end',
      toolCallId: 'parent-call',
      toolName: 'subagent',
      result: { details: { mode: 'single', results: [], asyncId: 'run-1', asyncDir } },
    });
    expect(launch).toEqual({ kind: 'async-launch', callId: 'parent-call', runId: 'run-1', asyncDir });

    await writeFile(sessionFile, line(assistantEntry));
    await mkdir(asyncDir);
    await writeFile(join(asyncDir, 'status.json'), JSON.stringify({ state: 'running', steps: [{ sessionFile }] }));
    mirror.observe(launch!);
    await vi.waitFor(() => expect(sent.length).toBe(3));

    await appendFile(sessionFile, line(toolResultEntry));
    await appendFile(sessionFile, line(editEntry) + line(editResultEntry) + line(answerEntry));
    await writeFile(join(asyncDir, 'status.json'), JSON.stringify({ state: 'complete', sessionFile }));
    const completion = readPiSubagentSessionObservation({
      type: 'tool_execution_end',
      toolCallId: 'wait-call',
      toolName: 'bg_wait',
      result: { details: { completions: [{ runId: 'run-1', results: [{ sessionFile }] }] } },
    });
    expect(completion).toEqual({ kind: 'async-complete', runId: 'run-1', sessionFiles: [sessionFile] });
    await mirror.observe(completion!);

    const sidechain = sent.filter((body) => body.sidechainId === 'parent-call');
    expect(sidechain.map((body) => body.type)).toEqual(['thinking', 'message', 'tool-call', 'tool-result', 'tool-call', 'tool-result', 'message']);
    // The launching call gets one real result, outside the sidechain, with the lines its run changed.
    const finals = sent.filter((body) => body.sidechainId === undefined);
    expect(finals).toEqual([
      {
        type: 'tool-result',
        callId: 'parent-call',
        output: {
          content: 'Fixed the parser',
          details: { runId: 'run-1', state: 'complete', results: [{ sessionFile }], happierDiffStats: { added: 2, removed: 1 } },
        },
        id: 'pi-subagent-parent-call-async-final',
      },
    ]);
  });
});

describe('nested pi-subagents runs', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-subagent-nested-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('mirrors a subagent that the child starts into the sidechain of the child call', async () => {
    const outerFile = join(dir, 'outer.jsonl');
    const innerFile = join(dir, 'inner.jsonl');
    await writeFile(innerFile, line({ type: 'message', id: 'i1', message: { role: 'assistant', content: [{ type: 'text', text: 'Inner work' }] } }));
    await writeFile(outerFile, line({
      type: 'message',
      id: 'o1',
      message: {
        role: 'toolResult',
        toolCallId: 'call_sub',
        toolName: 'subagent',
        content: [{ type: 'text', text: 'done' }],
        details: { mode: 'single', results: [{ agent: 'worker', sessionFile: innerFile }] },
      },
    }));
    const sent: ACPMessageData[] = [];
    const mirror = createPiSubagentSidechainMirror({ send: async (body) => { sent.push(body); } });

    await mirror.observe({ kind: 'sessions', callId: 'parent-call', sessionFiles: [outerFile], final: true });
    await vi.waitFor(() => expect(sent).toContainEqual({ type: 'message', message: 'Inner work', sidechainId: 'sc:parent-call:call_sub' }));
    expect(sent[0]).toMatchObject({ type: 'tool-result', callId: 'sc:parent-call:call_sub', sidechainId: 'parent-call' });
  });
});
