import { describe, expect, it } from 'vitest';

import { ReviewStartInputSchema } from './reviewStart.js';
import {
  ReviewModelPolicySchema,
  resolveReviewCallSitePolicyFlagMapping,
  resolveReviewModelPolicy,
  type ReviewModelPolicy,
} from './reviewModelPolicy.js';

const FIXED_ENGINE: ReviewModelPolicy = { kind: 'fixed', modelId: 'engine-model' };
const FIXED_ACCOUNT: ReviewModelPolicy = { kind: 'fixed', modelId: 'account-model' };
const DEPTH_POLICY: ReviewModelPolicy = {
  kind: 'depth',
  fast: { modelId: 'ds-flash', reasoningEffort: 'low' },
  deep: { modelId: 'ds-pro', reasoningEffort: 'high' },
  depthDefault: 'deep',
};

describe('ReviewModelPolicySchema', () => {
  it('defaults modelPolicy to inherit on ReviewStartInput', () => {
    const parsed = ReviewStartInputSchema.parse({
      engineIds: ['codex'],
      base: { kind: 'none' },
    });

    expect(parsed.modelPolicy).toEqual({ kind: 'inherit' });
  });

  it('accepts a fixed policy', () => {
    const parsed = ReviewModelPolicySchema.parse({ kind: 'fixed', modelId: 'ds-pro' });
    expect(parsed).toEqual({ kind: 'fixed', modelId: 'ds-pro' });
  });

  it('defaults depthDefault to deep inside a depth policy', () => {
    const parsed = ReviewModelPolicySchema.parse({
      kind: 'depth',
      fast: { modelId: 'ds-flash' },
      deep: { modelId: 'ds-pro' },
    });

    expect(parsed.depthDefault).toBe('deep');
  });

  it('rejects an unknown policy kind', () => {
    expect(ReviewModelPolicySchema.safeParse({ kind: 'nope' }).success).toBe(false);
  });

  it('rejects a fixed policy without a modelId', () => {
    expect(ReviewModelPolicySchema.safeParse({ kind: 'fixed' }).success).toBe(false);
  });

  it('rejects a depth policy without its fast/deep refs', () => {
    expect(ReviewModelPolicySchema.safeParse({ kind: 'depth', depthDefault: 'fast' }).success).toBe(false);
  });
});

describe('resolveReviewModelPolicy', () => {
  it('falls back to inherit when nothing is configured', () => {
    expect(resolveReviewModelPolicy({})).toEqual({ policy: { kind: 'inherit' }, source: 'inherit' });
  });

  it('prefers call-site over engine and account', () => {
    const result = resolveReviewModelPolicy({
      policy: { kind: 'fixed', modelId: 'call-model' },
      enginePolicy: FIXED_ENGINE,
      accountPolicy: FIXED_ACCOUNT,
    });

    expect(result).toEqual({
      policy: { kind: 'fixed', modelId: 'call-model' },
      source: 'call_site',
      modelId: 'call-model',
      reasoningEffort: undefined,
    });
  });

  it('prefers engine over account when call-site inherits', () => {
    const result = resolveReviewModelPolicy({
      policy: { kind: 'inherit' },
      enginePolicy: FIXED_ENGINE,
      accountPolicy: FIXED_ACCOUNT,
    });

    expect(result).toEqual({
      policy: FIXED_ENGINE,
      source: 'engine',
      modelId: 'engine-model',
      reasoningEffort: undefined,
    });
  });

  it('uses account when call-site and engine inherit', () => {
    const result = resolveReviewModelPolicy({
      policy: { kind: 'inherit' },
      enginePolicy: { kind: 'inherit' },
      accountPolicy: FIXED_ACCOUNT,
    });

    expect(result).toEqual({
      policy: FIXED_ACCOUNT,
      source: 'account',
      modelId: 'account-model',
      reasoningEffort: undefined,
    });
  });

  it('skips inherit sources and an absent engine policy', () => {
    const result = resolveReviewModelPolicy({
      policy: { kind: 'inherit' },
      enginePolicy: null,
      accountPolicy: FIXED_ACCOUNT,
    });

    expect(result.source).toBe('account');
    expect(result.modelId).toBe('account-model');
  });

  it('resolves a depth policy to its deep model by default', () => {
    const result = resolveReviewModelPolicy({ policy: DEPTH_POLICY });

    expect(result).toEqual({
      policy: DEPTH_POLICY,
      source: 'call_site',
      depth: 'deep',
      modelId: 'ds-pro',
      reasoningEffort: 'high',
    });
  });

  it('resolves a depth policy to its fast model when depthDefault says fast', () => {
    const result = resolveReviewModelPolicy({
      policy: { ...DEPTH_POLICY, depthDefault: 'fast' },
    });

    expect(result.depth).toBe('fast');
    expect(result.modelId).toBe('ds-flash');
    expect(result.reasoningEffort).toBe('low');
  });
});

describe('resolveReviewCallSitePolicyFlagMapping', () => {
  it('maps --model to a fixed policy kind', () => {
    expect(resolveReviewCallSitePolicyFlagMapping({ model: ' ds-pro ' })).toEqual({
      ok: true,
      kind: 'fixed',
      modelId: 'ds-pro',
    });
  });

  it('maps --depth to a depth policy kind', () => {
    expect(resolveReviewCallSitePolicyFlagMapping({ depth: 'fast' })).toEqual({
      ok: true,
      kind: 'depth',
      depthDefault: 'fast',
    });
  });

  it('maps no flags to inherit', () => {
    expect(resolveReviewCallSitePolicyFlagMapping({})).toEqual({ ok: true, kind: 'inherit' });
  });

  it('errors with review_model_policy_conflict when both flags are supplied', () => {
    expect(resolveReviewCallSitePolicyFlagMapping({ model: 'ds-pro', depth: 'fast' })).toEqual({
      ok: false,
      code: 'review_model_policy_conflict',
    });
  });
});
