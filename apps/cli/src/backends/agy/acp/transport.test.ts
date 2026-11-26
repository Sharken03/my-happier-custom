import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/agent/core';
import { writeAcpTestAgentScript } from '@/agent/acp/testkit/subprocessHarness';
import { withTempDir } from '@/testkit/fs/tempDir';

import { createAgyAcpBackend } from './backend';
import { AGY_READ_MAX_LINES, formatAgyCommandOutput, readAgyFileRange } from './transport';

// Tool updates as `agy acp` 1.5.17 sends them (captured 26/11-2026), trimmed to the fields that matter.
function agyUpdates(filePath: string): unknown[] {
  const read = { name: 'read_file', args: { Path: filePath, StartLine: 2, EndLine: 3 }, kind: 'read', title: 'File a.txt',
    locations: [{ path: filePath }], rawInput: { Path: filePath, StartLine: 2, EndLine: 3 } };
  const edit = { name: 'edit_file', args: { Path: filePath, Target: 'line two', Replacement: 'line 2' }, kind: 'edit', title: 'File a.txt',
    locations: [{ path: filePath }], rawInput: { Path: filePath, Target: 'line two', Replacement: 'line 2' } };
  const bash = { name: 'run_command', args: { CommandLine: 'wc -l a.txt', WaitMsBeforeAsync: 5000, toolSummary: 'Count lines' },
    kind: 'execute', title: 'wc -l a.txt', rawInput: { CommandLine: 'wc -l a.txt', WaitMsBeforeAsync: 5000, toolSummary: 'Count lines' } };
  const steps = { name: 'update_steps', kind: 'other', title: 'Run update_steps',
    rawInput: { steps: [{ status: 'done', title: 'Read code' }, { status: 'in_progress', title: 'Fix it' }] } };
  const bashOutput = 'Created At: 2026-11-26T02:47:19+01:00\nCompleted At: 2026-11-26T02:47:19+01:00\nCommand exited with code 0.\n\nCommand output:\n3 a.txt\r\n';
  return [
    { sessionUpdate: 'tool_call', toolCallId: 'c1', status: 'in_progress', ...read },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', ...read },
    { sessionUpdate: 'tool_call', toolCallId: 'c2', status: 'in_progress', ...edit },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'completed', ...edit, rawOutput: {},
      content: [{ type: 'diff', path: filePath, oldText: 'line one\nline two\nfoo\n', newText: 'line one\nline 2\nfoo\n' }] },
    { sessionUpdate: 'tool_call', toolCallId: 'c3', status: 'in_progress', ...bash },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c3', status: 'completed', ...bash,
      content: [{ type: 'content', content: { type: 'text', text: bashOutput } }], rawOutput: { output: bashOutput, exit_code: 0 } },
    { sessionUpdate: 'tool_call', toolCallId: 'c4', status: 'in_progress', ...steps },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c4', status: 'completed', ...steps },
  ];
}

function writeFakeAgy(dir: string, updates: unknown[]): string {
  return writeAcpTestAgentScript({ dir, fileName: 'fake-agy.cjs', source: `
    const readline = require('node:readline');
    const updates = ${JSON.stringify(updates)};
    const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const req = JSON.parse(line);
      if (req.id === undefined || typeof req.method !== 'string') return;
      if (req.method === 'session/prompt') {
        for (const update of updates) send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update } });
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } } } });
        send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } });
        return;
      }
      const result = req.method === 'initialize' ? { protocolVersion: 1, authMethods: [] } : req.method === 'session/new' ? { sessionId: 's' } : {};
      send({ jsonrpc: '2.0', id: req.id, result });
    });
  ` });
}

describe('agy ACP tool updates', () => {
  it('reach the session in the shape of Pi tool calls', async () => {
    await withTempDir('agy-tool-shape-', async (dir) => {
      const filePath = join(dir, 'a.txt');
      writeFileSync(filePath, 'line one\nline two\nfoo\n');
      const backend = createAgyAcpBackend({ cwd: dir, launch: { command: process.execPath, args: [writeFakeAgy(dir, agyUpdates(filePath))] } });
      const messages: AgentMessage[] = [];
      backend.onMessage((message) => messages.push(message));
      try {
        const { sessionId } = await backend.startSession();
        await backend.sendPrompt(sessionId, 'go');
        await backend.waitForResponseComplete?.(5_000);
      } finally {
        await backend.dispose();
      }
      const calls = new Map<string, { toolName: string; args: Record<string, unknown> }>();
      const results = new Map<string, unknown>();
      for (const message of messages) {
        if (message.type === 'tool-call') calls.set(message.callId, { toolName: message.toolName, args: message.args });
        if (message.type === 'tool-result') results.set(message.callId, message.result);
      }

      expect(calls.get('c1')).toMatchObject({ toolName: 'read', args: { path: filePath, offset: 2, limit: 2 } });
      expect(results.get('c1')).toMatchObject({ content: [{ type: 'text', text: 'line two\nfoo' }] });

      expect(calls.get('c2')).toMatchObject({ toolName: 'edit', args: { path: filePath, edits: [{ oldText: 'line two', newText: 'line 2' }] } });
      expect(results.get('c2')).toMatchObject({ content: [{ type: 'text', text: `Successfully replaced 1 block(s) in ${filePath}.` }] });

      expect(calls.get('c3')).toMatchObject({ toolName: 'bash', args: { command: 'wc -l a.txt', description: 'Count lines' } });
      expect(results.get('c3')).toMatchObject({ content: [{ type: 'text', text: '3 a.txt' }] });

      expect(calls.get('c4')).toMatchObject({ toolName: 'TodoWrite', args: { todos: [
        { content: 'Read code', status: 'completed' }, { content: 'Fix it', status: 'in_progress' },
      ] } });
    });
  }, 15_000);

  it('cuts a long read like Pi and says where to continue', () => {
    const body = Array.from({ length: AGY_READ_MAX_LINES + 5 }, (_, index) => `l${index + 1}`).join('\n');
    const text = readAgyFileRange({ path: 'x', offset: null, limit: null }, () => body);
    expect(text.endsWith(`[Showing lines 1-${AGY_READ_MAX_LINES} of ${AGY_READ_MAX_LINES + 5}. Use offset=${AGY_READ_MAX_LINES + 1} to continue.]`)).toBe(true);
  });

  it('keeps a failed command exit code in the output text', () => {
    const output = 'Created At: x\nCompleted At: y\nCommand exited with code 2.\n\nCommand output:\nno such file\r\n';
    expect(formatAgyCommandOutput({ output, exit_code: 2 })).toBe('no such file\n\nCommand exited with code 2');
  });
});
