/**
 * Local mirror of Happier's ReviewFindingsV2 contract.
 *
 * Copied field-for-field (required fields, enum value sets, optional/defaulted
 * fields) from the current on-disk source:
 *   - packages/protocol/src/structuredMessages/reviewFindingsV2.ts
 *   - packages/protocol/src/structuredMessages/reviewFindingsV1.ts (triage overlay)
 *   - packages/protocol/src/reviews/ReviewFinding.ts
 *   - packages/protocol/src/reviews/ReviewQuestion.ts
 *   - packages/protocol/src/reviews/ReviewAssumption.ts
 *
 * Deliberate divergences (documented, not silent):
 *  1. Happier wraps every schema in `lazySchema(...)`, a lazy-initialization
 *     proxy that exists only to keep the protocol package's import cost down.
 *     It has no observable effect on `.parse`/`.safeParse`; this package uses
 *     plain zod objects instead.
 *  2. `ExecutionRunStructuredRunRefSchema` mirrors only the REQUIRED fields
 *     (`runId`, `callId`, `backendId`). The optional `backendTarget` and
 *     `retentionPolicy` fields pass through unvalidated, because pi-review
 *     never writes them and mirroring them would drag two more protocol
 *     sub-schemas into this standalone package. Happier's own parser re-validates
 *     them fully when a finding is published through the bridge.
 *  3. `ReviewResolutionUpdateSchema` / `mergeReviewResolutionUpdate` are not
 *     mirrored: pi-review emits no `resolution` overlay and never merges one.
 */
import { z } from 'zod';

export const ReviewFindingSeveritySchema = z.enum([
  'blocker',
  'high',
  'medium',
  'low',
  'nit',
]);
export type ReviewFindingSeverity = z.infer<typeof ReviewFindingSeveritySchema>;

export const ReviewFindingCategorySchema = z.enum([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'testing',
  'style',
  'docs',
]);
export type ReviewFindingCategory = z.infer<typeof ReviewFindingCategorySchema>;

export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: ReviewFindingSeveritySchema,
  category: ReviewFindingCategorySchema,
  filePath: z.string().min(1).optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1).optional(),
  evidence: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  suggestion: z.string().min(1).optional(),
  patch: z.string().min(1).optional(),
  // Opaque anchor hash (workspace anchor `line-content-hash-v1`), see ReviewFinding.ts.
  lineHash: z.string().min(1).optional(),
  lineHashAlgorithm: z.string().min(1).optional(),
}).passthrough();

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewAssumptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  findingIds: z.array(z.string().min(1)).optional(),
}).passthrough();

export const ReviewQuestionStatusSchema = z.enum([
  'open',
  'answered',
  'superseded',
]);

export const ReviewQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  findingIds: z.array(z.string().min(1)).optional(),
  status: ReviewQuestionStatusSchema,
}).passthrough();

export const ReviewTriageStatusSchema = z.enum([
  'accept',
  'reject',
  'defer',
  'needs_refinement',
]);

export const ReviewTriageOverlaySchema = z.object({
  findings: z.array(z.object({
    id: z.string().min(1),
    status: ReviewTriageStatusSchema,
    comment: z.string().min(1).optional(),
  }).passthrough()),
}).passthrough();

export const ReviewPublicationOverlaySchema = z.object({
  findings: z.array(z.object({
    id: z.string().min(1),
    published: z.boolean(),
    publishedAtMs: z.number().int().nonnegative().optional(),
    publishedMessageRef: z.string().min(1).optional(),
  }).passthrough()),
}).passthrough();

export const ReviewResolutionStateSchema = z.enum([
  'open',
  'applying',
  'fixed',
  'still_present',
  'regressed',
  'wontfix',
]);

export const ReviewResolutionOverlaySchema = z.object({
  findings: z.array(z.object({
    id: z.string().min(1),
    state: ReviewResolutionStateSchema,
    updatedAtMs: z.number().int().nonnegative().optional(),
    note: z.string().min(1).optional(),
  }).passthrough()),
}).passthrough();

/**
 * Required fields only (see header note). `.passthrough()` keeps the optional
 * `backendTarget`/`retentionPolicy` fields accepted-but-unvalidated.
 */
export const ExecutionRunStructuredRunRefSchema = z.object({
  runId: z.string().min(1),
  callId: z.string().min(1),
  backendId: z.string().min(1),
}).passthrough();

export const ReviewFindingsV2Schema = z.object({
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
}).passthrough();

export type ReviewFindingsV2 = z.infer<typeof ReviewFindingsV2Schema>;

export function parseReviewFindingsV2(payload: unknown): ReviewFindingsV2 | null {
  const parsed = ReviewFindingsV2Schema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data;
}
