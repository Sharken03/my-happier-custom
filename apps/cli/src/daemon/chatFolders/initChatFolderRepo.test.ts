import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initChatFolderRepo } from './initChatFolderRepo';
import { removeEmptyChatFolder } from './removeEmptyChatFolder';

describe('chat folder repositories', () => {
  let chatsDir: string;

  beforeEach(async () => {
    chatsDir = await mkdtemp(join(tmpdir(), 'chats-'));
  });

  afterEach(async () => {
    await rm(chatsDir, { recursive: true, force: true });
  });

  it('makes a new chat folder a git repository, once, and leaves other folders alone', async () => {
    const folder = join(chatsDir, '2026-11-09-a1b2');
    await mkdir(folder);
    const project = join(chatsDir, 'my-project');
    await mkdir(project);

    expect(await initChatFolderRepo({ sessionPath: folder, chatsDir })).toBe(true);
    expect(existsSync(join(folder, '.git'))).toBe(true);
    expect(await initChatFolderRepo({ sessionPath: folder, chatsDir })).toBe(false);
    expect(await initChatFolderRepo({ sessionPath: project, chatsDir })).toBe(false);
    expect(existsSync(join(project, '.git'))).toBe(false);
  });

  it('removes a stopped chat folder that only holds its unused repository, and keeps one with a commit', async () => {
    const unused = join(chatsDir, '2026-11-09-c3d4');
    await mkdir(unused);
    await initChatFolderRepo({ sessionPath: unused, chatsDir });
    expect(await removeEmptyChatFolder({ sessionPath: unused, chatsDir })).toBe(true);

    const committed = join(chatsDir, '2026-11-09-e5f6');
    await mkdir(committed);
    await initChatFolderRepo({ sessionPath: committed, chatsDir });
    await writeFile(join(committed, 'notes.md'), 'x');
    const git = (...args: string[]) => execFileSync('git', args, {
      cwd: committed,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    });
    git('add', 'notes.md');
    git('commit', '-q', '-m', 'notes');
    await rm(join(committed, 'notes.md'));

    expect(await removeEmptyChatFolder({ sessionPath: committed, chatsDir })).toBe(false);
    expect(await readdir(chatsDir)).toEqual(['2026-11-09-e5f6']);
  });
});
