import { describe, expect, it, vi } from 'vitest';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { AcpBackend } from '@/agent/acp/AcpBackend';
import type { ToolPattern, TransportHandler } from '@/agent/transport/TransportHandler';

import { createTestAcpRuntime as createAcpRuntime } from '@/testkit/backends/acpRuntime';
import { createApprovedPermissionHandler } from '@/testkit/backends/permissionHandler';

function writeSteerableAcpAgentScript(params: { dir: string }): string {
  const scriptPath = join(params.dir, 'fake-acp-agent-steer.mjs');
  const src = `
    const decoder = new TextDecoder();
    let buf = '';

    let promptCount = 0;
    let primary = '';
    let steer = '';

    function send(obj) {
      process.stdout.write(JSON.stringify(obj) + '\\n');
    }

    function ok(id, result) {
      send({ jsonrpc: '2.0', id, result });
    }

    function emitMessage(text) {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'test-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text },
          },
        },
      });
    }

    process.stdin.on('data', (chunk) => {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let req;
        try { req = JSON.parse(trimmed); } catch { continue; }
        if (!req || typeof req !== 'object') continue;
        const id = req.id;
        const method = req.method;
        if (id === undefined || id === null || typeof method !== 'string') continue;

        if (method === 'initialize') {
          ok(id, { protocolVersion: 1, authMethods: [] });
          continue;
        }

        if (method === 'session/new') {
          ok(id, { sessionId: 'test-session' });
          continue;
        }

        if (method === 'session/prompt') {
          ok(id, {});

          const blocks = req?.params?.prompt;
          const text = Array.isArray(blocks) && blocks[0] && typeof blocks[0].text === 'string' ? blocks[0].text : '';
          if (promptCount === 0) {
            primary = text;
            // Hold the response open long enough for a steer to arrive.
            setTimeout(() => {
              emitMessage('primary=' + primary + '; steer=' + steer);
            }, 120);
          } else {
            steer = text;
          }
          promptCount++;
          continue;
        }

        ok(id, {});
      }
    });
  `;

  writeFileSync(scriptPath, src, 'utf8');
  return scriptPath;
}

/**
 * Ends the running prompt when a second one arrives and goes on under the second. It waits for a
 * permission answer before its final text, so a handover that aborts the open request shows up.
 */
function writePromptHandoffAcpAgentScript(params: { dir: string }): string {
  const scriptPath = join(params.dir, 'fake-acp-agent-handoff.mjs');
  writeFileSync(scriptPath, `
    import readline from 'node:readline';
    const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
    const update = (update) => send({ method: 'session/update', params: { sessionId: 'test-session', update } });
    const text = (text) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
    const prompts = [];
    let open = null;
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const message = JSON.parse(line);
      if (message.id === 'permission-1') {
        const outcome = message.result.outcome;
        text('prompts=' + prompts.join('|') + '; permission=' + outcome.outcome);
        send({ id: open, result: { stopReason: 'end_turn' } });
        return;
      }
      if (message.id === undefined) return;
      if (message.method === 'initialize') return send({ id: message.id, result: { protocolVersion: 1, authMethods: [] } });
      if (message.method === 'session/new') return send({ id: message.id, result: { sessionId: 'test-session' } });
      if (message.method !== 'session/prompt') return send({ id: message.id, result: {} });
      prompts.push(message.params.prompt[0].text);
      if (open !== null) send({ id: open, result: { stopReason: 'end_turn' } });
      open = message.id;
      if (prompts.length === 1) send({
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId: 'test-session',
          toolCall: { toolCallId: 'tool-1', title: 'sleep 5', kind: 'execute', status: 'pending', rawInput: { command: 'sleep 5' } },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
    });
  `, 'utf8');
  return scriptPath;
}

describe('createAcpRuntime (in-flight steer, real process)', () => {
  it('keeps one turn, its permission request and its text through two steers by prompt handoff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-acp-handoff-proc-'));
    let answerPermission!: () => void;
    const permissionAnswer = new Promise<void>((resolve) => { answerPermission = resolve; });
    const permissionHandler = {
      handleToolCall: vi.fn(async () => {
        await permissionAnswer;
        return { decision: 'approved' as const };
      }),
    };
    const backend = new AcpBackend({
      agentName: 'test',
      cwd: dir,
      command: process.execPath,
      args: [writePromptHandoffAcpAgentScript({ dir })],
      steerByPromptHandoff: true,
      permissionHandler,
      transportHandler: {
        agentName: 'test',
        getInitTimeout: () => 5_000,
        getToolPatterns: () => [] as ToolPattern[],
        getIdleTimeout: () => 50,
      } satisfies TransportHandler,
    });
    const texts = new Map<string, string>();
    const session = {
      keepAlive: () => {},
      sendAgentMessage: () => {},
      sendAgentMessageCommitted: async (_provider: string, msg: any, options: any) => {
        if (msg.type === 'message') texts.set(options.localId, msg.message);
      },
      sendUserTextMessageCommitted: async () => {},
      fetchRecentTranscriptTextItemsForAcpImport: async () => [],
      updateMetadata: () => {},
    } as any;

    try {
      const runtime = createAcpRuntime({
        provider: 'agy',
        directory: dir,
        session,
        messageBuffer: new MessageBuffer(),
        mcpServers: {},
        permissionHandler,
        onThinkingChange: () => {},
        ensureBackend: async () => backend as any,
        inFlightSteer: { enabled: true },
      } as any);
      const accepted: string[] = [];

      runtime.beginTurn();
      await runtime.startOrLoad({});
      expect(runtime.supportsInFlightSteer()).toBe(false);
      let turnEnded = false;
      const turn = runtime.sendPrompt('first').then(() => { turnEnded = true; });
      await vi.waitFor(() => expect(permissionHandler.handleToolCall).toHaveBeenCalledOnce());
      expect(runtime.supportsInFlightSteer()).toBe(true);

      for (const steer of ['second', 'third']) {
        await runtime.steerPrompt(steer, { localId: steer, onProviderPromptAccepted: () => accepted.push(steer) });
        await vi.waitFor(() => expect(accepted).toContain(steer));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(turnEnded).toBe(false);
      expect(runtime.isTurnInFlight()).toBe(true);

      answerPermission();
      await turn;
      await runtime.flushTurn();
      await vi.waitFor(() => {
        expect([...texts.values()]).toEqual(['prompts=first|second|third; permission=selected']);
      });
      expect(accepted).toEqual(['second', 'third']);
    } finally {
      await backend.dispose().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it('routes an exact steer ACK through the typed singleton outcome bridge without broad settlement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happier-acp-steer-proc-'));
    const scriptPath = writeSteerableAcpAgentScript({ dir });

    const backend = new AcpBackend({
      agentName: 'test',
      cwd: dir,
      command: process.execPath,
      args: [scriptPath],
	      transportHandler: {
	        agentName: 'test',
	        getInitTimeout: () => 1_000,
	        getToolPatterns: () => [] as ToolPattern[],
	        // Keep the prompt "in flight" long enough for the chunk to arrive before the backend's
	        // post-prompt "no updates" idle fallback fires.
	        getIdleTimeout: () => 250,
	      } satisfies TransportHandler,
	    });

    const sent: Array<{ type: string; [k: string]: unknown }> = [];
    const session = {
      keepAlive: () => {},
      sendAgentMessage: () => {},
      sendAgentMessageCommitted: async (_provider: string, msg: any) => {
        sent.push(msg);
      },
      sendUserTextMessageCommitted: async () => {},
      fetchRecentTranscriptTextItemsForAcpImport: async () => [],
      updateMetadata: () => {},
    } as any;

    try {
      const waitForMessage = async (): Promise<{ type: string; [k: string]: unknown } | null> => {
        const deadlineMs = Date.now() + 2_000;
        while (Date.now() < deadlineMs) {
          const found = sent.find((m) => m.type === 'message' && typeof (m as any)?.message === 'string');
          if (found) return found;
          await new Promise((r) => setTimeout(r, 10));
        }
        return null;
      };

      const runtime = createAcpRuntime({
        provider: 'codex',
        directory: dir,
        session,
        messageBuffer: new MessageBuffer(),
        mcpServers: {},
        permissionHandler: createApprovedPermissionHandler(),
        onThinkingChange: () => {},
        ensureBackend: async () => backend as any,
        inFlightSteer: { enabled: true },
      } as any);

      runtime.beginTurn();
      await (runtime as any).startOrLoad({});

      const primaryPromise = (runtime as any).sendPrompt('hello');
      await new Promise((r) => setTimeout(r, 10));

      await (runtime as any).steerPrompt('steer-now', {
        localId: 'local-steer-1',
        userMessageSeq: 41,
      });
      await primaryPromise;
      await runtime.flushTurn();

      const message = await waitForMessage();
      expect(message).not.toBeNull();
      expect((message as any)?.message).toContain('primary=hello');
      expect((message as any)?.message).toContain('steer=steer-now');
    } finally {
      await backend.dispose().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
