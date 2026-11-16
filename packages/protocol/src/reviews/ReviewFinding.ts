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
  // the file moved. The value is opaque: do not parse or validate its format,
  // because a format change must not break stored payloads. The producer is
  // `computeLineContentHashV1` in `workspace/anchors/v1.ts`. The pair
  // (`lineHash` + `lineHashAlgorithm`) is advisory.
  lineHash: z.string().min(1).optional(),
  // Algorithm identifier for `lineHash`, naming the producer that computed it
  // (currently `computeLineContentHashV1` in `workspace/anchors/v1.ts`). Advisory.
  lineHashAlgorithm: z.string().min(1).optional(),
}).passthrough());

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewFindingId = string;
