import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
      .toEqual({ callId: 'parent-call', sessionFiles: ['/tmp/s/session.jsonl'], final: false });
    expect(readPiSubagentSessionObservation({
      type: 'tool_execution_end',
      toolCallId: 'parent-call',
      toolName: 'subagent',
      result: { details: { results: [{ sessionFile: '/tmp/s/session.jsonl' }] } },
    })).toEqual({ callId: 'parent-call', sessionFiles: ['/tmp/s/session.jsonl'], final: true });
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
