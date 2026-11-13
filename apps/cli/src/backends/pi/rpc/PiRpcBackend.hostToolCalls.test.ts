import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { serveToolCalls } from '@/cli/commands/toolsServe';

import { PiRpcBackend } from './PiRpcBackend';

// A Pi stand-in that answers RPC on stdin/stdout and, like the bridge extension, calls one
// Happier tool through the host channel on fd 3. It records what the host answered.
function writeFakePi(dir: string, reportPath: string): string {
  const script = join(dir, 'fake-pi-host-tools.js');
  writeFileSync(script, `
const fs = require('node:fs');
const net = require('node:net');
const readline = require('node:readline');
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  const base = { id: command.id, type: 'response', command: command.type, success: true };
  if (command.type === 'get_state') return out({ ...base, data: { sessionId: 'pi-host-tools', model: { id: 'm', provider: 'p' } } });
  if (command.type === 'get_available_models') return out({ ...base, data: { models: [] } });
  if (command.type === 'get_commands') return out({ ...base, data: { commands: [] } });
  out({ ...base, data: {} });
});
let channel;
try { channel = new net.Socket({ fd: 3, readable: true, writable: true }); } catch (error) {
  fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ noChannel: String(error && error.message) }));
}
if (channel) {
  const lines = [];
  readline.createInterface({ input: channel }).on('line', (line) => {
    const message = JSON.parse(line);
    lines.push(message);
    if (message.type === 'happier-tools-serve-ready') {
      channel.write(JSON.stringify({ type: 'happier-tools-serve-call', id: 7, tool: 'action_execute', args: { a: 1 }, toolCallId: 'call-7' }) + '\\n');
    } else {
      fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(lines));
    }
  });
}
`);
  return script;
}

describe('PiRpcBackend host tool calls', () => {
  const backends: PiRpcBackend[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.dispose()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('answers Pi tool calls on a host channel with the tools serve protocol', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-host-tools-'));
    dirs.push(dir);
    const reportPath = join(dir, 'report.json');
    const callBuiltInHappierTool = vi.fn(async (params: { sessionId: string; toolName: string; args: unknown; toolCallId?: string | null }) => ({
      ok: true as const,
      result: { session: params.sessionId, tool: params.toolName, args: params.args, toolCallId: params.toolCallId },
    }));
    const backend = new PiRpcBackend({
      cwd: dir,
      command: process.execPath,
      args: [writeFakePi(dir, reportPath)],
      env: { PI_CODING_AGENT_DIR: dir },
      serveHostToolCalls: (channel) => {
        void serveToolCalls({ sessionId: 'happier-session' }, {
          readCredentials: async () => ({ token: 'token' }) as never,
          callBuiltInHappierTool: callBuiltInHappierTool as never,
          input: channel.input,
          writeLine: channel.writeLine,
          idleExitMs: null,
        });
      },
    });
    backends.push(backend);

    await backend.startSession();
    await vi.waitFor(() => expect(() => readFileSync(reportPath, 'utf8')).not.toThrow(), { timeout: 10_000 });

    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual([
      { type: 'happier-tools-serve-ready' },
      {
        type: 'happier-tools-serve-result',
        id: 7,
        envelope: {
          ok: true,
          kind: 'tools_call',
          data: {
            source: 'happier',
            tool: 'action_execute',
            isError: false,
            output: { session: 'happier-session', tool: 'action_execute', args: { a: 1 }, toolCallId: 'call-7' },
          },
        },
      },
    ]);
  }, 20_000);

  it('closes the host pipe at once when the host cannot serve, and keeps the session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-host-tools-fail-'));
    dirs.push(dir);
    const reportPath = join(dir, 'report.json');
    const script = join(dir, 'fake-pi-host-closed.js');
    writeFileSync(script, `
const fs = require('node:fs');
const net = require('node:net');
const readline = require('node:readline');
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  const base = { id: command.id, type: 'response', command: command.type, success: true };
  if (command.type === 'get_state') return out({ ...base, data: { sessionId: 'pi-host-closed', model: { id: 'm', provider: 'p' } } });
  out({ ...base, data: command.type === 'get_available_models' ? { models: [] } : command.type === 'get_commands' ? { commands: [] } : {} });
});
const channel = new net.Socket({ fd: 3, readable: true, writable: true });
let data = '';
channel.on('data', (chunk) => { data += chunk; });
channel.on('error', () => {});
channel.on('close', () => fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ closed: true, data })));
`);
    const backend = new PiRpcBackend({
      cwd: dir,
      command: process.execPath,
      args: [script],
      env: { PI_CODING_AGENT_DIR: dir },
      serveHostToolCalls: () => {
        throw new Error('host tool calls unavailable');
      },
    });
    backends.push(backend);

    await expect(backend.startSession()).resolves.toEqual({ sessionId: 'pi-host-closed' });
    await vi.waitFor(() => expect(() => readFileSync(reportPath, 'utf8')).not.toThrow(), { timeout: 3_000 });
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({ closed: true, data: '' });
  }, 20_000);
});
