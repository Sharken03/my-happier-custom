import { z } from 'zod';
import { lazySchema } from '@happier-dev/protocol';

export const PiBridgeToolDescriptorSchema = lazySchema(() => z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.string(), z.unknown()),
  call: z.object({
    toolName: z.string().min(1),
    actionId: z.string().min(1).nullable(),
  }).strict(),
}).strict());

export const PiBridgeSessionConfigSchema = lazySchema(() => z.object({
  v: z.literal(1),
  sessionId: z.string().min(1),
  directTools: z.array(PiBridgeToolDescriptorSchema),
  promptAddition: z.string(),
  /**
   * `text` goes out once as a hidden message after the first user message, unless the model has
   * already called `toolName`. Absent means no reminder.
   */
  sessionTitleReminder: z.object({
    text: z.string().min(1),
    toolName: z.string().min(1),
  }).strict().optional(),
  launch: z.object({
    filePath: z.string().min(1),
    argPrefix: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  }).strict(),
  /**
   * Pi's file descriptor of a pipe on which the host serves the tool calls itself
   * (PI_BRIDGE_HOST_TOOLS_FD). Absent means the extension starts `happier tools serve` from
   * `launch`, which also stays the fallback when the pipe fails.
   */
  hostToolsFd: z.number().int().min(3).optional(),
}).strict());

export type PiBridgeSessionConfig = z.infer<typeof PiBridgeSessionConfigSchema>;
