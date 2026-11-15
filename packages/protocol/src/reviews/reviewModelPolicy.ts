import { z } from 'zod';
import { lazySchema } from '../lazySchema.js';

/**
 * Canonical, cross-surface contract for which model a review run uses:
 * `inherit` (backend default), `fixed` (one model), or `depth` (a fast/deep pair).
 *
 * Precedence between sources is implemented once, in `resolveReviewModelPolicy`,
 * never per surface.
 */

export const ReviewModelRefSchema = lazySchema(() => z.object({
  modelId: z.string().trim().min(1).max(1000),
  reasoningEffort: z.string().trim().min(1).max(1000).optional(),
}));
export type ReviewModelRef = z.infer<typeof ReviewModelRefSchema>;

export const ReviewModelPolicySchema = lazySchema(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }),
  ReviewModelRefSchema.extend({ kind: z.literal('fixed') }),
  z.object({
    kind: z.literal('depth'),
    fast: ReviewModelRefSchema,
    deep: ReviewModelRefSchema,
    // The single home for the fast/deep default (Decisions Q3). User-chosen,
    // never auto-selected from diff size.
    depthDefault: z.enum(['fast', 'deep']).default('deep'),
  }),
]));
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

/**
 * The subset of the account review-model settings the resolver reads: the account default and
 * the per-engine overrides. Kept structural so this module does not depend on the account-settings
 * owner (which imports `ReviewModelPolicySchema` back).
 */
export type ReviewModelPolicySettings = Readonly<{
  modelPolicy?: ReviewModelPolicy | null;
  engines?: Readonly<Record<string, Readonly<{ modelPolicy?: ReviewModelPolicy | null }>>>;
}>;

/**
 * The fast/deep refs a call-site `--depth` flag borrows from the configured account/engine
 * policies. First `depth` policy wins: account default, then any engine override. Null when no
 * depth policy is configured anywhere, in which case a bare `--depth` flag cannot name a pair.
 */
export function resolveReviewModelPolicyDepthRefs(
  settings: ReviewModelPolicySettings | null | undefined,
): Readonly<{ fast: ReviewModelRef; deep: ReviewModelRef }> | null {
  const account = settings?.modelPolicy;
  if (account?.kind === 'depth') return { fast: account.fast, deep: account.deep };
  const engines = settings?.engines;
  if (engines) {
    for (const engineId of Object.keys(engines)) {
      const policy = engines[engineId]?.modelPolicy;
      if (policy?.kind === 'depth') return { fast: policy.fast, deep: policy.deep };
    }
  }
  return null;
}
