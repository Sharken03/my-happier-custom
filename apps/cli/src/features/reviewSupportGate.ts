/**
 * The single switch for the agent-review support system.
 *
 * Everything this fork added for review support lives behind the `reviews.support` feature, which defaults
 * to OFF (`HAPPIER_FEATURE_REVIEW_SUPPORT__ENABLED` must be set to 1). The reason is removability rather
 * than caution: the feature is a self-contained addition to Happier, and it has to be possible to take it
 * out again without archaeology. See REVIEW-SUPPORT.md at the repository root, which lists every file the
 * system touches.
 *
 * Refusals use `execution_run_not_allowed`, the same code the outward-write gate uses: from the caller's
 * side "this build does not offer review support" and "you are not allowed to publish" are one answer.
 */
import type { FeatureDecision } from '@happier-dev/protocol';

import { resolveCliFeatureDecision } from './featureDecisionService';

export const REVIEW_SUPPORT_FEATURE_ID = 'reviews.support' as const;

export function resolveReviewSupportFeatureDecision(env: NodeJS.ProcessEnv = process.env): FeatureDecision {
    return resolveCliFeatureDecision({ featureId: REVIEW_SUPPORT_FEATURE_ID, env });
}

export function isReviewSupportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return resolveReviewSupportFeatureDecision(env).enabled;
}
