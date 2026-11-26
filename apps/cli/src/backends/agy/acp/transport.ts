import { readFileSync } from 'node:fs';

import { DefaultTransport } from '@/agent/transport';

/**
 * agy (`agy acp`) sends its tool arguments in PascalCase (`Path`, `CommandLine`, `Target`, ...) and
 * only the ACP family in `kind` ("read", "execute", "edit", "other"). Its own tool name travels in a
 * non-ACP `name` field that the ACP SDK drops, so the tool is found from `kind`, the argument names
 * and the title ("Run update_steps"). This transport rewrites each agy tool update into the payload
 * shape of Pi's ACP tools (`read`, `bash`, `edit`, `write`), so an agy chat shows the same tool rows
 * as a Pi chat.
 */

/** Pi's read tool shows at most 2000 lines or 50 KB, and so does the agy read projection. */
export const AGY_READ_MAX_LINES = 2000;
export const AGY_READ_MAX_BYTES = 50 * 1024;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function readString(record: UnknownRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function readPositiveInt(record: UnknownRecord, key: string): number | null {
  const raw = record[key];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** agy logs some array arguments as JSON strings; ACP usually sends the array itself. */
function readArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function textOutput(text: string): UnknownRecord {
  return { content: [{ type: 'text', text }] };
}

function isTerminal(status: unknown): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

type ReadRange = Readonly<{ path: string; offset: number | null; limit: number | null }>;

function readRange(args: UnknownRecord): ReadRange | null {
  const path = readString(args, 'Path', 'AbsolutePath');
  if (!path) return null;
  const start = readPositiveInt(args, 'StartLine');
  const end = readPositiveInt(args, 'EndLine');
  const offset = start ?? (end !== null ? 1 : null);
  const limit = end !== null && end >= (offset ?? 1) ? end - (offset ?? 1) + 1 : null;
  return { path, offset, limit };
}

/**
 * agy reports no file content for a completed read, so this reads the same range from disk.
 * The text follows Pi's read tool: the lines only, cut at 2000 lines or 50 KB with a note.
 */
export function readAgyFileRange(range: ReadRange, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): string {
  let body: string;
  try {
    body = readFile(range.path);
  } catch (error) {
    return `Could not read ${range.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  const first = Math.min(range.offset ?? 1, total + 1);
  const requestedLast = range.limit !== null ? first + range.limit - 1 : total;
  let last = Math.min(requestedLast, total, first + AGY_READ_MAX_LINES - 1);
  let selected = lines.slice(first - 1, last);
  let bytes = 0;
  for (let index = 0; index < selected.length; index += 1) {
    bytes += Buffer.byteLength(selected[index]!, 'utf8') + 1;
    if (bytes > AGY_READ_MAX_BYTES && index > 0) {
      selected = selected.slice(0, index);
      last = first + index - 1;
      break;
    }
  }
  const text = selected.join('\n');
  if (last < Math.min(requestedLast, total)) {
    return `${text}\n\n[Showing lines ${first}-${last} of ${total}. Use offset=${last + 1} to continue.]`;
  }
  return text;
}

const COMMAND_HEADER = /^Created At:[^\n]*\nCompleted At:[^\n]*\nCommand exited with code (-?\d+)\.\n\nCommand output:\n?/;

/** Removes agy's timestamp header so the output reads like Pi's bash output. */
export function formatAgyCommandOutput(rawOutput: unknown): string | null {
  const record = asRecord(rawOutput);
  const output = record && typeof record.output === 'string' ? record.output : typeof rawOutput === 'string' ? rawOutput : null;
  if (output === null) return null;
  const text = output.replace(/\r\n/g, '\n');
  const match = COMMAND_HEADER.exec(text);
  const body = (match ? text.slice(match[0].length) : text).replace(/\n+$/, '');
  const exitCode = typeof record?.exit_code === 'number' ? record.exit_code : match ? Number(match[1]) : 0;
  if (exitCode === 0) return body;
  return body ? `${body}\n\nCommand exited with code ${exitCode}` : `Command exited with code ${exitCode}`;
}

type EditPair = Readonly<{ oldText: string; newText: string }>;

function readEditPairs(args: UnknownRecord): EditPair[] {
  const single = readString(args, 'Target', 'TargetContent');
  if (single !== null) {
    const replacement = args.Replacement ?? args.ReplacementContent;
    return [{ oldText: single, newText: typeof replacement === 'string' ? replacement : '' }];
  }
  const chunks = readArray(args.ReplacementChunks ?? args.Chunks) ?? [];
  return chunks.flatMap((chunk) => {
    const record = asRecord(chunk);
    const oldText = record ? readString(record, 'Target', 'TargetContent') : null;
    if (!record || oldText === null) return [];
    const newText = record.Replacement ?? record.ReplacementContent;
    return [{ oldText, newText: typeof newText === 'string' ? newText : '' }];
  });
}

const TODO_STATUS: Readonly<Record<string, string>> = {
  done: 'completed',
  completed: 'completed',
  in_progress: 'in_progress',
  pending: 'pending',
};

function readTodos(args: UnknownRecord): UnknownRecord[] {
  return (readArray(args.steps) ?? []).flatMap((step) => {
    const record = asRecord(step);
    const content = record ? readString(record, 'title', 'content') : null;
    if (!record || content === null) return [];
    const status = typeof record.status === 'string' ? TODO_STATUS[record.status] ?? 'pending' : 'pending';
    return [{ content, status }];
  });
}

const RUN_TITLE = /^Run ([A-Za-z0-9_]+)$/;

/** Finds agy's tool name; null when the update is not an agy tool this transport knows. */
function agyToolName(update: UnknownRecord, args: UnknownRecord): string | null {
  const title = typeof update.title === 'string' ? update.title.trim() : '';
  const fromTitle = RUN_TITLE.exec(title)?.[1];
  if (fromTitle) return fromTitle;
  switch (update.kind) {
    case 'read':
      return 'Path' in args || 'AbsolutePath' in args ? 'read_file' : null;
    case 'execute':
      return 'CommandLine' in args ? 'run_command' : null;
    case 'edit':
      if (!('Path' in args || 'TargetFile' in args)) return null;
      return 'Content' in args || 'CodeContent' in args ? 'write_file' : 'edit_file';
    default:
      return null;
  }
}

type Projection = Readonly<{ kind: string; rawInput: UnknownRecord; rawOutput?: UnknownRecord }>;

function project(name: string, args: UnknownRecord, update: UnknownRecord, readFile?: (path: string) => string): Projection {
  const done = update.status === 'completed';
  switch (name) {
    case 'read_file':
    case 'view_file': {
      const range = readRange(args);
      if (!range) break;
      const rawInput: UnknownRecord = { path: range.path };
      if (range.offset !== null) rawInput.offset = range.offset;
      if (range.limit !== null) rawInput.limit = range.limit;
      return done
        ? { kind: 'read', rawInput, rawOutput: textOutput(readAgyFileRange(range, readFile)) }
        : { kind: 'read', rawInput };
    }
    case 'run_command': {
      const command = readString(args, 'CommandLine');
      if (!command) break;
      const rawInput: UnknownRecord = { command };
      const description = readString(args, 'toolSummary');
      if (description) rawInput.description = description;
      const text = isTerminal(update.status) ? formatAgyCommandOutput(update.rawOutput) : null;
      return text !== null ? { kind: 'bash', rawInput, rawOutput: textOutput(text) } : { kind: 'bash', rawInput };
    }
    case 'edit_file': {
      const path = readString(args, 'Path', 'TargetFile');
      const edits = readEditPairs(args);
      if (!path || edits.length === 0) break;
      const rawInput = { path, edits };
      return done
        ? { kind: 'edit', rawInput, rawOutput: textOutput(`Successfully replaced ${edits.length} block(s) in ${path}.`) }
        : { kind: 'edit', rawInput };
    }
    case 'write_file': {
      const path = readString(args, 'Path', 'TargetFile');
      const content = typeof args.Content === 'string' ? args.Content : typeof args.CodeContent === 'string' ? args.CodeContent : null;
      if (!path || content === null) break;
      const rawInput = { path, content };
      return done
        ? { kind: 'write', rawInput, rawOutput: textOutput(`Successfully wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path}`) }
        : { kind: 'write', rawInput };
    }
    case 'update_steps': {
      const todos = readTodos(args);
      if (todos.length > 0) return { kind: 'TodoWrite', rawInput: { todos } };
      break;
    }
    case 'search_web': {
      const query = readString(args, 'query', 'Query');
      if (query) return { kind: 'web_search', rawInput: { query } };
      break;
    }
  }
  // agy's own Happier MCP tools: `mcp_happier_change_title` is `mcp__happier__change_title`.
  const happierMcp = /^mcp_happier_(.+)$/.exec(name);
  return { kind: happierMcp ? `mcp__happier__${happierMcp[1]}` : name, rawInput: args };
}

/** Rewrites one agy `tool_call` / `tool_call_update` into Pi's payload shape. */
export function projectAgyToolUpdate<T extends { content?: unknown }>(update: T, readFile?: (path: string) => string): T {
  const record = update as unknown as UnknownRecord;
  const args = asRecord(record.rawInput);
  if (!args) return update;
  const name = agyToolName(record, args);
  if (!name) return update;
  const projection = project(name, args, record, readFile);
  const next: UnknownRecord = { ...record, kind: projection.kind, rawInput: projection.rawInput };
  if (projection.rawOutput) next.rawOutput = projection.rawOutput;
  return next as unknown as T;
}

export class AgyTransport extends DefaultTransport {
  constructor() {
    super('agy');
  }

  override sanitizeToolUpdateContent<T extends { content?: unknown }>(update: T): T {
    return projectAgyToolUpdate(update);
  }
}
