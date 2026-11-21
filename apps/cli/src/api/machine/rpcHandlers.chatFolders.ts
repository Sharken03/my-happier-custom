import { z } from 'zod';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { cleanupDeletedChatFolder } from '@/daemon/chatFolders/cleanupDeletedChatFolder';
import { logger } from '@/ui/logger';

import type { RpcHandlerRegistrar } from '../rpc/types';

const ChatFolderCleanupRequestSchema = z.object({
  sessionPath: z.string().min(1),
});

export type ChatFolderCleanupResult = Readonly<{
  success: boolean;
  removed: boolean;
  error?: string;
}>;

/**
 * The app tells the machine about a chat it deleted, so the daemon can remove what it left in the
 * chat's own folder. The daemon owns that rule: it only removes a folder it named for a chat and
 * only when nothing but its own entries (repository, uploads, ignore rule) is in it.
 */
export function registerMachineChatFolderRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  chatsDir: string | null;
}>): void {
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_CHAT_FOLDER_CLEANUP, async (raw: unknown): Promise<ChatFolderCleanupResult> => {
    const parsed = ChatFolderCleanupRequestSchema.safeParse(raw);
    if (!parsed.success) return { success: false, removed: false, error: 'invalid_parameters' };
    if (!params.chatsDir) return { success: false, removed: false, error: 'chats_dir_unset' };

    try {
      const removed = await cleanupDeletedChatFolder({ sessionPath: parsed.data.sessionPath, chatsDir: params.chatsDir });
      return { success: true, removed };
    } catch (error) {
      logger.warnFile('[MACHINE RPC] Could not clean up a deleted chat folder', {
        sessionPath: parsed.data.sessionPath,
        error: String(error),
      });
      return { success: false, removed: false, error: 'cleanup_failed' };
    }
  });
}
