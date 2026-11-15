import chalk from 'chalk';

import type { Credentials } from '@/persistence';
import { createCliActionExecutor } from '@/session/actions/createCliActionExecutor';

import { fetchSessionById } from '@/session/transport/http/sessionsHttp';
import { wantsJson, printJsonEnvelope, writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { resolveSessionEncryptionContextFromCredentials, resolveSessionStoredContentEncryptionMode } from '@/session/transport/encryption/sessionEncryptionContext';
import { readCommandPositionals, readFlagValue } from '@/cli/commands/shared/argvFlags';
import { resolveSessionIdOrPrefix } from '@/session/query/resolveSessionId';
import { cmd, fail } from '@happier-dev/cli-common/output';
import {
  resolveReviewCallSitePolicyFlagMapping,
  resolveReviewModelPolicyDepthRefs,
} from '@happier-dev/protocol';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export async function cmdSessionReviewStart(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<Credentials | null> }>,
): Promise<void> {
  const json = wantsJson(argv);
  const [idOrPrefix = ''] = readCommandPositionals(argv, {
    startIndex: 2,
    valueFlags: [
      '--engines', '--engine', '--instructions', '--change-type', '--base-branch', '--base-commit',
      '--coderabbit-config', '--permission-mode', '--model', '--depth',
    ],
  });
  if (!idOrPrefix) {
    throw new Error('Usage: happier session review start <session-id-or-prefix> --engines <id1,id2> [--instructions <text>] [--json]');
  }

  const enginesRaw = readFlagValue(argv, '--engines') ?? readFlagValue(argv, '--engine');
  const engineIds = splitCsv(enginesRaw);
  const instructions = readFlagValue(argv, '--instructions') ?? '';

  const changeType = readFlagValue(argv, '--change-type') ?? undefined;
  const baseBranch = readFlagValue(argv, '--base-branch') ?? undefined;
  const baseCommit = readFlagValue(argv, '--base-commit') ?? undefined;
  const coderabbitConfigFiles = splitCsv(readFlagValue(argv, '--coderabbit-config'));
  const permissionMode = readFlagValue(argv, '--permission-mode') ?? undefined;

  const modelRaw = readFlagValue(argv, '--model');
  const depthRaw = readFlagValue(argv, '--depth');
  let depth: 'fast' | 'deep' | null = null;
  if (depthRaw !== null) {
    if (depthRaw !== 'fast' && depthRaw !== 'deep') {
      throw new Error("Usage: --depth must be 'fast' or 'deep'");
    }
    depth = depthRaw;
  }
  const modelFlagMapping = resolveReviewCallSitePolicyFlagMapping({ model: modelRaw, depth });
  if (!modelFlagMapping.ok) {
    throw new Error('review_model_policy_conflict: --model and --depth are mutually exclusive');
  }

  if (engineIds.length === 0) {
    throw new Error('Usage: happier session review start <session-id> --engines <id1,id2> [--instructions <text>] [--json]');
  }

  const base = (() => {
    if (baseCommit) return { kind: 'commit', baseCommit };
    if (baseBranch) return { kind: 'branch', baseBranch };
    return undefined;
  })();

  const input: any = {
    engineIds,
    instructions,
    ...(changeType ? { changeType } : null),
    ...(base ? { base } : null),
    ...(permissionMode ? { permissionMode } : null),
  };

  if (coderabbitConfigFiles.length > 0) {
    input.engines = {
      ...(input.engines ?? null),
      coderabbit: { configFiles: coderabbitConfigFiles },
    };
  }

  const credentials = await deps.readCredentialsFn();
  if (!credentials) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind: 'session_review_start', error: { code: 'not_authenticated' } });
      return;
    }
    console.error(fail(`Not signed in. Run ${cmd('happier auth login')} first.`));
    process.exit(1);
  }

  const resolved = await resolveSessionIdOrPrefix({ credentials, idOrPrefix });
  if (!resolved.ok) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind: 'session_review_start',
        error: { code: resolved.code, ...(resolved.candidates ? { candidates: resolved.candidates } : {}) },
      });
      return;
    }
    throw new Error(resolved.code);
  }
  const sessionId = resolved.sessionId;

  const rawSession = await fetchSessionById({ token: credentials.token, sessionId });
  if (!rawSession) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind: 'session_review_start', error: { code: 'session_not_found', sessionId } });
      return;
    }
    console.error(fail(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  const ctx = resolveSessionEncryptionContextFromCredentials(credentials, rawSession);
  const mode = resolveSessionStoredContentEncryptionMode(rawSession);

  // Map CLI flags onto the call-site model policy. `--model` is a complete `fixed` policy; `--depth`
  // names only the side, so it borrows the fast/deep refs from the configured account/engine depth
  // policy (first depth policy wins: account default, then any engine override).
  if (modelFlagMapping.kind === 'fixed') {
    input.modelPolicy = { kind: 'fixed', modelId: modelFlagMapping.modelId };
  } else if (modelFlagMapping.kind === 'depth') {
    const settingsCtx = await bootstrapAccountSettingsContext({ credentials, mode: 'fast' });
    const refs = resolveReviewModelPolicyDepthRefs(settingsCtx.settings.reviewModelPolicySettingsV1);
    if (!refs) {
      throw new Error('--depth requires a configured depth review model policy (review.modelPolicy or review.engines.<id>.modelPolicy)');
    }
    input.modelPolicy = {
      kind: 'depth',
      depthDefault: modelFlagMapping.depthDefault,
      fast: refs.fast,
      deep: refs.deep,
    };
  }

  const executor = createCliActionExecutor({ token: credentials.token, credentials, sessionId, mode, ctx });
  const started = await executor.execute('review.start', input, { defaultSessionId: sessionId });

  if (!started.ok) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind: 'session_review_start', error: { code: started.errorCode } });
      return;
    }
    console.error(fail(started.errorCode));
    process.exit(1);
  }

  const results = (started.result as any)?.results ?? [];

  if (json) {
    await printJsonEnvelope({
      ok: true,
      kind: 'session_review_start',
      data: { sessionId, results },
    });
    return;
  }

  console.log(chalk.green('✓'), 'review started');
  await writeJsonStdout({ sessionId, results }, { pretty: true });
}
