import { lstat, readFile } from 'node:fs/promises';

import { authorizeFilesystemPath } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemPathAuthorization';
import { createSessionMediaAccessPolicy } from '@/session/sessionMedia/createSessionMediaAccessPolicy';
import { prepareSessionMediaImageForDisplay } from '@/session/sessionMedia/prepareSessionMediaImageForDisplay';

import type { HappierBuiltInToolDispatchResult } from './types';

/** Source files larger than this are not read. The shown image is bounded separately. */
export const SHOW_IMAGE_MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export type ShowImageToolArgs = Readonly<{ path: string; caption?: string }>;

function err(errorCode: string, error: string): HappierBuiltInToolDispatchResult {
  return { ok: false, errorCode, error };
}

/**
 * The show_image tool: read an image file the agent names and return it as an MCP image block.
 * Each provider's existing tool-result media extraction then stores the block as session media,
 * as it does for a `read` result with an image. The file must pass the session media access
 * policy (inside the session working directory) and must be a regular file.
 */
export function createShowImageToolHandler(params: Readonly<{
  resolveWorkingDirectory: () => string | null | undefined;
  maxSourceBytes?: number;
}>): (args: ShowImageToolArgs) => Promise<HappierBuiltInToolDispatchResult> {
  const maxSourceBytes = params.maxSourceBytes ?? SHOW_IMAGE_MAX_SOURCE_BYTES;
  return async (args) => {
    const workingDirectory = String(params.resolveWorkingDirectory() ?? '').trim();
    if (!workingDirectory) {
      return err('session_directory_unavailable', 'The session has no working directory, so show_image cannot resolve the path');
    }

    const authorization = authorizeFilesystemPath({
      targetPath: args.path,
      defaultDirectory: workingDirectory,
      accessPolicy: createSessionMediaAccessPolicy({ workingDirectory }),
    });
    if (!authorization.valid) {
      return err('image_path_denied', `${authorization.error}. show_image can show files inside ${workingDirectory} only.`);
    }
    const resolvedPath = authorization.resolvedPath;

    const fileStat = await lstat(resolvedPath).catch(() => null);
    if (!fileStat) return err('image_not_found', `No file at ${resolvedPath}`);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return err('image_not_a_file', `${resolvedPath} is not a regular file (symbolic links are not followed)`);
    }
    if (fileStat.size > maxSourceBytes) {
      return err('image_too_large', `${resolvedPath} has ${fileStat.size} bytes; the limit is ${maxSourceBytes}`);
    }

    const prepared = await prepareSessionMediaImageForDisplay(await readFile(resolvedPath));
    if (!prepared.ok) return err(prepared.code, prepared.error);
    const { image } = prepared;

    return {
      ok: true,
      result: {
        shown: true,
        path: resolvedPath,
        mimeType: image.mimeType,
        ...(image.sourceMimeType !== image.mimeType ? { sourceMimeType: image.sourceMimeType } : {}),
        width: image.width,
        height: image.height,
        ...(args.caption ? { caption: args.caption } : {}),
      },
      content: [{ type: 'image', data: image.bytes.toString('base64'), mimeType: image.mimeType }],
    };
  };
}
