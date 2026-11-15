import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupDeletedChatFolder } from './cleanupDeletedChatFolder';

describe('cleanupDeletedChatFolder', () => {
  let root: string;
  let chatsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chats-deleted-'));
    chatsDir = join(root, 'chats');
    await mkdir(chatsDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('removes a deleted chat folder that holds only what the daemon put there, with its title link', async () => {
    const folder = join(chatsDir, '2026-11-15-724p');
    await mkdir(join(folder, '.happier', 'uploads'), { recursive: true });
    await writeFile(join(folder, '.gitignore'), '/.happier/uploads/\n');
    execFileSync('git', ['init', '--quiet', folder], { stdio: 'ignore' });
    await symlink('2026-11-15-724p', join(chatsDir, 'Syntax highlighting'), 'dir');

    expect(await cleanupDeletedChatFolder({ sessionPath: folder, chatsDir })).toBe(true);
    expect(await readdir(chatsDir)).toEqual([]);
  });

  it('keeps the whole folder, repository included, when the chat left work in it', async () => {
    const folder = join(chatsDir, '2026-11-15-aaaa');
    await mkdir(join(folder, '.happier', 'uploads'), { recursive: true });
    await writeFile(join(folder, '.gitignore'), '/.happier/uploads/\n');
    await writeFile(join(folder, 'notes.md'), 'half-done\n');
    execFileSync('git', ['init', '--quiet', folder], { stdio: 'ignore' });

    expect(await cleanupDeletedChatFolder({ sessionPath: folder, chatsDir })).toBe(false);
    expect((await readdir(folder)).sort()).toEqual(['.git', '.gitignore', '.happier', 'notes.md']);
  });

  it('keeps an empty folder that is not daemon leftovers, and never touches a folder outside chatsDir', async () => {
    const handMade = join(chatsDir, '2026-11-15-bbbb');
    await mkdir(join(handMade, 'drafts'), { recursive: true });
    const elsewhere = join(root, '2026-11-15-cccc');
    await mkdir(elsewhere);

    expect(await cleanupDeletedChatFolder({ sessionPath: handMade, chatsDir })).toBe(false);
    expect(await cleanupDeletedChatFolder({ sessionPath: elsewhere, chatsDir })).toBe(false);
    expect(await cleanupDeletedChatFolder({ sessionPath: join(chatsDir, '2026-11-15-gone'), chatsDir })).toBe(false);
    expect((await readdir(chatsDir)).sort()).toEqual(['2026-11-15-bbbb']);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('does not follow a symlink that pretends to be a chat folder', async () => {
    const real = join(root, 'outside');
    await mkdir(join(real, '.git'), { recursive: true });
    const link = join(chatsDir, '2026-11-15-dddd');
    await symlink(real, link, 'dir');

    expect(await cleanupDeletedChatFolder({ sessionPath: link, chatsDir })).toBe(false);
    expect(await readdir(real)).toEqual(['.git']);
  });
});
