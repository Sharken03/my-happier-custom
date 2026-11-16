import { z } from 'zod';
import { lazySchema } from '../lazySchema.js';

export const ReviewFindingSeveritySchema = lazySchema(() => z.enum([
  'blocker',
  'high',
  'medium',
  'low',
  'nit',
]));
export type ReviewFindingSeverity = z.infer<typeof ReviewFindingSeveritySchema>;

export const ReviewFindingCategorySchema = lazySchema(() => z.enum([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'testing',
  'style',
  'docs',
]));
export type ReviewFindingCategory = z.infer<typeof ReviewFindingCategorySchema>;

export const ReviewFindingSchema = lazySchema(() => z.object({
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
  // Opaque hash of the anchored line, used only to re-anchor the finding after
  // the file moved. It is the workspace anchor hash (`line-content-hash-v1`,
  // `lh1:` + 16 hex, FNV-1a) so a finding re-verifies with the same code as a
  // workspace anchor; callers must still treat it as an opaque token.
  lineHash: z.string().min(1).optional(),
  // Algorithm identifier for `lineHash`. Currently `line-content-hash-v1`,
  // i.e. `computeLineContentHashV1` from workspace/anchors/v1.
  lineHashAlgorithm: z.string().min(1).optional(),
}).passthrough());

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewFindingId = string;
