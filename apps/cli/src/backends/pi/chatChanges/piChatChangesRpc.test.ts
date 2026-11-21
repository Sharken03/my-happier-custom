import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PI_CHAT_CHANGES_TEXT_MAX_BYTES } from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

import { registerPiChatChangesHandlers } from './piChatChangesRpc';

type Handler = (data: unknown) => unknown;

let base: string;
let storeRoot: string;
let filesDir: string;
let sessionFile: string | null;
let handlers: Map<string, Handler>;

const ROOT_ID = 'root-session-id';

async function writeSessionFile(path: string, header: Record<string, unknown>): Promise<void> {
  await writeFile(path, `${JSON.stringify({ type: 'session', timestamp: '2026-11-16T00:00:00Z', cwd: base, ...header })}\n`);
}

function keyOf(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

/** Writes a store entry the way the Pi extension does. */
async function recordChange(path: string, opts: { before?: string | Buffer; created?: boolean; tooLarge?: boolean; updatedAt?: number }): Promise<void> {
  const folder = join(storeRoot, ROOT_ID);
  await mkdir(folder, { recursive: true });
  const key = keyOf(path);
  await writeFile(join(folder, `${key}.json`), JSON.stringify({
    v: 1,
    path,
    created: opts.created === true,
    tooLarge: opts.tooLarge === true,
    firstChangedAt: 1,
    updatedAt: opts.updatedAt ?? 2,
  }));
  if (opts.before !== undefined) await writeFile(join(folder, `${key}.before`), opts.before);
}

async function call(method: string, data: unknown): Promise<any> {
  const handler = handlers.get(method);
  if (!handler) throw new Error(`no handler for ${method}`);
  return await handler(data);
}

const list = () => call(SESSION_RPC_METHODS.PI_CHAT_CHANGES_LIST, {});
const diff = (path: string) => call(SESSION_RPC_METHODS.PI_CHAT_CHANGES_DIFF, { path });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'pi-chat-changes-'));
  storeRoot = join(base, 'store');
  filesDir = join(base, 'files');
  await mkdir(filesDir, { recursive: true });
  sessionFile = join(base, 'root.jsonl');
  await writeSessionFile(sessionFile, { id: ROOT_ID });
  handlers = new Map();
  registerPiChatChangesHandlers(
    { registerHandler: (method, handler) => { handlers.set(method, handler as Handler); } },
    { getSessionFile: () => sessionFile, processEnv: { PI_CHAT_CHANGES_DIR: storeRoot } },
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('pi.chatChanges.list', () => {
  it('returns an empty list when the chat has no store folder', async () => {
    expect(await list()).toEqual({ ok: true, files: [] });
  });

  it('counts all lines of a created file as added', async () => {
    const path = join(filesDir, 'new.txt');
    await writeFile(path, 'a\nb\nc\n');
    await recordChange(path, { created: true, updatedAt: 42 });

    expect(await list()).toEqual({
      ok: true,
      files: [{ path, created: true, tooLarge: false, deleted: false, added: 3, removed: 0, updatedAt: 42 }],
    });
  });

  it('counts the net diff of an edited file', async () => {
    const path = join(filesDir, 'edit.txt');
    await recordChange(path, { before: 'one\ntwo\nthree\n' });
    await writeFile(path, 'one\nTWO\nthree\nfour\n');

    const result = await list();
    expect(result.files).toEqual([
      expect.objectContaining({ path, created: false, deleted: false, added: 2, removed: 1 }),
    ]);
  });

  it('keeps a file that is back to its before state with 0/0', async () => {
    const path = join(filesDir, 'same.txt');
    await recordChange(path, { before: 'x\ny\n' });
    await writeFile(path, 'x\ny\n');

    const result = await list();
    expect(result.files).toEqual([expect.objectContaining({ path, added: 0, removed: 0, deleted: false })]);
  });

  it('marks a file that is gone now as deleted', async () => {
    const path = join(filesDir, 'gone.txt');
    await recordChange(path, { before: 'x\ny\n' });

    const result = await list();
    expect(result.files).toEqual([expect.objectContaining({ path, deleted: true, added: 0, removed: 2 })]);
  });

  it('gives 0/0 for too large and binary files', async () => {
    const big = join(filesDir, 'big.txt');
    await recordChange(big, { tooLarge: true });
    await writeFile(big, 'a\n');
    const grown = join(filesDir, 'grown.txt');
    await recordChange(grown, { before: 'a\n' });
    await writeFile(grown, 'a\n'.repeat(PI_CHAT_CHANGES_TEXT_MAX_BYTES / 2 + 1));
    const binary = join(filesDir, 'image.bin');
    await recordChange(binary, { before: 'a\n' });
    await writeFile(binary, Buffer.from([0x89, 0x50, 0x00, 0x0a]));

    const result = await list();
    const byPath = new Map(result.files.map((file: any) => [file.path, file]));
    for (const path of [big, grown, binary]) {
      expect(byPath.get(path)).toEqual(expect.objectContaining({ tooLarge: true, added: 0, removed: 0 }));
    }
  });

  it('reads the store of the root chat through parentSession', async () => {
    const child = join(base, 'child.jsonl');
    await writeSessionFile(child, { id: 'child-id', parentSession: sessionFile });
    sessionFile = child;
    const path = join(filesDir, 'from-child.txt');
    await writeFile(path, 'z\n');
    await recordChange(path, { created: true });

    const result = await list();
    expect(result.files).toEqual([expect.objectContaining({ path, created: true, added: 1 })]);
  });

  it('fails when the session file is not known', async () => {
    sessionFile = null;
    expect(await list()).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe('pi.chatChanges.diff', () => {
  it('returns the before and current text of an edited file', async () => {
    const path = join(filesDir, 'edit.txt');
    await recordChange(path, { before: 'old\n' });
    await writeFile(path, 'new\n');

    expect(await diff(path)).toEqual({
      ok: true, path, before: 'old\n', after: 'new\n', created: false, tooLarge: false, binary: false,
    });
  });

  it('returns no before text for a created file and no after text for a deleted one', async () => {
    const path = join(filesDir, 'temp.txt');
    await writeFile(path, 'hi\n');
    await recordChange(path, { created: true });
    expect(await diff(path)).toEqual(expect.objectContaining({ ok: true, before: null, after: 'hi\n', created: true }));

    await unlink(path);
    expect(await diff(path)).toEqual(expect.objectContaining({ ok: true, before: null, after: null }));
  });

  it('returns no text for binary and too large files', async () => {
    const binary = join(filesDir, 'image.bin');
    await recordChange(binary, { before: 'a\n' });
    await writeFile(binary, Buffer.from([0x00, 0x01]));
    expect(await diff(binary)).toEqual(expect.objectContaining({ ok: true, before: 'a\n', after: null, binary: true }));

    const big = join(filesDir, 'big.txt');
    await recordChange(big, { tooLarge: true });
    await writeFile(big, 'a\n');
    expect(await diff(big)).toEqual(expect.objectContaining({ ok: true, before: null, tooLarge: true }));
  });

  it('refuses a path that is not in the list', async () => {
    const path = join(filesDir, 'secret.txt');
    await writeFile(path, 'secret\n');
    await recordChange(join(filesDir, 'other.txt'), { created: true });

    expect(await diff(path)).toEqual({ ok: false, error: expect.any(String) });
  });
});
