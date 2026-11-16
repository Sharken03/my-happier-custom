import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { ACPMessageData } from '@/api/session/sessionMessageTypes';

/**
 * Mirrors the child sessions of the `pi-subagents` `subagent` tool into a Happier sidechain.
 *
 * `pi-subagents` runs each subagent as a separate `pi` process. The parent RPC stream carries only
 * snapshots of its progress, so the child's own messages never reach Happier and the subagent
 * transcript stays empty. Every snapshot names the child's session file
 * (`details.results[].sessionFile`). The mirror reads the new lines of that JSONL file and sends
 * each message block as a sidechain message, keyed by the parent tool call id. The app resolves
 * the sidechain of a subagent tool call by that id.
 */

const PI_SUBAGENT_TOOL_NAME = 'subagent';
const PI_BG_WAIT_TOOL_NAME = 'bg_wait';
/** States of an async run that still change; `pi-subagents` writes any other state once, at the end. */
const PI_ASYNC_LIVE_STATES = new Set(['queued', 'running', 'paused']);
const DEFAULT_ASYNC_STATUS_POLL_MS = 1000;
/** Upper bound on one read, so a huge child session cannot stall the RPC event loop. */
const MAX_READ_BYTES_PER_PASS = 4 * 1024 * 1024;

export type PiSubagentSessionObservation =
  /** A foreground run: the update or end event names the child session files. */
  | Readonly<{ kind: 'sessions'; callId: string; sessionFiles: readonly string[]; final: boolean }>
  /** An async run started: the call returned at once, and the run writes its state to `asyncDir`. */
  | Readonly<{ kind: 'async-launch'; callId: string; runId: string; asyncDir: string }>
  /** `bg_wait` saw an async run finish and names its child session files. */
  | Readonly<{ kind: 'async-complete'; runId: string; sessionFiles: readonly string[] }>;

export type PiSubagentSidechainSend = (
  body: ACPMessageData,
  opts: { localId: string; meta: Record<string, unknown> },
) => Promise<void>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sha256Short(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function addSessionFile(target: string[], value: unknown): void {
  const sessionFile = asNonEmptyString(value);
  if (!sessionFile || !isAbsolute(sessionFile) || !sessionFile.endsWith('.jsonl')) return;
  if (!target.includes(sessionFile)) target.push(sessionFile);
}

function readResultSessionFiles(results: unknown): string[] {
  const sessionFiles: string[] = [];
  if (!Array.isArray(results)) return sessionFiles;
  for (const entry of results) addSessionFile(sessionFiles, asRecord(entry)?.sessionFile);
  return sessionFiles;
}

/**
 * Reads what the mirror needs from a `subagent` update or end event, or from a `bg_wait` end
 * event. Returns null for any other event, and for a call without child sessions (for example
 * `action: "list"`).
 */
export function readPiSubagentSessionObservation(event: unknown): PiSubagentSessionObservation | null {
  const record = asRecord(event);
  if (!record) return null;
  const type = record.type;
  if (type !== 'tool_execution_update' && type !== 'tool_execution_end') return null;
  const toolName = asNonEmptyString(record.toolName);
  const result = asRecord(type === 'tool_execution_update' ? record.partialResult : record.result);
  const details = asRecord(result?.details);

  if (toolName === PI_BG_WAIT_TOOL_NAME) {
    if (type !== 'tool_execution_end') return null;
    const completions = Array.isArray(details?.completions) ? details.completions : [];
    for (const rawCompletion of completions) {
      const completion = asRecord(rawCompletion);
      const runId = asNonEmptyString(completion?.runId);
      const sessionFiles = readResultSessionFiles(completion?.results);
      // One bg_wait call normally delivers one run; a later wait delivers the others.
      if (runId && sessionFiles.length > 0) return { kind: 'async-complete', runId, sessionFiles };
    }
    return null;
  }

  if (toolName !== PI_SUBAGENT_TOOL_NAME) return null;
  const callId = asNonEmptyString(record.toolCallId);
  if (!callId) return null;
  const sessionFiles = readResultSessionFiles(details?.results);
  if (sessionFiles.length > 0) return { kind: 'sessions', callId, sessionFiles, final: type === 'tool_execution_end' };

  const runId = asNonEmptyString(details?.asyncId);
  const asyncDir = asNonEmptyString(details?.asyncDir);
  if (type === 'tool_execution_end' && runId && asyncDir && isAbsolute(asyncDir)) {
    return { kind: 'async-launch', callId, runId, asyncDir };
  }
  return null;
}

/** The parent tool call id namespaces child tool ids, so they cannot collide with main-thread ids. */
function namespaceChildCallId(sidechainId: string, childCallId: string): string {
  return `sc:${sidechainId}:${childCallId}`;
}

/**
 * Converts one child session JSONL entry to sidechain messages. User and system messages are
 * skipped: the parent tool input already holds the task.
 */
export function mapPiChildSessionEntryToSidechainMessages(params: {
  entry: unknown;
  sidechainId: string;
}): Array<Readonly<{ key: string; body: ACPMessageData }>> {
  const entry = asRecord(params.entry);
  if (!entry || entry.type !== 'message') return [];
  const entryId = asNonEmptyString(entry.id);
  const message = asRecord(entry.message);
  if (!entryId || !message) return [];
  const { sidechainId } = params;
  const content = Array.isArray(message.content) ? message.content : [];
  const out: Array<Readonly<{ key: string; body: ACPMessageData }>> = [];

  if (message.role === 'assistant') {
    content.forEach((rawBlock, index) => {
      const block = asRecord(rawBlock);
      if (!block) return;
      const key = `${entryId}:${index}`;
      if (block.type === 'text') {
        const text = asNonEmptyString(block.text);
        if (text) out.push({ key, body: { type: 'message', message: text, sidechainId } });
        return;
      }
      if (block.type === 'thinking') {
        const text = asNonEmptyString(block.thinking);
        if (text) out.push({ key, body: { type: 'thinking', text, sidechainId } });
        return;
      }
      if (block.type === 'toolCall') {
        const childCallId = asNonEmptyString(block.id);
        const name = asNonEmptyString(block.name);
        if (!childCallId || !name) return;
        const callId = namespaceChildCallId(sidechainId, childCallId);
        out.push({
          key,
          body: { type: 'tool-call', callId, name, input: block.arguments ?? {}, id: `pi-subagent-${callId}`, sidechainId },
        });
      }
    });
    return out;
  }

  if (message.role === 'toolResult') {
    const childCallId = asNonEmptyString(message.toolCallId);
    if (!childCallId) return [];
    const callId = namespaceChildCallId(sidechainId, childCallId);
    out.push({
      key: entryId,
      body: {
        type: 'tool-result',
        callId,
        // The same shape the main Pi thread forwards for a tool result.
        output: { content, ...(message.details !== undefined ? { details: message.details } : {}) },
        id: `pi-subagent-${callId}-result`,
        ...(message.isError === true ? { isError: true } : {}),
        sidechainId,
      },
    });
  }
  return out;
}

/**
 * A child can call `subagent` itself. Its tool result in the child session holds the same details
 * as a parent end event, so the grandchild is mirrored into the sidechain of the child call.
 */
function readNestedSubagentObservation(entry: unknown, sidechainId: string): PiSubagentSessionObservation | null {
  const message = asRecord(asRecord(entry)?.message);
  if (!message || message.role !== 'toolResult') return null;
  const toolName = asNonEmptyString(message.toolName);
  const childCallId = asNonEmptyString(message.toolCallId);
  if (!childCallId || (toolName !== PI_SUBAGENT_TOOL_NAME && toolName !== PI_BG_WAIT_TOOL_NAME)) return null;
  return readPiSubagentSessionObservation({
    type: 'tool_execution_end',
    toolName,
    toolCallId: namespaceChildCallId(sidechainId, childCallId),
    result: { details: message.details },
  });
}

type FileReadState = { offset: number; pendingLine: string };

export type PiSubagentSidechainMirror = Readonly<{
  observe: (observation: PiSubagentSessionObservation) => Promise<void>;
}>;

type AsyncRunFollow = { callId: string; asyncDir: string; timer: ReturnType<typeof setTimeout> | null };

export function createPiSubagentSidechainMirror(params: {
  send: PiSubagentSidechainSend;
  onError?: (error: unknown) => void;
  /** How often an async run's status.json is read; tests set a short value. */
  asyncStatusPollMs?: number;
}): PiSubagentSidechainMirror {
  const readStateByFile = new Map<string, FileReadState>();
  const sentKeys = new Set<string>();
  const queueByCallId = new Map<string, Promise<void>>();
  const asyncRunById = new Map<string, AsyncRunFollow>();
  const callIdByRunId = new Map<string, string>();
  const asyncStatusPollMs = params.asyncStatusPollMs ?? DEFAULT_ASYNC_STATUS_POLL_MS;

  const readNewLines = async (sessionFile: string): Promise<string[]> => {
    const state = readStateByFile.get(sessionFile) ?? { offset: 0, pendingLine: '' };
    readStateByFile.set(sessionFile, state);
    let handle;
    try {
      handle = await open(sessionFile, 'r');
    } catch {
      // The child may not have written its file yet. The next snapshot tries again.
      return [];
    }
    try {
      const { size } = await handle.stat();
      if (size <= state.offset) return [];
      const length = Math.min(size - state.offset, MAX_READ_BYTES_PER_PASS);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
      state.offset += bytesRead;
      const text = state.pendingLine + buffer.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      // The last part has no newline yet, so it can be a line that the child is still writing.
      state.pendingLine = lines.pop() ?? '';
      return lines;
    } finally {
      await handle.close();
    }
  };

  const mirrorFile = async (sidechainId: string, sessionFile: string): Promise<void> => {
    const lines = await readNewLines(sessionFile);
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const nested = readNestedSubagentObservation(entry, sidechainId);
      for (const item of mapPiChildSessionEntryToSidechainMessages({ entry, sidechainId })) {
        const sentKey = `${sidechainId}\u0000${sessionFile}\u0000${item.key}`;
        if (sentKeys.has(sentKey)) continue;
        sentKeys.add(sentKey);
        await params.send(item.body, {
          // Stable across restarts, so a resend of the same block replaces instead of duplicating.
          localId: `pi-subagent-sidechain:v1:${sha256Short(sidechainId)}:${sha256Short(sessionFile)}:${item.key}`,
          meta: { importedFrom: 'pi-subagent-sidechain', sidechainId },
        });
      }
      // The child call's own queue runs it, so this pass does not wait on itself.
      if (nested) void observe(nested);
    }
  };

  const forget = (callId: string, sessionFiles: readonly string[]): void => {
    for (const sessionFile of sessionFiles) readStateByFile.delete(sessionFile);
    const prefix = `${callId}\u0000`;
    for (const key of sentKeys) if (key.startsWith(prefix)) sentKeys.delete(key);
    queueByCallId.delete(callId);
  };

  /** Mirrors the files into the call's sidechain, one pass at a time per call. */
  const enqueue = (callId: string, sessionFiles: readonly string[], final: boolean): Promise<void> => {
    // Snapshots arrive faster than a pass can finish, and two passes over the same file would read
    // the same bytes twice.
    const previous = queueByCallId.get(callId) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        for (const sessionFile of sessionFiles) {
          await mirrorFile(callId, sessionFile);
        }
      } catch (error) {
        params.onError?.(error);
      } finally {
        if (final) forget(callId, sessionFiles);
      }
    });
    queueByCallId.set(callId, next);
    return next;
  };

  const stopFollowing = (runId: string): void => {
    const follow = asyncRunById.get(runId);
    if (follow?.timer) clearTimeout(follow.timer);
    asyncRunById.delete(runId);
  };

  /**
   * An async child runs detached from the parent RPC stream, and nothing pushes its progress to
   * this process. Its run directory holds status.json, which names the child session files and
   * the run state. Read it until the state is final; `bg_wait` then delivers the last pass.
   */
  const pollAsyncRun = async (runId: string): Promise<void> => {
    const follow = asyncRunById.get(runId);
    if (!follow) return;
    follow.timer = null;
    let status: Record<string, unknown> | null = null;
    try {
      status = asRecord(JSON.parse(await readFile(join(follow.asyncDir, 'status.json'), 'utf8')));
    } catch {
      // The run has not written its status yet, or is writing it now. The next pass reads it.
    }
    const sessionFiles: string[] = [];
    if (status) {
      addSessionFile(sessionFiles, status.sessionFile);
      const steps = Array.isArray(status.steps) ? status.steps : [];
      for (const step of steps) addSessionFile(sessionFiles, asRecord(step)?.sessionFile);
    }
    if (sessionFiles.length > 0) await enqueue(follow.callId, sessionFiles, false);
    const state = asNonEmptyString(status?.state);
    const deadlineAt = typeof status?.deadlineAt === 'number' ? status.deadlineAt : null;
    // A run killed hard never writes a final state; its deadline still ends the follow.
    if ((state && !PI_ASYNC_LIVE_STATES.has(state)) || (deadlineAt !== null && Date.now() > deadlineAt)) {
      stopFollowing(runId);
      return;
    }
    if (!asyncRunById.has(runId)) return;
    follow.timer = setTimeout(() => {
      void pollAsyncRun(runId);
    }, asyncStatusPollMs);
    follow.timer.unref?.();
  };

  const observe = (observation: PiSubagentSessionObservation): Promise<void> => {
    if (observation.kind === 'sessions') {
      return enqueue(observation.callId, observation.sessionFiles, observation.final);
    }
    if (observation.kind === 'async-launch') {
      callIdByRunId.set(observation.runId, observation.callId);
      if (!asyncRunById.has(observation.runId)) {
        asyncRunById.set(observation.runId, { callId: observation.callId, asyncDir: observation.asyncDir, timer: null });
        void pollAsyncRun(observation.runId);
      }
      return Promise.resolve();
    }
    const callId = callIdByRunId.get(observation.runId);
    // A run launched before this process started has no known call, so there is no sidechain.
    if (!callId) return Promise.resolve();
    stopFollowing(observation.runId);
    callIdByRunId.delete(observation.runId);
    return enqueue(callId, observation.sessionFiles, true);
  };

  // Poll timers are unref'd and end with the run, so the mirror needs no dispose step.
  return { observe };
}
