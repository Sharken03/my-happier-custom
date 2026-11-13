import { mkdtempSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import type { Duplex } from 'node:stream';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { resolveHappyToolsBridgeBackendOptions } from './resolveHappyToolsBridgeBackendOptions';
import {
  buildPiBridgeExtensionSource,
  PI_BRIDGE_EXTENSION_VERSION,
} from './piBridgeExtensionSource';
import { PI_BRIDGE_CONFIG_PATH_FLAG, PI_BRIDGE_HOST_TOOLS_FD, PI_BRIDGE_TOKEN_COUNT_MARKER_TYPE } from './piBridgeExtensionEnv';
import { serveToolCalls } from '@/cli/commands/toolsServe';

type ToolDef = {
  name: string;
  parameters: unknown;
  execute: (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
};
type EventHandler = (event: Record<string, unknown>, ctx: unknown) => unknown;

function createFakePi(flags: Readonly<Record<string, unknown>>) {
  const handlers = new Map<string, EventHandler[]>();
  const tools: ToolDef[] = [];
  const registeredFlags: string[] = [];
  return {
    pi: {
      registerFlag: (name: string) => registeredFlags.push(name),
      registerTool: (def: ToolDef) => tools.push(def),
      getFlag: (name: string) => flags[name],
      on: (event: string, handler: EventHandler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    },
    registeredFlags,
    tools,
    emit: async (event: string, value: Record<string, unknown>, ctx?: unknown) => {
      let last: unknown;
      for (const handler of handlers.get(event) ?? []) last = await handler(value, ctx);
      return last;
    },
  };
}

async function loadExtensionFactory(): Promise<(pi: ReturnType<typeof createFakePi>['pi']) => void> {
  const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-ext-'));
  const file = join(dir, 'extension.mjs');
  writeFileSync(file, buildPiBridgeExtensionSource(), 'utf8');
  try {
    const mod = await import(`${pathToFileURL(file).href}?nonce=${Math.random()}`);
    return mod.default as (pi: ReturnType<typeof createFakePi>['pi']) => void;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('buildPiBridgeExtensionSource', () => {
  it('emits a generic self-contained adapter with no provider-owned tool inventory', () => {
    const source = buildPiBridgeExtensionSource();
    expect(source).toContain(`Version: ${PI_BRIDGE_EXTENSION_VERSION}`);
    expect(source).toContain(`"${PI_BRIDGE_CONFIG_PATH_FLAG}"`);
    expect(source).toContain('for (const tool of config.directTools)');
    expect(source).not.toContain('memory_search');
    expect(source).not.toContain('change_title');
    expect(source).not.toMatch(/from ['"]@\//);
    expect(source).not.toMatch(/from ['"]@happier-dev\//);
  });

  it('bridges every manifest tool through the semantic session-Agent call form', () => {
    const source = buildPiBridgeExtensionSource();
    expect(source).toContain('"--session-agent-bridge"');
    expect(source).toContain('"--source", "happier"');
    expect(source).toContain('"--tool", toolName');
    expect(source).toContain('"--args-json", JSON.stringify(args ?? {})');
    expect(source).not.toContain('TOOL_CALL_TIMEOUT_MS');
    expect(source).toContain('BRIDGE_OUTPUT_MAX_BYTES');
  });

  it('keeps context telemetry in the session-bound extension lifecycle', () => {
    const source = buildPiBridgeExtensionSource();
    expect(source).toContain(`"${PI_BRIDGE_TOKEN_COUNT_MARKER_TYPE}"`);
    expect(source).toContain('pi.on("message_end"');
    expect(source).toContain('getContextUsage');
  });

  it('emits syntactically valid JavaScript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-syntax-'));
    try {
      const file = join(dir, 'extension.mjs');
      writeFileSync(file, buildPiBridgeExtensionSource(), 'utf8');
      expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pi bridge extension behavior', () => {
  it('reports each extension input submission without reporting RPC inputs or image-only inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-input-'));
    const notify = vi.fn<(message: string) => void>();
    const ctx = { ui: { notify } };
    try {
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-input',
        directTools: [],
        promptAddition: '',
        launch: { filePath: process.execPath, argPrefix: [], env: {} },
      }));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      await harness.emit('session_start', {});

      await harness.emit('input', { source: 'rpc', text: '/review concurrency' }, ctx);
      await harness.emit('input', { source: 'rpc', text: 'handled by another extension' }, ctx);
      await harness.emit('input', { source: 'interactive', text: 'native input' }, ctx);
      await harness.emit('input', { source: 'extension', text: '', images: [{ type: 'image' }] }, ctx);
      expect(notify).not.toHaveBeenCalled();

      const text = 'handled by another extension\nrepeat';
      await expect(harness.emit('input', { source: 'extension', text }, ctx)).resolves.toBeUndefined();
      await harness.emit('input', { source: 'extension', text }, ctx);
      expect(notify.mock.calls.map(([message]) => JSON.parse(String(message)))).toEqual([
        { type: 'happy-pi-user-input', text },
        { type: 'happy-pi-user-input', text },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers host-generated JSON schemas without Zod runtime metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-schemas-'));
    try {
      const resolved = await resolveHappyToolsBridgeBackendOptions({
        agentDir: dir,
        sessionId: 'sess-schemas',
        settings: null,
        memoryRecallGuidanceEnabled: true,
        memoryMachineId: 'machine-1',
      });
      expect(resolved).not.toBeNull();
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify(resolved!.sessionConfig));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      await harness.emit('session_start', {});

      expect(harness.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['change_title', 'action_execute', 'memory_search']),
      );
      for (const tool of harness.tools) {
        expect(tool.parameters, tool.name).not.toHaveProperty('~standard');
        expect(tool.parameters, tool.name).toMatchObject({ type: 'object' });
      }
      expect(harness.tools.find((tool) => tool.name === 'change_title')?.parameters).toMatchObject({
        properties: { title: { type: 'string' } },
        required: ['title'],
      });
      const memorySchema = harness.tools.find((tool) => tool.name === 'memory_search')?.parameters;
      expect(memorySchema).toMatchObject({ properties: { machineId: { type: 'string' } } });
      expect(memorySchema).not.toHaveProperty('required', expect.arrayContaining(['machineId']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('executes host-resolved tools through the Agent bridge with bounded typed results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-execute-'));
    // The generated extension imports native ESM directly, outside Vitest's module graph.
    const nativeChildProcess = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
    const spawnBoundary = vi.spyOn(nativeChildProcess, 'spawn');
    syncBuiltinESMExports();
    try {
      const argvPath = join(dir, 'argv.json');
      const overflowPidPath = join(dir, 'overflow-pid.txt');
      const executableScript = join(dir, 'fake-happier-cli.cjs');
      writeFileSync(executableScript, `
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
const argsIndex = process.argv.indexOf('--args-json');
const args = JSON.parse(process.argv[argsIndex + 1]);
if (args.input.value === 'fail') {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: 'action_failed', message: 'expected failure' } }) + '\\n');
} else if (args.input.value === 'large') {
  process.stdout.write(JSON.stringify({ ok: true, data: { output: 'x'.repeat(100000) } }) + '\\n');
} else if (args.input.value === 'unicode-large') {
  process.stdout.write(JSON.stringify({ ok: true, data: { output: '😀'.repeat(30000) } }) + '\\n');
} else if (args.input.value === 'transport-overflow') {
  writeFileSync(${JSON.stringify(overflowPidPath)}, String(process.pid));
  process.stdout.write('x'.repeat(2 * 1024 * 1024));
  setInterval(() => {}, 1000);
} else if (args.input.value === 'process-failure') {
  process.stderr.write('deterministic bridge diagnostic');
  process.exitCode = 7;
} else if (args.input.value === 'wait') {
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify({ ok: true, data: { output: { echoed: args } } }) + '\\n');
}
`, 'utf8');
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-execute',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'memory.search' },
        }],
        promptAddition: '',
        launch: {
          filePath: process.execPath,
          argPrefix: [executableScript],
          env: { HAPPIER_TEST_BRIDGE: '1' },
        },
      }));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      await harness.emit('session_start', {});

      await expect(harness.tools[0]!.execute(
        'call-1',
        { value: 'ok' },
        new AbortController().signal,
        undefined,
        { cwd: dir },
      )).resolves.toMatchObject({
        content: [{ type: 'text', text: expect.stringContaining('memory.search') }],
      });
      const invocation = JSON.parse(readFileSync(argvPath, 'utf8')) as { argv: string[]; cwd: string };
      expect(realpathSync(invocation.cwd)).toBe(realpathSync(dir));
      expect(invocation.argv).toEqual(expect.arrayContaining([
        'tools', 'call',
        '--session-id', 'sess-execute',
        '--directory', dir,
        '--source', 'happier',
        '--tool', 'action_execute',
        '--session-agent-bridge',
        '--tool-call-id', 'call-1',
        '--json',
      ]));
      const argsIndex = invocation.argv.indexOf('--args-json');
      expect(JSON.parse(invocation.argv[argsIndex + 1]!)).toEqual({
        actionId: 'memory.search',
        input: { value: 'ok' },
      });

      await expect(harness.tools[0]!.execute(
        'call-2',
        { value: 'fail' },
        new AbortController().signal,
        undefined,
        { cwd: dir },
      )).rejects.toThrow('action_failed');

      const largeResult = await harness.tools[0]!.execute(
        'call-3',
        { value: 'large' },
        new AbortController().signal,
        undefined,
        { cwd: dir },
      ) as { content: Array<{ text: string }>; details?: Record<string, unknown> };
      expect(Buffer.byteLength(largeResult.content[0]!.text, 'utf8')).toBeLessThanOrEqual(50 * 1024);
      expect(largeResult.content[0]!.text).toContain('[Output truncated');
      expect(largeResult.details).not.toHaveProperty('envelope');

      const unicodeLargeResult = await harness.tools[0]!.execute(
        'call-unicode-large',
        { value: 'unicode-large' },
        new AbortController().signal,
        undefined,
        { cwd: dir },
      ) as { content: Array<{ text: string }> };
      expect(unicodeLargeResult.content[0]!.text).not.toContain('�');

      const overflowController = new AbortController();
      const overflowAbortTimer = setTimeout(() => overflowController.abort(), 500);
      try {
        await expect(harness.tools[0]!.execute(
          'call-4',
          { value: 'transport-overflow' },
          overflowController.signal,
          undefined,
          { cwd: dir },
        )).rejects.toThrow('bridge_output_limit');
      } finally {
        clearTimeout(overflowAbortTimer);
      }
      expect(spawnBoundary.mock.calls[0]?.[2]?.windowsHide).toBe(true);
      const overflowPid = Number(readFileSync(overflowPidPath, 'utf8'));
      await expect.poll(() => {
        try {
          process.kill(overflowPid, 0);
          return true;
        } catch {
          return false;
        }
      }).toBe(false);

      const processFailure = harness.tools[0]!.execute(
        'call-process-failure',
        { value: 'process-failure' },
        new AbortController().signal,
        undefined,
        { cwd: dir },
      );
      await expect(processFailure).rejects.toThrow('code=bridge_process_failed');
      await expect(processFailure).rejects.toThrow('code 7');
      await expect(processFailure).rejects.toThrow('deterministic bridge diagnostic');

      const controller = new AbortController();
      const waitingCall = harness.tools[0]!.execute(
        'call-5',
        { value: 'wait' },
        controller.signal,
        undefined,
        { cwd: dir },
      );
      setTimeout(() => controller.abort(), 25);
      await expect(waitingCall).rejects.toThrow('bridge_cancelled');
    } finally {
      spawnBoundary.mockRestore();
      syncBuiltinESMExports();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves every tool call of a session through one long-lived tools serve process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-serve-'));
    try {
      const launchesPath = join(dir, 'launches.log');
      const executableScript = join(dir, 'fake-happier-cli.cjs');
      writeFileSync(executableScript, `
const { appendFileSync } = require('node:fs');
const readline = require('node:readline');
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(launchesPath)}, argv.slice(0, 2).join(' ') + '\\n');
if (argv[0] === 'tools' && argv[1] === 'serve') {
  process.stdout.write('startup noise\\n');
  process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-ready' }) + '\\n');
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    const envelope = request.args.input.value === 'fail'
      ? { ok: false, error: { code: 'action_failed', message: 'expected failure' } }
      : { ok: true, data: { output: { served: request.args, session: argv[argv.indexOf('--session-id') + 1], toolCallId: request.toolCallId } } };
    process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-result', id: request.id, envelope }) + '\\n');
  });
} else {
  process.stdout.write(JSON.stringify({ ok: true, data: { output: 'spawned per call' } }) + '\\n');
}
`, 'utf8');
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-serve',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'memory.search' },
        }],
        promptAddition: '',
        launch: { filePath: process.execPath, argPrefix: [executableScript], env: {} },
      }));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      await harness.emit('session_start', {});

      const call = (id: string, value: string) => harness.tools[0]!.execute(
        id, { value }, new AbortController().signal, undefined, { cwd: dir },
      ) as Promise<{ content: Array<{ text: string }> }>;
      const [first, second] = await Promise.all([call('call-1', 'one'), call('call-2', 'two')]);
      expect(JSON.parse(first.content[0]!.text)).toEqual({
        served: { actionId: 'memory.search', input: { value: 'one' } },
        session: 'sess-serve',
        toolCallId: 'call-1',
      });
      expect(JSON.parse(second.content[0]!.text).served.input).toEqual({ value: 'two' });
      await expect(call('call-3', 'fail')).rejects.toThrow('action_failed');

      expect(readFileSync(launchesPath, 'utf8').trim().split('\n')).toEqual(['tools serve']);
      await harness.emit('session_shutdown', {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts a new tools serve process after one ends, and falls back when one ends during a call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-serve-end-'));
    try {
      const launchesPath = join(dir, 'launches.log');
      const executableScript = join(dir, 'fake-happier-cli.cjs');
      writeFileSync(executableScript, `
const { appendFileSync } = require('node:fs');
const readline = require('node:readline');
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(launchesPath)}, argv.slice(0, 2).join(' ') + '\\n');
if (argv[0] === 'tools' && argv[1] === 'serve') {
  process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-ready' }) + '\\n');
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    if (request.args.input.value === 'die') process.exit(0);
    const envelope = { ok: true, data: { output: 'served ' + request.args.input.value } };
    process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-result', id: request.id, envelope }) + '\\n', () => {
      if (request.args.input.value === 'last') process.exit(0);
    });
  });
} else {
  process.stdout.write(JSON.stringify({ ok: true, data: { output: 'spawned per call' } }) + '\\n');
}
`, 'utf8');
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-serve-end',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'memory.search' },
        }],
        promptAddition: '',
        launch: { filePath: process.execPath, argPrefix: [executableScript], env: {} },
      }));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      await harness.emit('session_start', {});

      const call = async (id: string, value: string) => JSON.parse((await harness.tools[0]!.execute(
        id, { value }, new AbortController().signal, undefined, { cwd: dir },
      ) as { content: Array<{ text: string }> }).content[0]!.text);
      expect(await call('call-1', 'last')).toBe('served last');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await call('call-2', 'again')).toBe('served again');
      expect(await call('call-3', 'die')).toBe('spawned per call');

      expect(readFileSync(launchesPath, 'utf8').trim().split('\n')).toEqual(['tools serve', 'tools serve', 'tools call']);
      await harness.emit('session_shutdown', {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves tool calls through the host pipe named in the config, without a tools serve process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-host-'));
    try {
      const launchesPath = join(dir, 'launches.log');
      const executableScript = join(dir, 'fake-happier-cli.cjs');
      writeFileSync(executableScript, `
require('node:fs').appendFileSync(${JSON.stringify(launchesPath)}, process.argv.slice(2, 4).join(' ') + '\\n');
`, 'utf8');
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-host',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'memory.search' },
        }],
        promptAddition: '',
        launch: { filePath: process.execPath, argPrefix: [executableScript], env: {} },
        hostToolsFd: PI_BRIDGE_HOST_TOOLS_FD,
      }));
      const extensionPath = join(dir, 'extension.mjs');
      writeFileSync(extensionPath, buildPiBridgeExtensionSource(), 'utf8');
      // Pi stand-in: loads the extension in its own process, where fd 3 is the host pipe.
      const piPath = join(dir, 'fake-pi.mjs');
      writeFileSync(piPath, `
const tools = [];
const handlers = new Map();
const pi = {
  registerFlag() {},
  registerTool: (def) => tools.push(def),
  getFlag: (name) => name === ${JSON.stringify(PI_BRIDGE_CONFIG_PATH_FLAG)} ? ${JSON.stringify(configPath)} : undefined,
  on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
};
const emit = async (event, value) => { for (const handler of handlers.get(event) ?? []) await handler(value, {}); };
const extension = (await import(${JSON.stringify(pathToFileURL(extensionPath).href)})).default;
extension(pi);
await emit('session_start', {});
const call = async (id, value) => JSON.parse((await tools[0].execute(id, { value }, new AbortController().signal, undefined, { cwd: process.cwd() })).content[0].text);
const results = await Promise.all([call('call-1', 'one'), call('call-2', 'two')]);
process.stdout.write(JSON.stringify(results) + '\\n');
await emit('session_shutdown', {});
`, 'utf8');

      const child = spawn(process.execPath, [piPath], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
      const channel = child.stdio[PI_BRIDGE_HOST_TOOLS_FD] as Duplex;
      // The pipe resets when the Pi stand-in exits.
      channel.on('error', () => {});
      void serveToolCalls({ sessionId: 'host-session' }, {
        readCredentials: async () => ({ token: 'token' }) as never,
        callBuiltInHappierTool: (async (params: { sessionId: string; args: unknown; toolCallId?: string | null }) => ({
          ok: true as const,
          result: { session: params.sessionId, args: params.args, toolCallId: params.toolCallId },
        })) as never,
        input: channel,
        writeLine: (line) => { channel.write(line + '\n'); },
        idleExitMs: null,
      });
      let stdout = '';
      let stderr = '';
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      const code = await new Promise<number | null>((resolve) => child.once('close', resolve));

      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      expect(JSON.parse(stdout.trim())).toEqual([
        { session: 'host-session', args: { actionId: 'memory.search', input: { value: 'one' } }, toolCallId: 'call-1' },
        { session: 'host-session', args: { actionId: 'memory.search', input: { value: 'two' } }, toolCallId: 'call-2' },
      ]);
      expect(() => readFileSync(launchesPath, 'utf8')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('falls back to a tools serve process when the host pipe stays silent, and says so on stderr', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-host-silent-'));
    try {
      const launchesPath = join(dir, 'launches.log');
      const executableScript = join(dir, 'fake-happier-cli.cjs');
      writeFileSync(executableScript, `
const { appendFileSync } = require('node:fs');
const readline = require('node:readline');
appendFileSync(${JSON.stringify(launchesPath)}, process.argv.slice(2, 4).join(' ') + '\\n');
process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-ready' }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const envelope = { ok: true, data: { output: 'served ' + request.args.input.value } };
  process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-result', id: request.id, envelope }) + '\\n');
});
`, 'utf8');
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-host-silent',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'memory.search' },
        }],
        promptAddition: '',
        launch: { filePath: process.execPath, argPrefix: [executableScript], env: {} },
        hostToolsFd: PI_BRIDGE_HOST_TOOLS_FD,
      }));
      const extensionPath = join(dir, 'extension.mjs');
      writeFileSync(extensionPath, buildPiBridgeExtensionSource(), 'utf8');
      const piPath = join(dir, 'fake-pi.mjs');
      writeFileSync(piPath, `
const tools = [];
const handlers = new Map();
const pi = {
  registerFlag() {},
  registerTool: (def) => tools.push(def),
  getFlag: (name) => name === ${JSON.stringify(PI_BRIDGE_CONFIG_PATH_FLAG)} ? ${JSON.stringify(configPath)} : undefined,
  on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
};
const emit = async (event, value) => { for (const handler of handlers.get(event) ?? []) await handler(value, {}); };
const extension = (await import(${JSON.stringify(pathToFileURL(extensionPath).href)})).default;
extension(pi);
await emit('session_start', {});
const result = await tools[0].execute('call-1', { value: 'one' }, new AbortController().signal, undefined, { cwd: process.cwd() });
process.stdout.write(result.content[0].text + '\\n');
await emit('session_shutdown', {});
process.exit(0);
`, 'utf8');

      // The host keeps the pipe open and never answers on it.
      const child = spawn(process.execPath, [piPath], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
      (child.stdio[PI_BRIDGE_HOST_TOOLS_FD] as Duplex).on('error', () => {});
      let stdout = '';
      let stderr = '';
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      const code = await new Promise<number | null>((resolve) => child.once('close', resolve));

      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())).toBe('served one');
      expect(stderr).toContain('host tool-call pipe unavailable');
      expect(readFileSync(launchesPath, 'utf8').trim().split('\n')).toEqual(['tools serve']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('falls back to a tools serve process when the host pipe cannot be used', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-host-missing-'));
    try {
      const launchesPath = join(dir, 'launches.log');
      const executableScript = join(dir, 'fake-happier-cli.cjs');
      writeFileSync(executableScript, `
const { appendFileSync } = require('node:fs');
const readline = require('node:readline');
appendFileSync(${JSON.stringify(launchesPath)}, process.argv.slice(2, 4).join(' ') + '\\n');
process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-ready' }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const envelope = { ok: true, data: { output: 'served ' + request.args.input.value } };
  process.stdout.write(JSON.stringify({ type: 'happier-tools-serve-result', id: request.id, envelope }) + '\\n');
});
`, 'utf8');
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-host-missing',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'memory.search' },
        }],
        promptAddition: '',
        launch: { filePath: process.execPath, argPrefix: [executableScript], env: {} },
        // No pipe of this number exists in the test process.
        hostToolsFd: 987,
      }));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      await harness.emit('session_start', {});

      const result = await harness.tools[0]!.execute(
        'call-1', { value: 'one' }, new AbortController().signal, undefined, { cwd: dir },
      ) as { content: Array<{ text: string }> };
      expect(JSON.parse(result.content[0]!.text)).toBe('served one');
      expect(readFileSync(launchesPath, 'utf8').trim().split('\n')).toEqual(['tools serve']);
      await harness.emit('session_shutdown', {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers exactly the host-resolved manifest and appends its prompt addition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-config-'));
    try {
      const configPath = join(dir, 'config.json');
      writeFileSync(configPath, JSON.stringify({
        v: 1,
        sessionId: 'sess-1',
        directTools: [{
          name: 'host_resolved_tool',
          title: 'Host resolved tool',
          description: 'Resolved by the canonical catalog',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
          call: { toolName: 'action_execute', actionId: 'session.status.get' },
        }],
        promptAddition: 'HOST_RESOLVED_GUIDANCE',
        launch: { filePath: process.execPath, argPrefix: [], env: {} },
      }));
      const factory = await loadExtensionFactory();
      const harness = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: configPath });
      factory(harness.pi);
      expect(harness.registeredFlags).toEqual([PI_BRIDGE_CONFIG_PATH_FLAG]);
      await harness.emit('session_start', {});

      expect(harness.tools.map((tool) => tool.name)).toEqual(['host_resolved_tool']);
      expect(harness.tools[0]?.parameters).toEqual(expect.objectContaining({ required: ['value'] }));
      await expect(harness.emit('before_agent_start', { systemPrompt: 'PI_BASE' })).resolves.toEqual({
        systemPrompt: 'PI_BASE\n\nHOST_RESOLVED_GUIDANCE',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends the session title reminder once as a hidden message, and not after a title call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-pi-bridge-config-'));
    try {
      const writeConfig = (name: string): string => {
        const configPath = join(dir, name);
        writeFileSync(configPath, JSON.stringify({
          v: 1,
          sessionId: 'sess-1',
          directTools: [{
            name: 'change_title',
            title: 'Change Chat Title',
            description: 'Change the title of the current chat session',
            inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
            call: { toolName: 'change_title', actionId: null },
          }],
          promptAddition: '',
          sessionTitleReminder: { text: 'SET_A_TITLE', toolName: 'change_title' },
          launch: { filePath: process.execPath, argPrefix: [], env: {} },
        }));
        return configPath;
      };
      const factory = await loadExtensionFactory();

      const reminded = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: writeConfig('reminded.json') });
      factory(reminded.pi);
      await reminded.emit('session_start', {});
      // A run that a custom message starts has no user message to title.
      await expect(reminded.emit('before_agent_start', { systemPrompt: 'PI_BASE', messageType: 'custom' }))
        .resolves.toBeUndefined();
      await expect(reminded.emit('before_agent_start', { systemPrompt: 'PI_BASE', messageType: 'user' })).resolves.toEqual({
        message: { customType: 'happier-session-title-reminder', content: 'SET_A_TITLE', display: false },
      });
      await expect(reminded.emit('before_agent_start', { systemPrompt: 'PI_BASE', messageType: 'user' }))
        .resolves.toBeUndefined();

      const titled = createFakePi({ [PI_BRIDGE_CONFIG_PATH_FLAG]: writeConfig('titled.json') });
      factory(titled.pi);
      await titled.emit('session_start', {});
      await titled.tools[0]?.execute('call-1', { title: 'Title' }, new AbortController().signal, undefined, { cwd: dir })
        .catch(() => undefined);
      await expect(titled.emit('before_agent_start', { systemPrompt: 'PI_BASE', messageType: 'user' }))
        .resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stays inert without a valid protected config binding', async () => {
    const factory = await loadExtensionFactory();
    const harness = createFakePi({});
    factory(harness.pi);
    await harness.emit('session_start', {});
    expect(harness.tools).toEqual([]);
    await expect(harness.emit('before_agent_start', { systemPrompt: 'PI_BASE' })).resolves.toBeUndefined();
  });
});
