import chalk from 'chalk';

import type { Credentials } from '@/persistence';

import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { readCommandPositionals, readFlagValue, readIntFlagValue } from '@/cli/commands/shared/argvFlags';
import { fail } from '@happier-dev/cli-common/output';
import {
  executeRunServiceAction,
  expandFindingIds,
  fetchReviewStructuredMeta,
  resolveReviewFindings,
  resolveReviewRunId,
  resolveReviewSession,
} from './shared';

const USAGE = 'happier session review publish <session-id-or-prefix-or-tag> [--run <runId>] --findings <id1,id2|all> [--pr <number>] [--json]';

export async function cmdSessionReviewPublish(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<Credentials | null> }>,
): Promise<void> {
  const json = wantsJson(argv);
  const [idOrPrefix = ''] = readCommandPositionals(argv, {
    startIndex: 2,
    valueFlags: ['--run', '--findings', '--pr'],
  });
  if (!idOrPrefix) {
    throw new Error(`Usage: ${USAGE}`);
  }

  const runIdFlag = readFlagValue(argv, '--run');
  const findingsFlag = readFlagValue(argv, '--findings');
  const prNumber = readIntFlagValue(argv, '--pr', { min: 1 });

  if (findingsFlag === null || findingsFlag.trim().length === 0) {
    throw new Error(`Usage: ${USAGE}`);
  }

  const sessionCtx = await resolveReviewSession({
    json,
    kind: 'session_review_publish',
    idOrPrefix,
    readCredentialsFn: deps.readCredentialsFn,
  });
  if (!sessionCtx) return;
  const { sessionId, executor } = sessionCtx;

  const runResolution = await resolveReviewRunId({ executor, sessionId, explicitRunId: runIdFlag });
  if (!runResolution.ok) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_publish',
        error: { code: runResolution.code, message: runResolution.message },
      });
      return;
    }
    console.error(fail(runResolution.message));
    process.exit(1);
  }
  const runId = runResolution.runId;

  const metaResolution = await fetchReviewStructuredMeta({ executor, sessionId, runId });
  if (!metaResolution.ok) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_publish',
        error: { code: metaResolution.code, message: metaResolution.message },
      });
      return;
    }
    console.error(fail(metaResolution.message));
    process.exit(1);
  }

  const resolved = resolveReviewFindings(metaResolution.meta);
  if (!resolved) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_publish',
        error: { code: 'execution_run_action_not_supported', message: `Run "${runId}" has no review findings to publish.` },
      });
      return;
    }
    console.error(fail(`Run "${runId}" has no review findings to publish.`));
    process.exit(1);
  }

  const findingIds = expandFindingIds({
    findings: resolved.findings,
    publishedIds: resolved.publishedIds,
    rawFindings: findingsFlag,
    excludePublished: true,
  });
  if (findingIds.length === 0) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_publish',
        error: { code: 'execution_run_invalid_action_input', message: `No unpublished findings in review run "${runId}".` },
      });
      return;
    }
    console.error(fail(`No unpublished findings in review run "${runId}".`));
    process.exit(1);
  }

  const selectedFindings = resolved.findings.filter((finding) => findingIds.includes(finding.id));
  const publishInput = {
    sourceRunRef: resolved.runRef,
    findingIds,
    publishedFindings: selectedFindings,
    ...(typeof prNumber === 'number' ? { pullRequestNumber: prNumber } : {}),
  };

  const executed = await executeRunServiceAction(
    executor,
    'execution.run.action',
    { runId, actionId: 'review.publish', input: publishInput },
    sessionId,
  );
  if (!executed.ok) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_publish',
        error: { code: executed.code, ...(executed.message ? { message: executed.message } : {}) },
      });
      return;
    }
    console.error(fail(executed.message));
    process.exit(1);
  }

  const actionPayload = executed.data as Readonly<{ result?: unknown }> | null;
  const actionResult = actionPayload?.result;

  if (json) {
    await printJsonEnvelope({
      ok: true,
      kind: 'session_review_publish',
      data: { sessionId, runId, result: actionResult },
    });
    return;
  }

  console.log(chalk.green('✓'), 'review published');
  const bits: string[] = [];
  const resultRecord = (actionResult ?? null) as Readonly<Record<string, unknown>> | null;
  if (typeof resultRecord?.published === 'number') bits.push(`published ${resultRecord.published}`);
  if (typeof resultRecord?.skipped === 'number') bits.push(`skipped ${resultRecord.skipped}`);
  const pullRequest = resultRecord?.pullRequest as Readonly<Record<string, unknown>> | null | undefined;
  if (pullRequest && typeof pullRequest === 'object') {
    if (typeof pullRequest.number === 'number') bits.push(`PR #${pullRequest.number}`);
    if (typeof pullRequest.url === 'string' && pullRequest.url.length > 0) bits.push(String(pullRequest.url));
  }
  console.log(bits.length > 0 ? bits.join(' · ') : JSON.stringify(actionResult));
}
