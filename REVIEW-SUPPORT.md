# Review support (fork addition)

This fork adds agent review support to Happier: a review run can publish its findings to a pull request and
hand selected findings to a fix session, and Pi ships its own review engine (`packages/pi-review`).

It is a **self-contained addition**, deliberately built so it can be removed again in one pass. This file is
the contract for that: it names the switch, every file the system touches, and the exact removal recipe.
If the system is removed, this file goes with it.

## 1. The switch

Everything review related sits behind the feature `reviews.support`:

| | |
| --- | --- |
| Feature id | `reviews.support` |
| Default | **off** (`fail_closed`) |
| Turn on | `HAPPIER_FEATURE_REVIEW_SUPPORT__ENABLED=1` |
| Resolver | `apps/cli/src/features/featureLocalPolicy.ts`, `apps/cli/src/features/reviewSupportGate.ts` |
| Catalog entry | `packages/protocol/src/features/catalog.ts` |

While it is off:

- starting a run with `intent: 'review'` is refused with `execution_run_not_allowed`;
- `review.publish` is refused (independent of the `scm.writeOperations` gate, which stays as it was);
- `review.finding.apply` is refused, even with a valid `approvalGrant`;
- the review actions stay discoverable-only for session agents and MCP, and `review.finding.apply` is not a
  voice surface.

Nothing else in Happier changes behaviour while the switch is off: no existing code path reads a review
finding, and no existing surface calls review publish or fix.

## 2. New files (37)

Deleting these removes the feature. No other file imports them except the modified files listed in §3.

- `.github/build-8t/protocol-tests.txt`
- `apps/cli/src/agent/executionRuns/runtime/executionRunApplyAction.test.ts`
- `apps/cli/src/agent/executionRuns/runtime/executionRunReviewFindingApply.test.ts`
- `apps/cli/src/agent/executionRuns/runtime/executionRunReviewFindingApply.ts`
- `apps/cli/src/agent/executionRuns/runtime/executionRunReviewPublish.test.ts`
- `apps/cli/src/agent/executionRuns/runtime/executionRunReviewPublish.ts`
- `apps/cli/src/cli/commands/session/review/fix.integration.test.ts`
- `apps/cli/src/cli/commands/session/review/fix.ts`
- `apps/cli/src/cli/commands/session/review/publish.integration.test.ts`
- `apps/cli/src/cli/commands/session/review/publish.ts`
- `apps/cli/src/cli/commands/session/review/shared.ts`
- `apps/cli/src/features/reviewSupportGate.ts`
- `REVIEW-SUPPORT.md` (this file)
- `apps/ui/sources/sync/domains/input/reviewFindings/buildReviewFindingIndex.test.ts`
- `apps/ui/sources/sync/domains/input/reviewFindings/buildReviewFindingIndex.ts`
- `apps/ui/sources/sync/domains/input/reviewFindings/filterOpenReviewFindings.test.ts`
- `apps/ui/sources/sync/domains/input/reviewFindings/filterOpenReviewFindings.ts`
- `apps/ui/sources/sync/domains/input/reviewFindings/mergeReviewFindingIndex.test.ts`
- `apps/ui/sources/sync/domains/input/reviewFindings/mergeReviewFindingIndex.ts`
- `apps/ui/sources/sync/domains/input/reviewFindings/reviewFindingIndexTypes.ts`
- `packages/pi-review/README.md`
- `packages/pi-review/package.json`
- `packages/pi-review/src/diffScope.ts`
- `packages/pi-review/src/index.ts`
- `packages/pi-review/src/modelPolicy.ts`
- `packages/pi-review/src/prompt.ts`
- `packages/pi-review/src/review.ts`
- `packages/pi-review/src/schema.ts`
- `packages/pi-review/test/reviewFindingsV2.minimal.json`
- `packages/pi-review/test/schema.test.ts`
- `packages/protocol/src/reviews/ReviewFinding.test.ts`
- `packages/protocol/src/reviews/reviewFindingApply.ts`
- `packages/protocol/src/reviews/reviewModelPolicy.test.ts`
- `packages/protocol/src/reviews/reviewModelPolicy.ts`
- `packages/protocol/src/structuredMessages/reviewFindingsV2.contract.test.ts`
- `packages/protocol/src/structuredMessages/reviewFindingsV2.test.ts`
- `packages/protocol/src/structuredMessages/reviewPublishRequestV1.test.ts`

## 3. Modified files (52)

Each of these gained a review-support hunk; the rest of the file is untouched upstream code. To revert one,
take the upstream version and re-apply nothing — i.e. `git checkout <upstream-ref> -- <path>`, unless the file
also carries unrelated fork work (see the notes column).

- `.github/build-8t/cli-tests.txt`
- `.github/workflows/build-cli.yml`
- `apps/cli/src/agent/executionRuns/profiles/review/ReviewProfile.test.ts`
- `apps/cli/src/agent/executionRuns/profiles/review/ReviewProfile.ts`
- `apps/cli/src/agent/executionRuns/runtime/ExecutionRunManager.test.ts`
- `apps/cli/src/agent/executionRuns/runtime/ExecutionRunManager.ts`
- `apps/cli/src/agent/executionRuns/runtime/executionRunApplyAction.ts`
- `apps/cli/src/agent/executionRuns/runtime/executionRunTypes.ts`
- `apps/cli/src/agent/tools/happierTools/dispatchBuiltInHappierTool.test.ts`
- `apps/cli/src/agent/tools/happierTools/listBuiltInHappierTools.test.ts`
- `apps/cli/src/api/api.ts`
- `apps/cli/src/api/session/sessionClient.ts`
- `apps/cli/src/backends/pi/bridgeExtension/resolveHappyToolsBridgeBackendOptions.test.ts`
- `apps/cli/src/cli/commands/session/handleSessionCommand.ts`
- `apps/cli/src/cli/commands/session/review/start.ts`
- `apps/cli/src/features/featureLocalPolicy.ts`
- `apps/cli/src/rpc/handlers/executionRuns.feat.execution.runs.test.ts`
- `apps/cli/src/rpc/handlers/executionRuns.ts`
- `apps/cli/src/rpc/handlers/scm/registerScmPullRequestHandlers.ts`
- `apps/cli/src/scm/backends/git/backend.ts`
- `apps/cli/src/scm/backends/git/operations/pullRequestOperations.test.ts`
- `apps/cli/src/scm/backends/git/operations/pullRequestOperations.ts`
- `apps/cli/src/scm/hostingProviders/providers/githubCliAdapter.test.ts`
- `apps/cli/src/scm/hostingProviders/providers/githubCliAdapter.ts`
- `apps/cli/src/scm/hostingProviders/providers/githubRestAdapter.test.ts`
- `apps/cli/src/scm/hostingProviders/providers/githubRestAdapter.ts`
- `apps/cli/src/scm/hostingProviders/providers/gitlabCliAdapter.test.ts`
- `apps/cli/src/scm/hostingProviders/providers/gitlabCliAdapter.ts`
- `apps/cli/src/scm/hostingProviders/types.ts`
- `apps/cli/src/scm/rpc/__tests__/scmRpc.pullRequests.integration.test.ts`
- `apps/cli/src/scm/types.ts`
- `apps/docs/content/docs/code/diffs.mdx`
- `apps/docs/content/docs/code/review-comments.mdx`
- `packages/protocol/src/account/settings/accountSettings.test.ts`
- `packages/protocol/src/account/settings/accountSettings.ts`
- `packages/protocol/src/account/settings/index.ts`
- `packages/protocol/src/actions/actionExecutor.ts`
- `packages/protocol/src/actions/actionIds.ts`
- `packages/protocol/src/actions/actionSpecs.test.ts`
- `packages/protocol/src/actions/actionSpecs.ts`
- `packages/protocol/src/actions/actionToolExposure.test.ts`
- `packages/protocol/src/actions/actionToolExposure.ts`
- `packages/protocol/src/executionRuns.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/reviews/ReviewFinding.ts`
- `packages/protocol/src/reviews/reviewStart.ts`
- `packages/protocol/src/rpc.scm.test.ts`
- `packages/protocol/src/rpc.ts`
- `packages/protocol/src/scmPullRequests.contract.test.ts`
- `packages/protocol/src/scmPullRequests.ts`
- `packages/protocol/src/structuredMessages/reviewFindingsV2.ts`
- `packages/protocol/src/structuredMessages/reviewPublishRequestV1.ts`

## 4. Removing it

1. `git revert` the review-support commit chain, or reverse-apply it:

   ```bash
   git revert --no-commit <first>..<last>   # then commit
   ```

   The chain is listed in `../chats/2026-11-15-ta1e/plan-review-support.md` §10–11; every commit subject starts
   with `feat(reviews)`, `fix(reviews)`, `feat(scm)`, `fix(scm)`, `fix(gitlab)`, `feat(runs)`, `fix(actions)`,
   `feat(actions)`, `ci(cli)`, `ci:` or `test(reviews)`.
2. Or, by hand, in this order — the order matters only for the typecheck being green between steps:
   1. delete the files in §2;
   2. remove the review branches (`review.publish`, `review.finding.apply`) from
      `apps/cli/src/agent/executionRuns/runtime/executionRunApplyAction.ts`;
   3. remove the `reviews.support` entry from `packages/protocol/src/features/catalog.ts` and
      `apps/cli/src/features/featureLocalPolicy.ts`, and delete `reviewSupportGate.ts`;
   4. remove the review entries from `packages/protocol/src/actions/actionSpecs.ts`, `actionIds.ts`,
      `actionToolExposure.ts` and their exports in `packages/protocol/src/index.ts`;
   5. remove the review RPC method and the `ScmPullRequestCreateReview*` schemas
      (`packages/protocol/src/rpc.ts`, `scmPullRequests.ts`);
   6. remove the review lines from `.github/build-8t/cli-tests.txt` and `protocol-tests.txt`;
   7. revert the review docs (`apps/docs/content/docs/code/review-comments.mdx`) and the related-links block
      in `diffs.mdx` if it was added by that change.
3. Verify nothing is left:

   ```bash
   rg -n "reviews\.support|reviewSupportGate|review\.publish|review\.finding\.apply" \
     --glob '!node_modules' -l
   rg -n "pi-review|reviewFindingsV2|ReviewFinding" --glob '!node_modules' -l
   ```

   Both should return only files that legitimately remain (a removed system returns nothing).

## 5. What is verified, and what is not

CI covers: protocol schema/action tests, the CLI unit tests for publish/finding-apply, the GitLab and GitHub
adapter tests, and the two CLI integration tests for `session review publish|fix`. `apps/ui` is only
typechecked.

Not verified: no live GitHub/GitLab instance, and `packages/pi-review` has never gathered a real diff or called
a model. Provider assumptions (typed `gh`/`glab` JSON fields, GitHub inline comments with `REQUEST_CHANGES`,
GitLab `start_sha`) are therefore untested against the real APIs. See `plan-review-support.md` §11.6.
