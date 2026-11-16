import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  PI_CHAT_CHANGES_TEXT_MAX_BYTES,
  PiChatChangesDiffRequestSchema,
  PiChatChangesListRequestSchema,
  type PiChatChangesDiffResponse,
  type PiChatChangesFile,
  type PiChatChangesListResponse,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { countReplacementLines } from '@happier-dev/protocol/tools/v2';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { readPiSessionHeader } from '@/backends/pi/directSessions/readPiSessionHeader';
import { expandHomeDirPath, resolveHomeDirFromEnvironment } from '@/utils/path/expandHomeDirPath';
import { logger } from '@/ui/logger';

/**
 * Read side of the Pi chat changes store. The `chat-changes` Pi extension writes the store:
 * `<root>/<root session id>/<sha256(path)>.json` per changed file, plus `<key>.before` with the
 * file as it was before the chat's first change. This module only reads it, when the app asks.
 */

const ENTRY_FILE_PATTERN = /^[0-9a-f]{64}\.json$/;

type StoreEntry = Readonly<{ path: string; created: boolean; tooLarge: boolean; updatedAt: number }>;

/** A file read as text, or why there is no text. */
type TextRead =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'missing' | 'tooLarge' | 'binary' }>;

export type PiChatChangesHandlerOptions = Readonly<{
  /** The Pi session file of this Happier session, or null while it is not known. */
  getSessionFile: () => string | null | undefined;
  processEnv?: NodeJS.ProcessEnv;
}>;

export function resolvePiChatChangesStoreRoot(env: NodeJS.ProcessEnv): string {
  const explicit = env.PI_CHAT_CHANGES_DIR?.trim();
  if (explicit) return resolve(expandHomeDirPath(explicit, env));
  return join(resolveHomeDirFromEnvironment(env), '.pi', 'agent', 'chat-changes');
}

/** The id of the top chat: follow `parentSession` from the session file up to the root. */
async function resolveRootSessionId(sessionFile: string): Promise<string | null> {
  const seen = new Set<string>();
  let file = resolve(sessionFile);
  let rootId: string | null = null;
  while (!seen.has(file)) {
    seen.add(file);
    const header = await readPiSessionHeader(file);
    if (!header) break;
    rootId = header.id;
    if (!header.parentSession) break;
    file = resolve(dirname(file), header.parentSession);
  }
  return rootId;
}

async function readText(path: string): Promise<TextRead> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return { kind: 'missing' };
    size = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  if (size > PI_CHAT_CHANGES_TEXT_MAX_BYTES) return { kind: 'tooLarge' };
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  if (buffer.length > PI_CHAT_CHANGES_TEXT_MAX_BYTES) return { kind: 'tooLarge' };
  if (buffer.includes(0)) return { kind: 'binary' };
  return { kind: 'text', text: buffer.toString('utf8') };
}

function parseEntry(raw: string): StoreEntry | null {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (!value || typeof value.path !== 'string' || !value.path) return null;
  return {
    path: value.path,
    created: value.created === true,
    tooLarge: value.tooLarge === true,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

async function resolveChatFolder(opts: PiChatChangesHandlerOptions): Promise<string> {
  const sessionFile = opts.getSessionFile();
  if (!sessionFile) throw new Error('pi_session_file_unknown');
  const rootId = await resolveRootSessionId(sessionFile);
  if (!rootId) throw new Error('pi_session_header_unreadable');
  return join(resolvePiChatChangesStoreRoot(opts.processEnv ?? process.env), rootId);
}

/** The before text of an entry; a created file was empty before. */
async function readBefore(folder: string, key: string, entry: StoreEntry): Promise<TextRead> {
  if (entry.tooLarge) return { kind: 'tooLarge' };
  if (entry.created) return { kind: 'text', text: '' };
  return await readText(join(folder, `${key}.before`));
}

async function listChanges(opts: PiChatChangesHandlerOptions): Promise<PiChatChangesListResponse> {
  const folder = await resolveChatFolder(opts);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, files: [] };
    throw error;
  }
  const files: PiChatChangesFile[] = [];
  for (const name of names.filter((n) => ENTRY_FILE_PATTERN.test(n)).sort()) {
    const entry = parseEntry(await readFile(join(folder, name), 'utf8'));
    if (!entry) continue;
    const before = await readBefore(folder, name.slice(0, -'.json'.length), entry);
    const after = await readText(entry.path);
    const deleted = after.kind === 'missing';
    const beforeText = before.kind === 'text' ? before.text : null;
    const afterText = after.kind === 'text' ? after.text : deleted ? '' : null;
    const counted = beforeText !== null && afterText !== null;
    const lines = counted ? countReplacementLines(beforeText, afterText) : { added: 0, removed: 0 };
    files.push({
      path: entry.path,
      created: entry.created,
      tooLarge: !counted,
      deleted,
      added: lines.added,
      removed: lines.removed,
      updatedAt: entry.updatedAt,
    });
  }
  return { ok: true, files };
}

async function diffChange(opts: PiChatChangesHandlerOptions, path: string): Promise<PiChatChangesDiffResponse> {
  const folder = await resolveChatFolder(opts);
  const key = createHash('sha256').update(path).digest('hex');
  let entry: StoreEntry | null;
  try {
    entry = parseEntry(await readFile(join(folder, `${key}.json`), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: 'path_not_in_chat_changes' };
    throw error;
  }
  // Read only a path the store lists under this exact key.
  if (!entry || entry.path !== path) return { ok: false, error: 'path_not_in_chat_changes' };
  const before = entry.created ? null : await readBefore(folder, key, entry);
  const after = await readText(path);
  return {
    ok: true,
    path,
    before: before?.kind === 'text' ? before.text : null,
    after: after.kind === 'text' ? after.text : null,
    created: entry.created,
    tooLarge: before?.kind === 'tooLarge' || after.kind === 'tooLarge',
    binary: before?.kind === 'binary' || after.kind === 'binary',
  };
}

function failure(method: string, error: unknown): Readonly<{ ok: false; error: string }> {
  const message = error instanceof Error ? error.message : String(error);
  logger.warnFile(`[pi] ${method} failed`, { error: message });
  return { ok: false, error: message };
}

/** Registers the Pi-only session RPCs that list and diff the chat's changes outside git. */
export function registerPiChatChangesHandlers(rpc: RpcHandlerRegistrar, opts: PiChatChangesHandlerOptions): void {
  rpc.registerHandler(SESSION_RPC_METHODS.PI_CHAT_CHANGES_LIST, async (raw: unknown): Promise<PiChatChangesListResponse> => {
    if (!PiChatChangesListRequestSchema.safeParse(raw ?? {}).success) return { ok: false, error: 'invalid_request' };
    try {
      return await listChanges(opts);
    } catch (error) {
      return failure(SESSION_RPC_METHODS.PI_CHAT_CHANGES_LIST, error);
    }
  });

  rpc.registerHandler(SESSION_RPC_METHODS.PI_CHAT_CHANGES_DIFF, async (raw: unknown): Promise<PiChatChangesDiffResponse> => {
    const parsed = PiChatChangesDiffRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'invalid_request' };
    try {
      return await diffChange(opts, parsed.data.path);
    } catch (error) {
      return failure(SESSION_RPC_METHODS.PI_CHAT_CHANGES_DIFF, error);
    }
  });
}
