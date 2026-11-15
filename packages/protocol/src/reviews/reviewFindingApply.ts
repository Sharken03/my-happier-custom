import { z } from 'zod';

import { ExecutionRunActionPermissionModeSchema } from '../actions/executionRunActionPermissionMode.js';
import { lazySchema } from '../lazySchema.js';

/**
 * Input for the `review.finding.apply` run action: hand selected review
 * findings to a write session.
 *
 * `permissionMode` defaults to `read_only` (an applying session must not write
 * without an explicit escalation) and may be escalated by the caller, mirroring
 * `subagents.plan.start` rather than `subagents.delegate.start` (which carries
 * no default).
 */
export const ReviewFindingApplyInputSchema = lazySchema(() => z.object({
  runId: z.string().min(1),
  findingIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(['send_to_session', 'spawn_session']),
  includePatch: z.boolean().optional(),
  permissionMode: ExecutionRunActionPermissionModeSchema.default('read_only'),
}).passthrough());
export type ReviewFindingApplyInput = z.infer<typeof ReviewFindingApplyInputSchema>;
