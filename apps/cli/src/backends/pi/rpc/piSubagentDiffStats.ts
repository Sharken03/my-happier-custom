import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/**
 * Counts the lines that a `pi-subagents` run changed, so the app can show "+N −M" on the
 * subagent call without loading the subagent's messages. The count comes from the child
 * session files that the `subagent` result names (`details.results[].sessionFile`), and it goes
 * into the same result as `details.happierDiffStats`.
 */

const PI_SUBAGENT_TOOL_NAME = 'subagent';
/** Larger child sessions are not read: the event handler reads them synchronously. */
const MAX_SESSION_FILE_BYTES = 8 * 1024 * 1024;
/** A child can start its own subagents. Deeper levels are not counted. */
const MAX_NESTING_DEPTH = 3;

export type PiDiffStats = { added: number; removed: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Lines of a text; an empty text has none. A final line break does not add a line. */
function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The same cheap line diff as the app's group diff stats: it drops the common first and last
 * lines, then matches the rest as multisets.
 */
function countReplacement(oldText: string, newText: string): PiDiffStats {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const pool = new Map<string, number>();
  for (let i = start; i < oldEnd; i++) pool.set(oldLines[i], (pool.get(oldLines[i]) ?? 0) + 1);
  let added = 0;
  for (let i = start; i < newEnd; i++) {
    const left = pool.get(newLines[i]) ?? 0;
    if (left > 0) pool.set(newLines[i], left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of pool.values()) removed += left;
  return { added, removed };
}

/** One Pi `write` or `edit` call. Other tools count as zero. */
export function countPiToolCallLines(name: string, args: unknown): PiDiffStats {
  const input = asRecord(args);
  if (!input) return { added: 0, removed: 0 };
  if (name === 'write') return { added: splitLines(asString(input.content) ?? '').length, removed: 0 };
  if (name !== 'edit') return { added: 0, removed: 0 };
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  let added = 0;
  let removed = 0;
  for (const rawEdit of edits) {
    const edit = asRecord(rawEdit);
    if (!edit) continue;
    const counts = countReplacement(asString(edit.oldText) ?? '', asString(edit.newText) ?? '');
    added += counts.added;
    removed += counts.removed;
  }
  return { added, removed };
}

function readResultSessionFiles(details: unknown): string[] {
  const results = asRecord(details)?.results;
  if (!Array.isArray(results)) return [];
  const files: string[] = [];
  for (const entry of results) {
    const file = asString(asRecord(entry)?.sessionFile);
    if (file && isAbsolute(file) && file.endsWith('.jsonl') && !files.includes(file)) files.push(file);
  }
  return files;
}

function readSessionLines(sessionFile: string): string[] {
  try {
    if (statSync(sessionFile).size > MAX_SESSION_FILE_BYTES) return [];
    return readFileSync(sessionFile, 'utf8').split('\n');
  } catch {
    return [];
  }
}

/**
 * Counts the `write` and `edit` calls of one child session that did not end in an error, and
 * the sessions of the subagents that the child started itself.
 */
function countSessionFile(sessionFile: string, depth: number, seen: Set<string>): PiDiffStats {
  const total: PiDiffStats = { added: 0, removed: 0 };
  if (seen.has(sessionFile)) return total;
  seen.add(sessionFile);
  const calls = new Map<string, PiDiffStats>();
  const failed = new Set<string>();
  const nestedFiles: string[] = [];
  for (const line of readSessionLines(sessionFile)) {
    if (line.trim().length === 0) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = asRecord(asRecord(entry)?.message);
    if (!message) continue;
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const rawBlock of message.content) {
        const block = asRecord(rawBlock);
        const id = asString(block?.id);
        const name = asString(block?.name);
        if (block?.type !== 'toolCall' || !id || !name) continue;
        calls.set(id, countPiToolCallLines(name, block.arguments));
      }
    } else if (message.role === 'toolResult') {
      const id = asString(message.toolCallId);
      if (id && message.isError === true) failed.add(id);
      if (message.toolName === PI_SUBAGENT_TOOL_NAME) nestedFiles.push(...readResultSessionFiles(message.details));
    }
  }
  for (const [id, counts] of calls) {
    if (failed.has(id)) continue;
    total.added += counts.added;
    total.removed += counts.removed;
  }
  if (depth < MAX_NESTING_DEPTH) {
    for (const file of nestedFiles) {
      const nested = countSessionFile(file, depth + 1, seen);
      total.added += nested.added;
      total.removed += nested.removed;
    }
  }
  return total;
}

/**
 * For the end event of a `subagent` call: the lines that its child sessions changed. Null for
 * any other event, and for a call without child session files (an async launch or an action
 * such as `status`).
 */
export function readPiSubagentEndDiffStats(event: Record<string, unknown>): PiDiffStats | null {
  if (event.type !== 'tool_execution_end' || event.toolName !== PI_SUBAGENT_TOOL_NAME) return null;
  const files = readResultSessionFiles(asRecord(event.result)?.details);
  if (files.length === 0) return null;
  const seen = new Set<string>();
  const total: PiDiffStats = { added: 0, removed: 0 };
  for (const file of files) {
    const counts = countSessionFile(file, 1, seen);
    total.added += counts.added;
    total.removed += counts.removed;
  }
  return total;
}

/**
 * Returns the event with `result.details.happierDiffStats` set for a finished `subagent` call
 * with child sessions. Returns the same event for every other event.
 */
export function withPiSubagentDiffStats(event: Record<string, unknown>): Record<string, unknown> {
  const stats = readPiSubagentEndDiffStats(event);
  if (!stats) return event;
  const result = asRecord(event.result) ?? {};
  const details = asRecord(result.details) ?? {};
  return { ...event, result: { ...result, details: { ...details, happierDiffStats: stats } } };
}
