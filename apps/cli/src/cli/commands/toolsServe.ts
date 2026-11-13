import { createInterface } from 'node:readline';

import type { Credentials } from '@/persistence';
import type { callBuiltInHappierTool } from '@/agent/tools/happierTools/callBuiltInHappierTool';
import { mapUnknownErrorToControlError } from '@/cli/control/controlErrorMapping';

// Line protocol between the Pi tools-bridge extension and `happier tools serve`.
// One JSON object per line. The extension ignores stdout lines without these types.
export const TOOLS_SERVE_READY_TYPE = 'happier-tools-serve-ready';
export const TOOLS_SERVE_REQUEST_TYPE = 'happier-tools-serve-call';
export const TOOLS_SERVE_RESULT_TYPE = 'happier-tools-serve-result';
export const TOOLS_SERVE_RESULT_MAX_BYTES = 1024 * 1024;
// An idle serve process still holds about 150 MB on a phone, so it ends after this time without
// calls. The extension starts a new one for the next call.
export const TOOLS_SERVE_IDLE_EXIT_MS = 10 * 60 * 1000;

type Envelope = Readonly<Record<string, unknown> & { ok: boolean }>;

export type ToolsServeDeps = Readonly<{
  readCredentials: () => Promise<Credentials | null>;
  callBuiltInHappierTool: typeof callBuiltInHappierTool;
  input?: NodeJS.ReadableStream;
  writeLine?: (line: string) => void;
  /** Time without calls before the server ends; null keeps it until its input closes. */
  idleExitMs?: number | null;
}>;

function errorEnvelope(code: string, message?: string, candidates?: readonly string[]): Envelope {
  return {
    ok: false,
    kind: 'tools_call',
    error: {
      code,
      ...(message ? { message } : {}),
      ...(candidates && candidates.length > 0 ? { candidates: [...candidates] } : {}),
    },
  };
}

async function runCall(
  sessionId: string,
  request: Readonly<{ tool: string; args: unknown; toolCallId: string }>,
  deps: ToolsServeDeps,
): Promise<Envelope> {
  try {
    const credentials = await deps.readCredentials();
    if (!credentials) return errorEnvelope('not_authenticated', 'Not authenticated. Run "happier auth login" first.');
    const result = await deps.callBuiltInHappierTool({
      credentials,
      sessionId,
      toolName: request.tool,
      args: request.args,
      invocation: 'session_agent_bridge',
      ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    });
    if (result.ok) {
      return {
        ok: true,
        kind: 'tools_call',
        data: { source: 'happier', tool: request.tool, isError: false, output: result.result },
      };
    }
    const candidates = 'candidates' in result && Array.isArray(result.candidates) ? result.candidates : undefined;
    return errorEnvelope(result.errorCode, result.error, candidates);
  } catch (error) {
    const mapped = mapUnknownErrorToControlError(error);
    return errorEnvelope(mapped.code, mapped.message);
  }
}

function parseRequest(line: string): { id: number; tool: string; args: unknown; toolCallId: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  if (value.type !== TOOLS_SERVE_REQUEST_TYPE) return null;
  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id)) return null;
  if (typeof value.tool !== 'string' || !value.tool.trim()) return null;
  return {
    id: value.id,
    tool: value.tool.trim(),
    args: value.args ?? {},
    toolCallId: typeof value.toolCallId === 'string' ? value.toolCallId.trim() : '',
  };
}

/**
 * Runs built-in Happier tool calls for one session in a single long-lived process.
 * Each `tools call` process pays the full CLI start-up (about 3 s on a phone); this
 * process pays it once. It ends when its parent (the Pi process) closes stdin, or after
 * idleExitMs without calls.
 */
export async function serveToolCalls(
  params: Readonly<{ sessionId: string }>,
  deps: ToolsServeDeps,
): Promise<void> {
  const writeLine = deps.writeLine ?? ((line: string) => { process.stdout.write(line + '\n'); });
  const input = deps.input ?? process.stdin;
  let pending = 0;
  let closed = false;

  await new Promise<void>((resolve) => {
    const reader = createInterface({ input, crlfDelay: Infinity });
    let finished = false;
    let idleTimer: NodeJS.Timeout | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (idleTimer) clearTimeout(idleTimer);
      reader.close();
      resolve();
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      const idleExitMs = deps.idleExitMs === undefined ? TOOLS_SERVE_IDLE_EXIT_MS : deps.idleExitMs;
      idleTimer = pending === 0 && idleExitMs !== null ? setTimeout(finish, idleExitMs) : null;
    };

    reader.on('line', (line) => {
      const request = parseRequest(line.trim());
      if (!request) return;
      pending += 1;
      armIdle();
      void runCall(params.sessionId, request, deps).then((envelope) => {
        let text = JSON.stringify({ type: TOOLS_SERVE_RESULT_TYPE, id: request.id, envelope });
        if (Buffer.byteLength(text, 'utf8') > TOOLS_SERVE_RESULT_MAX_BYTES) {
          text = JSON.stringify({
            type: TOOLS_SERVE_RESULT_TYPE,
            id: request.id,
            envelope: errorEnvelope('bridge_output_limit', 'Happier tools bridge output exceeded its bounded transport limit'),
          });
        }
        writeLine(text);
      }).finally(() => {
        pending -= 1;
        if (closed && pending === 0) finish();
        else armIdle();
      });
    });
    reader.on('close', () => {
      closed = true;
      if (pending === 0) finish();
    });

    writeLine(JSON.stringify({ type: TOOLS_SERVE_READY_TYPE }));
    armIdle();
  });
}
