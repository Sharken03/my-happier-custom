import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

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
/** Upper bound on one read, so a huge child session cannot stall the RPC event loop. */
const MAX_READ_BYTES_PER_PASS = 4 * 1024 * 1024;

export type PiSubagentSessionObservation = Readonly<{
  callId: string;
  sessionFiles: readonly string[];
  final: boolean;
}>;

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

/**
 * Reads the child session files from a `subagent` tool update or end event. Returns null for any
 * other event, or for a `subagent` call without child sessions (for example `action: "list"`).
 */
export function readPiSubagentSessionObservation(event: unknown): PiSubagentSessionObservation | null {
  const record = asRecord(event);
  if (!record) return null;
  const type = record.type;
  if (type !== 'tool_execution_update' && type !== 'tool_execution_end') return null;
  if (asNonEmptyString(record.toolName) !== PI_SUBAGENT_TOOL_NAME) return null;
  const callId = asNonEmptyString(record.toolCallId);
  if (!callId) return null;

  const result = asRecord(type === 'tool_execution_update' ? record.partialResult : record.result);
  const details = asRecord(result?.details);
  const results = Array.isArray(details?.results) ? details.results : [];
  const sessionFiles: string[] = [];
  for (const entry of results) {
    const sessionFile = asNonEmptyString(asRecord(entry)?.sessionFile);
    if (!sessionFile || !isAbsolute(sessionFile) || !sessionFile.endsWith('.jsonl')) continue;
    if (!sessionFiles.includes(sessionFile)) sessionFiles.push(sessionFile);
  }
  if (sessionFiles.length === 0) return null;
  return { callId, sessionFiles, final: type === 'tool_execution_end' };
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

type FileReadState = { offset: number; pendingLine: string };

export type PiSubagentSidechainMirror = Readonly<{
  observe: (observation: PiSubagentSessionObservation) => Promise<void>;
}>;

export function createPiSubagentSidechainMirror(params: {
  send: PiSubagentSidechainSend;
  onError?: (error: unknown) => void;
}): PiSubagentSidechainMirror {
  const readStateByFile = new Map<string, FileReadState>();
  const sentKeys = new Set<string>();
  const queueByCallId = new Map<string, Promise<void>>();

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
    }
  };

  const forget = (observation: PiSubagentSessionObservation): void => {
    for (const sessionFile of observation.sessionFiles) readStateByFile.delete(sessionFile);
    const prefix = `${observation.callId}\u0000`;
    for (const key of sentKeys) if (key.startsWith(prefix)) sentKeys.delete(key);
    queueByCallId.delete(observation.callId);
  };

  const observe = (observation: PiSubagentSessionObservation): Promise<void> => {
    // One pass at a time per tool call: snapshots arrive faster than a pass can finish, and two
    // passes over the same file would read the same bytes twice.
    const previous = queueByCallId.get(observation.callId) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        for (const sessionFile of observation.sessionFiles) {
          await mirrorFile(observation.callId, sessionFile);
        }
      } catch (error) {
        params.onError?.(error);
      } finally {
        if (observation.final) forget(observation);
      }
    });
    queueByCallId.set(observation.callId, next);
    return next;
  };

  return { observe };
}
