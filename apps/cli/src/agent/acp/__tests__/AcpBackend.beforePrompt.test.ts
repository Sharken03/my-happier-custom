import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AcpBackend } from '../AcpBackend';
import { createAcpTestTransportHandler, writeAcpTestAgentScript } from '../testkit/subprocessHarness';
import { withTempDir } from '@/testkit/fs/tempDir';

// A genuine ACP agent process that records the order of the methods it receives.
function writeRecordingAgent(dir: string): string {
  return writeAcpTestAgentScript({
    dir,
    fileName: 'fake-acp-agent-recording.mjs',
    source: `
      import { appendFileSync } from 'node:fs';
      const log = ${JSON.stringify(join(dir, 'methods.log'))};
      const decoder = new TextDecoder();
      let buf = '';
      const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
      process.stdin.on('data', (chunk) => {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split('\\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          let req;
          try { req = JSON.parse(line); } catch { continue; }
          if (!req || req.id === undefined || typeof req.method !== 'string') continue;
          appendFileSync(log, req.method + (req.params?.modelId ? ' ' + req.params.modelId : '') + '\\n');
          if (req.method === 'initialize') { send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: 1, authMethods: [] } }); continue; }
          if (req.method === 'session/new') {
            send({ jsonrpc: '2.0', id: req.id, result: { sessionId: 'test-session', models: {
              currentModelId: 'gemini-x',
              availableModels: [{ modelId: 'gemini-x', name: 'Gemini X' }, { modelId: 'claude-y', name: 'Claude Y' }],
            } } });
            continue;
          }
          if (req.method === 'session/prompt') { send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } }); continue; }
          send({ jsonrpc: '2.0', id: req.id, result: {} });
        }
      });
    `,
  });
}

describe('AcpBackend beforePrompt', () => {
  it('lets the provider switch the model and post a status line before the prompt is sent', async () => {
    await withTempDir('happier-acp-before-prompt-', async (dir) => {
      const seenModels: Array<string | null> = [];
      const backend = new AcpBackend({
        agentName: 'test',
        cwd: dir,
        command: process.execPath,
        args: [writeRecordingAgent(dir)],
        transportHandler: createAcpTestTransportHandler({ idleTimeoutMs: 1 }),
        beforePrompt: async ({ modelState, setModel, notify }) => {
          seenModels.push(modelState?.currentModelId ?? null);
          await setModel('claude-y');
          notify('Switched to Claude Y.');
        },
      });
      const notices: string[] = [];
      backend.onMessage((message) => {
        if (message.type === 'event' && message.name === 'message') {
          notices.push(String((message.payload as { message?: unknown } | undefined)?.message));
        }
      });
      try {
        const started = await backend.startSession();
        await backend.sendPrompt(started.sessionId, 'hi');
        await backend.waitForResponseComplete(5_000);
        const methods = (await readFile(join(dir, 'methods.log'), 'utf8')).trim().split('\n');
        expect(methods.slice(-2)).toEqual(['session/set_model claude-y', 'session/prompt']);
        expect(seenModels).toEqual(['gemini-x']);
        expect(notices).toEqual(['Switched to Claude Y.']);
        expect(backend.getSessionModelState()?.currentModelId).toBe('claude-y');
      } finally {
        await backend.dispose();
      }
    });
  }, 20_000);
});
