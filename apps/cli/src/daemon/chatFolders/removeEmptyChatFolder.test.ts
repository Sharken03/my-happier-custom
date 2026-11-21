import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeEmptyChatFolder } from './removeEmptyChatFolder';

describe('removeEmptyChatFolder', () => {
  let chatsDir: string;

  beforeEach(async () => {
    chatsDir = await mkdtemp(join(tmpdir(), 'chats-'));
  });

  afterEach(async () => {
    await rm(chatsDir, { recursive: true, force: true });
  });

  it('removes an empty chat folder with its title link', async () => {
    const folder = join(chatsDir, '2026-11-08-a1b2');
    await mkdir(folder);
    await symlink('2026-11-08-a1b2', join(chatsDir, 'hej'), 'dir');

    expect(await removeEmptyChatFolder({ sessionPath: folder, chatsDir })).toBe(true);
    expect(await readdir(chatsDir)).toEqual([]);
  });

  it('keeps a chat folder with files, and folders that are not chat folders', async () => {
    const used = join(chatsDir, '2026-11-08-c3d4');
    await mkdir(used);
    await writeFile(join(used, 'notes.md'), 'x');
    const project = join(chatsDir, 'my-project');
    await mkdir(project);

    expect(await removeEmptyChatFolder({ sessionPath: used, chatsDir })).toBe(false);
    expect(await removeEmptyChatFolder({ sessionPath: project, chatsDir })).toBe(false);
    expect(await removeEmptyChatFolder({ sessionPath: join(chatsDir, '2026-11-08-gone'), chatsDir })).toBe(false);
    expect((await readdir(chatsDir)).sort()).toEqual(['2026-11-08-c3d4', 'my-project']);
  });
});
