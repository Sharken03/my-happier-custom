import { z } from 'zod';

import { lazySchema } from './lazySchema.js';

/**
 * Pi chat changes: files a Pi chat (and its subagents) changed outside any git repository.
 * A Pi extension keeps a copy of each file as it was before the chat's first change; the Pi
 * session answers `pi.chatChanges.list` and `pi.chatChanges.diff` from that store.
 */

/** Largest before or current text the session reads or returns, in bytes. */
export const PI_CHAT_CHANGES_TEXT_MAX_BYTES = 2 * 1024 * 1024;

export const PiChatChangesListRequestSchema = lazySchema(() => z.object({}).passthrough());
export type PiChatChangesListRequest = z.infer<typeof PiChatChangesListRequestSchema>;

export const PiChatChangesFileSchema = lazySchema(() => z.object({
  path: z.string(),
  created: z.boolean(),
  tooLarge: z.boolean(),
  /** The file is gone now. */
  deleted: z.boolean(),
  /** Lines of the net diff, before -> now. A file back to its before state has 0/0. */
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  /** Time of the last change, in ms. */
  updatedAt: z.number(),
}));
export type PiChatChangesFile = z.infer<typeof PiChatChangesFileSchema>;

const PiChatChangesErrorSchema = lazySchema(() => z.object({ ok: z.literal(false), error: z.string() }));

export const PiChatChangesListResponseSchema = lazySchema(() => z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), files: z.array(PiChatChangesFileSchema) }),
  PiChatChangesErrorSchema,
]));
export type PiChatChangesListResponse = z.infer<typeof PiChatChangesListResponseSchema>;

export const PiChatChangesDiffRequestSchema = lazySchema(() => z.object({ path: z.string().min(1) }));
export type PiChatChangesDiffRequest = z.infer<typeof PiChatChangesDiffRequestSchema>;

export const PiChatChangesDiffResponseSchema = lazySchema(() => z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    path: z.string(),
    /** Text before the first change; null when the file was created, too large or binary. */
    before: z.string().nullable(),
    /** Text on disk now; null when the file is gone, too large or binary. */
    after: z.string().nullable(),
    created: z.boolean(),
    tooLarge: z.boolean(),
    binary: z.boolean(),
  }),
  PiChatChangesErrorSchema,
]));
export type PiChatChangesDiffResponse = z.infer<typeof PiChatChangesDiffResponseSchema>;
