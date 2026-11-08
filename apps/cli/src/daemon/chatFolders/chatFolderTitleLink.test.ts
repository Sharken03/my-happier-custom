import { lstat, mkdir, mkdtemp, readlink, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chatTitleSlug, linkChatFolderTitle } from './chatFolderTitleLink';

describe('chatTitleSlug', () => {
  it('keeps letters and digits of any script and joins the rest with dashes', () => {
    expect(chatTitleSlug('  Fortæl en vits!  ')).toBe('fortæl-en-vits');
    expect(chatTitleSlug('v2: Build / deploy')).toBe('v2-build-deploy');
    expect(chatTitleSlug('???')).toBe('');
  });
});

describe('linkChatFolderTitle', () => {
  let chatsDir: string;
  let folder: string;

  beforeEach(async () => {
    chatsDir = await mkdtemp(join(tmpdir(), 'chats-'));
    folder = join(chatsDir, '2026-11-08-a1b2');
    await mkdir(folder);
  });

  afterEach(async () => {
    await rm(chatsDir, { recursive: true, force: true });
  });

  it('links the title to the chat folder, moves the link on a new title, and never renames the folder', async () => {
    expect(await linkChatFolderTitle({ sessionPath: folder, chatsDir, title: 'Fortæl en vits' })).toBe('fortæl-en-vits');
    expect(await readlink(join(chatsDir, 'fortæl-en-vits'))).toBe('2026-11-08-a1b2');

    expect(await linkChatFolderTitle({ sessionPath: folder, chatsDir, title: 'Vejret i morgen' })).toBe('vejret-i-morgen');
    expect((await readdir(chatsDir)).sort()).toEqual(['2026-11-08-a1b2', 'vejret-i-morgen']);
    expect((await lstat(folder)).isDirectory()).toBe(true);
  });

  it('gives a taken name a number and leaves other chats\' links alone', async () => {
    await mkdir(join(chatsDir, '2026-11-07-zzzz'));
    await symlink('2026-11-07-zzzz', join(chatsDir, 'hej'), 'dir');

    expect(await linkChatFolderTitle({ sessionPath: folder, chatsDir, title: 'Hej' })).toBe('hej-2');
    expect(await readlink(join(chatsDir, 'hej'))).toBe('2026-11-07-zzzz');
  });

  it('does nothing for a session outside a chat folder', async () => {
    expect(await linkChatFolderTitle({ sessionPath: join(chatsDir, 'my-project'), chatsDir, title: 'Hej' })).toBeNull();
    expect(await linkChatFolderTitle({ sessionPath: '/elsewhere/2026-11-08-a1b2', chatsDir, title: 'Hej' })).toBeNull();
  });
});
