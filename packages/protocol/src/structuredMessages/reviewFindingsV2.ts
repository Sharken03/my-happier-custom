import { z } from 'zod';

import { ReviewAssumptionSchema } from '../reviews/ReviewAssumption.js';
import { ReviewFindingSchema } from '../reviews/ReviewFinding.js';
import { ReviewQuestionSchema } from '../reviews/ReviewQuestion.js';
import { ReviewTriageOverlaySchema } from './reviewFindingsV1.js';
import { ExecutionRunStructuredRunRefSchema } from './executionRunStructuredRunRef.js';
import { lazySchema } from '../lazySchema.js';

export const ReviewPublicationOverlaySchema = lazySchema(() => z.object({
  findings: z.array(z.object({
    id: z.string().min(1),
    published: z.boolean(),
    publishedAtMs: z.number().int().nonnegative().optional(),
    publishedMessageRef: z.string().min(1).optional(),
  }).passthrough()),
}).passthrough());
export type ReviewPublicationOverlay = z.infer<typeof ReviewPublicationOverlaySchema>;

export const ReviewResolutionStateSchema = lazySchema(() => z.enum([
  'open',
  'applying',
  'fixed',
  'still_present',
  'regressed',
  'wontfix',
]));
export type ReviewResolutionState = z.infer<typeof ReviewResolutionStateSchema>;

// Resolution is a per-finding state overlay. A finding with no entry is
// implicitly `open`; an entry records an explicit state change. `open` is the
// only state that is also expressible explicitly (redundant but valid).
export const ReviewResolutionOverlaySchema = lazySchema(() => z.object({
  findings: z.array(z.object({
    id: z.string().min(1),
    state: ReviewResolutionStateSchema,
    updatedAtMs: z.number().int().nonnegative().optional(),
    note: z.string().min(1).optional(),
  }).passthrough()),
}).passthrough());
export type ReviewResolutionOverlay = z.infer<typeof ReviewResolutionOverlaySchema>;

// Input shape for the `review.resolve` run action: one state applied to a set
// of finding ids.
export const ReviewResolutionUpdateSchema = lazySchema(() => z.object({
  state: ReviewResolutionStateSchema,
  findingIds: z.array(z.string().min(1)),
  updatedAtMs: z.number().int().nonnegative().optional(),
  note: z.string().min(1).optional(),
}).passthrough());
export type ReviewResolutionUpdate = z.infer<typeof ReviewResolutionUpdateSchema>;

/**
 * Pure helper that merges a resolution update into a payload. Entries for the
 * updated ids are replaced; all other resolution entries (and every other
 * payload field) are preserved. Applying the same update twice is idempotent.
 */
export function mergeReviewResolutionUpdate(
  payload: ReviewFindingsV2,
  update: ReviewResolutionUpdate,
): ReviewFindingsV2 {
  const entries = new Map<string, ReviewResolutionOverlay['findings'][number]>(
    (payload.resolution?.findings ?? []).map((entry) => [entry.id, entry]),
  );
  for (const id of update.findingIds) {
    entries.set(id, {
      id,
      state: update.state,
      ...(update.updatedAtMs !== undefined ? { updatedAtMs: update.updatedAtMs } : {}),
      ...(update.note !== undefined ? { note: update.note } : {}),
    });
  }
  return {
    ...payload,
    resolution: { findings: [...entries.values()] },
  };
}

export const ReviewFindingsV2Schema = lazySchema(() => z.object({
  runRef: ExecutionRunStructuredRunRefSchema,
  summary: z.string().min(1),
  overviewMarkdown: z.string().min(1),
  findings: z.array(ReviewFindingSchema),
  questions: z.array(ReviewQuestionSchema).default([]),
  assumptions: z.array(ReviewAssumptionSchema).default([]),
  triage: ReviewTriageOverlaySchema.optional(),
  publication: ReviewPublicationOverlaySchema.optional(),
  resolution: ReviewResolutionOverlaySchema.optional(),
  limits: z.object({
    findingsTruncated: z.boolean().optional(),
    patchesTruncated: z.boolean().optional(),
  }).passthrough().optional(),
  generatedAtMs: z.number().int().nonnegative(),
}).passthrough());

export type ReviewFindingsV2 = z.infer<typeof ReviewFindingsV2Schema>;

export function parseReviewFindingsV2(payload: unknown): ReviewFindingsV2 | null {
  const parsed = ReviewFindingsV2Schema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data;
}
