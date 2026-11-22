import { afterEach, describe, expect, it } from 'vitest';

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isDefinitiveSessionControlApplyError } from '@/agent/runtime/sessionControlApplyError';
import { PiRpcBackend } from './PiRpcBackend';

// A Pi process that knows one model and answers set_model for any other with an error response.
function writeFakePiScript(dir: string): string {
  const scriptPath = join(dir, 'fake-pi-rpc-set-model.js');
  writeFileSync(scriptPath, `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
let model = { id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4' };
rl.on('line', (line) => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command.type === 'get_state') {
    out({ id: command.id, type: 'response', command: 'get_state', success: true, data: { sessionId: 'pi-session-set-model', thinkingLevel: 'medium', model } });
  } else if (command.type === 'get_available_models') {
    out({ id: command.id, type: 'response', command: 'get_available_models', success: true, data: { models: [model] } });
  } else if (command.type === 'set_model') {
    if (command.provider === 'openai' && command.modelId === 'gpt-5.4') {
      out({ id: command.id, type: 'response', command: 'set_model', success: true, data: model });
    } else {
      out({ id: command.id, type: 'response', command: 'set_model', success: false, error: 'Model not found: ' + command.provider + '/' + command.modelId });
    }
  } else {
    out({ id: command.id, type: 'response', command: command.type, success: true, data: command.type === 'get_commands' ? { commands: [] } : { cancelled: false } });
  }
});
`, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe('PiRpcBackend set_model', () => {
  let tempDir: string | null = null;
  let backend: PiRpcBackend | null = null;

  afterEach(async () => {
    if (backend) { await backend.dispose(); backend = null; }
    if (tempDir) { rmSync(tempDir, { recursive: true, force: true }); tempDir = null; }
  });

  it('reports a model that Pi rejects as a definitive control failure', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'happier-pi-rpc-set-model-'));
    backend = new PiRpcBackend({ cwd: tempDir, command: process.execPath, args: [writeFakePiScript(tempDir)] });
    const { sessionId } = await backend.startSession();

    await expect(backend.setSessionModel(sessionId, 'openai/gpt-5.4')).resolves.toBeUndefined();

    const rejection = await backend.setSessionModel(sessionId, 'nvidia/nemotron-unknown').catch((error: unknown) => error);
    expect(isDefinitiveSessionControlApplyError(rejection)).toBe(true);
    expect((rejection as Error).message).toContain('Model not found');
  });
});
