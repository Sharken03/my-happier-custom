import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandler, RpcHandlerRegistrar } from '../rpc/types';
import { registerMachineChatFolderRpcHandlers } from './rpcHandlers.chatFolders';

/** Keeps the registered handlers so a test can call them the way the machine does. */
function createRegistrar(): RpcHandlerRegistrar & { handlers: Map<string, RpcHandler> } {
  const handlers = new Map<string, RpcHandler>();
  return {
    handlers,
    registerHandler: <TRequest, TResponse>(method: string, handler: RpcHandler<TRequest, TResponse>) => {
      handlers.set(method, handler as RpcHandler);
    },
  };
}

describe('registerMachineChatFolderRpcHandlers', () => {
  let chatsDir: string;

  beforeEach(async () => {
    chatsDir = await mkdtemp(join(tmpdir(), 'chats-rpc-'));
  });

  afterEach(async () => {
    await rm(chatsDir, { recursive: true, force: true });
  });

  it('cleans the chat folder the app reports as deleted', async () => {
    const folder = join(chatsDir, '2026-11-15-724p');
    await mkdir(join(folder, '.happier', 'uploads'), { recursive: true });
    await writeFile(join(folder, '.gitignore'), '/.happier/uploads/\n');
    const registrar = createRegistrar();
    registerMachineChatFolderRpcHandlers({ rpcHandlerManager: registrar, chatsDir });

    const handler = registrar.handlers.get(RPC_METHODS.DAEMON_CHAT_FOLDER_CLEANUP);
    expect(handler).toBeDefined();
    await expect(handler?.({ sessionPath: folder })).resolves.toEqual({ success: true, removed: true });
    expect(await readdir(chatsDir)).toEqual([]);
  });

  it('keeps a folder that still holds the chat\'s work, and refuses folders the daemon does not own', async () => {
    const kept = join(chatsDir, '2026-11-15-keep');
    await mkdir(kept);
    await writeFile(join(kept, 'notes.md'), 'x');
    const registrar = createRegistrar();
    registerMachineChatFolderRpcHandlers({ rpcHandlerManager: registrar, chatsDir });
    const handler = registrar.handlers.get(RPC_METHODS.DAEMON_CHAT_FOLDER_CLEANUP);

    await expect(handler?.({ sessionPath: kept })).resolves.toEqual({ success: true, removed: false });
    await expect(handler?.({ sessionPath: '/tmp/not-a-chat-folder' })).resolves.toEqual({ success: true, removed: false });
    expect(await readdir(chatsDir)).toEqual(['2026-11-15-keep']);
  });

  it('answers an unusable request instead of throwing', async () => {
    const registrar = createRegistrar();
    registerMachineChatFolderRpcHandlers({ rpcHandlerManager: registrar, chatsDir: null });
    const handler = registrar.handlers.get(RPC_METHODS.DAEMON_CHAT_FOLDER_CLEANUP);

    await expect(handler?.({ sessionPath: '' })).resolves.toMatchObject({ success: false, error: 'invalid_parameters' });
    await expect(handler?.(null)).resolves.toMatchObject({ success: false, error: 'invalid_parameters' });
    await expect(handler?.({ sessionPath: join(chatsDir, '2026-11-15-nope') })).resolves.toMatchObject({
      success: false,
      error: 'chats_dir_unset',
    });
  });
});
