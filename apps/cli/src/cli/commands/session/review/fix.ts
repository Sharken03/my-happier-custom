import chalk from 'chalk';

import type { Credentials } from '@/persistence';

import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { hasFlag, readCommandPositionals, readFlagValue } from '@/cli/commands/shared/argvFlags';
import { fail } from '@happier-dev/cli-common/output';
import {
  executeRunServiceAction,
  expandFindingIds,
  fetchReviewStructuredMeta,
  resolveReviewFindings,
  resolveReviewRunId,
  resolveReviewSession,
} from './shared';

const USAGE = 'happier session review fix <session-id-or-prefix-or-tag> [--run <runId>] --findings <id1,id2|all> [--mode send_to_session|spawn_session] [--patch] [--permission-mode <intent>] [--json]';

export async function cmdSessionReviewFix(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<Credentials | null> }>,
): Promise<void> {
  const json = wantsJson(argv);
  const [idOrPrefix = ''] = readCommandPositionals(argv, {
    startIndex: 2,
    valueFlags: ['--run', '--findings', '--mode', '--permission-mode'],
  });
  if (!idOrPrefix) {
    throw new Error(`Usage: ${USAGE}`);
  }

  const runIdFlag = readFlagValue(argv, '--run');
  const findingsFlag = readFlagValue(argv, '--findings');
  const modeRaw = readFlagValue(argv, '--mode');
  const patch = hasFlag(argv, '--patch');
  const permissionMode = readFlagValue(argv, '--permission-mode');

  if (findingsFlag === null || findingsFlag.trim().length === 0) {
    throw new Error(`Usage: ${USAGE}`);
  }
  if (modeRaw !== null && modeRaw !== 'send_to_session' && modeRaw !== 'spawn_session') {
    throw new Error("Usage: --mode must be 'send_to_session' or 'spawn_session'");
  }

  const sessionCtx = await resolveReviewSession({
    json,
    kind: 'session_review_fix',
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
        kind: 'session_review_fix',
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
        kind: 'session_review_fix',
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
        kind: 'session_review_fix',
        error: { code: 'execution_run_action_not_supported', message: `Run "${runId}" has no review findings to fix.` },
      });
      return;
    }
    console.error(fail(`Run "${runId}" has no review findings to fix.`));
    process.exit(1);
  }

  const findingIds = expandFindingIds({
    findings: resolved.findings,
    publishedIds: resolved.publishedIds,
    rawFindings: findingsFlag,
    excludePublished: false,
  });
  if (findingIds.length === 0) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_fix',
        error: { code: 'execution_run_invalid_action_input', message: `No findings in review run "${runId}".` },
      });
      return;
    }
    console.error(fail(`No findings in review run "${runId}".`));
    process.exit(1);
  }

  const fixInput = {
    runId,
    findingIds,
    mode: modeRaw ?? 'send_to_session',
    ...(patch ? { includePatch: true } : {}),
    ...(permissionMode !== null ? { permissionMode } : {}),
  };

  const executed = await executeRunServiceAction(
    executor,
    'execution.run.action',
    {
      runId,
      actionId: 'review.finding.apply',
      input: fixInput,
      // `review.finding.apply` is declared `danger` + approval REQUIRED, while `execution.run.action` is a
      // `safe` dispatcher that cannot see this command's approval state. Typing the command explicitly IS the
      // approval on the CLI surface (there is no interactive prompt), so the surface asserts it here; without
      // the grant the daemon refuses the nested action.
      approvalGrant: { grantedBy: 'cli', grantedAtMs: Date.now() },
    },
    sessionId,
  );
  if (!executed.ok) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_fix',
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
      kind: 'session_review_fix',
      data: { sessionId, runId, result: actionResult },
    });
    return;
  }

  console.log(chalk.green('✓'), 'review findings applied');
  const bits: string[] = [];
  const resultRecord = (actionResult ?? null) as Readonly<Record<string, unknown>> | null;
  if (typeof resultRecord?.mode === 'string') bits.push(`mode ${resultRecord.mode}`);
  if (Array.isArray(resultRecord?.findingIds)) bits.push(`${resultRecord.findingIds.length} finding(s)`);
  if (resultRecord && Object.prototype.hasOwnProperty.call(resultRecord, 'spawned')) {
    bits.push('spawned session');
  }
  console.log(bits.length > 0 ? bits.join(' · ') : JSON.stringify(actionResult));
}
