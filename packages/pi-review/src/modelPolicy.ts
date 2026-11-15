/**
 * Vendored from packages/protocol/src/reviews/reviewModelPolicy.ts (current
 * on-disk source). Kept verbatim except for dropping `lazySchema(...)` (a
 * lazy-init proxy with no observable parse behaviour; see schema.ts header).
 */
import { z } from 'zod';

export const ReviewModelRefSchema = z.object({
  modelId: z.string().trim().min(1).max(1000),
  reasoningEffort: z.string().trim().min(1).max(1000).optional(),
});
export type ReviewModelRef = z.infer<typeof ReviewModelRefSchema>;

export const ReviewModelPolicySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }),
  ReviewModelRefSchema.extend({ kind: z.literal('fixed') }),
  z.object({
    kind: z.literal('depth'),
    fast: ReviewModelRefSchema,
    deep: ReviewModelRefSchema,
    // The single home for the fast/deep default (Happier Decisions Q3). User-chosen,
    // never auto-selected from diff size.
    depthDefault: z.enum(['fast', 'deep']).default('deep'),
  }),
]);
export type ReviewModelPolicy = z.infer<typeof ReviewModelPolicySchema>;

export type ReviewModelPolicySource = 'call_site' | 'engine' | 'account' | 'inherit';

export type ReviewModelPolicyResolution = Readonly<{
  policy: ReviewModelPolicy;
  /** For a `depth` policy: the side that applied. */
  depth?: 'fast' | 'deep';
  modelId?: string;
  reasoningEffort?: string;
  /** Which source won: call_site > engine > account > inherit. */
  source: ReviewModelPolicySource;
}>;

/**
 * Fold the three policy sources by precedence: call-site > engine > account > `inherit`.
 * Pure: model availability and its `inherit` fallback belong to the run-start path that owns
 * the model registry.
 */
export function resolveReviewModelPolicy(params: Readonly<{
  policy?: ReviewModelPolicy | null;
  enginePolicy?: ReviewModelPolicy | null;
  accountPolicy?: ReviewModelPolicy | null;
}>): ReviewModelPolicyResolution {
  const orderedSources: ReadonlyArray<Readonly<{
    source: ReviewModelPolicySource;
    policy: ReviewModelPolicy | null | undefined;
  }>> = [
    { source: 'call_site', policy: params.policy },
    { source: 'engine', policy: params.enginePolicy },
    { source: 'account', policy: params.accountPolicy },
  ];

  for (const entry of orderedSources) {
    if (!entry.policy || entry.policy.kind === 'inherit') continue;
    return resolveConcretePolicy(entry.policy, entry.source);
  }

  return { policy: { kind: 'inherit' }, source: 'inherit' };
}

function resolveConcretePolicy(
  policy: ReviewModelPolicy,
  source: ReviewModelPolicySource,
): ReviewModelPolicyResolution {
  switch (policy.kind) {
    case 'fixed':
      return {
        policy,
        source,
        modelId: policy.modelId,
        reasoningEffort: policy.reasoningEffort,
      };
    case 'depth': {
      const depth = policy.depthDefault;
      const ref = depth === 'fast' ? policy.fast : policy.deep;
      return {
        policy,
        source,
        depth,
        modelId: ref.modelId,
        reasoningEffort: ref.reasoningEffort,
      };
    }
    case 'inherit':
      // Unreachable: `resolveReviewModelPolicy` skips inherit before resolving.
      return { policy, source };
  }
}

export type ReviewCallSitePolicyFlagMapping =
  | Readonly<{ ok: true; kind: 'inherit' }>
  | Readonly<{ ok: true; kind: 'fixed'; modelId: string }>
  | Readonly<{ ok: true; kind: 'depth'; depthDefault: 'fast' | 'deep' }>
  | Readonly<{ ok: false; code: 'review_model_policy_conflict' }>;

/**
 * Map CLI review flags to policy kinds: `--model <id>` = `fixed`, `--depth fast|deep` = `depth`,
 * both together is an error — never a silent winner. A single flag cannot name the `depth` pair, so the
 * CLI surface combines this with the account/engine policy's refs.
 */
export function resolveReviewCallSitePolicyFlagMapping(params: Readonly<{
  model?: string | null;
  depth?: 'fast' | 'deep' | null;
}>): ReviewCallSitePolicyFlagMapping {
  const modelId = typeof params.model === 'string' ? params.model.trim() : '';
  const depth = params.depth ?? null;

  if (modelId.length > 0 && depth !== null) {
    return { ok: false, code: 'review_model_policy_conflict' };
  }
  if (modelId.length > 0) {
    return { ok: true, kind: 'fixed', modelId };
  }
  if (depth !== null) {
    return { ok: true, kind: 'depth', depthDefault: depth };
  }
  return { ok: true, kind: 'inherit' };
}
