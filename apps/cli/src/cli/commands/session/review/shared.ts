import type { Credentials } from '@/persistence';
import type { ReviewFinding } from '@happier-dev/protocol';
import { ReviewFindingsV1Schema, ReviewFindingsV2Schema } from '@happier-dev/protocol';

import { createCliActionExecutor } from '@/session/actions/createCliActionExecutor';
import { fetchSessionById } from '@/session/transport/http/sessionsHttp';
import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { resolveSessionEncryptionContextFromCredentials, resolveSessionStoredContentEncryptionMode } from '@/session/transport/encryption/sessionEncryptionContext';
import { resolveSessionIdOrPrefix } from '@/session/query/resolveSessionId';
import { normalizeActionExecuteResult } from '@/cli/commands/session/shared/normalizeActionExecuteResult';
import { cmd, fail } from '@happier-dev/cli-common/output';

export type ReviewActionExecutor = ReturnType<typeof createCliActionExecutor>;

export type ReviewCommandKind = 'session_review_publish' | 'session_review_fix';

export function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Shared session preamble for the `review publish` / `review fix` commands. Mirrors
 * `cmdSessionReviewStart` exactly: resolve credentials, resolve the session id/prefix,
 * fetch the session, build the encryption context, and return a session-bound action
 * executor. Returns null after printing a JSON error envelope; non-JSON failures throw
 * or exit(1) exactly like the start command.
 */
export async function resolveReviewSession(params: Readonly<{
  json: boolean;
  kind: ReviewCommandKind;
  idOrPrefix: string;
  readCredentialsFn: () => Promise<Credentials | null>;
}>): Promise<Readonly<{ sessionId: string; executor: ReviewActionExecutor }> | null> {
  const { json, kind, idOrPrefix, readCredentialsFn } = params;

  const credentials = await readCredentialsFn();
  if (!credentials) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind, error: { code: 'not_authenticated' } });
      return null;
    }
    console.error(fail(`Not signed in. Run ${cmd('happier auth login')} first.`));
    process.exit(1);
  }

  const resolved = await resolveSessionIdOrPrefix({ credentials, idOrPrefix });
  if (!resolved.ok) {
    if (json) {
      await printJsonEnvelope({
        ok: false,
        kind,
        error: { code: resolved.code, ...(resolved.candidates ? { candidates: resolved.candidates } : {}) },
      });
      return null;
    }
    throw new Error(resolved.code);
  }
  const sessionId = resolved.sessionId;

  const rawSession = await fetchSessionById({ token: credentials.token, sessionId });
  if (!rawSession) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind, error: { code: 'session_not_found', sessionId } });
      return null;
    }
    console.error(fail(`Session not found: ${sessionId}`));
    process.exit(1);
  }

  const ctx = resolveSessionEncryptionContextFromCredentials(credentials, rawSession);
  const mode = resolveSessionStoredContentEncryptionMode(rawSession);
  const executor = createCliActionExecutor({ token: credentials.token, credentials, sessionId, mode, ctx });

  return { sessionId, executor };
}

export type RunServiceResult =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; code: string; message: string }>;

/**
 * Executes an `execution.run.*` first-class action and unwraps its `{ ok, data }`
 * service payload, normalizing both executor-level and service-level failures.
 */
export async function executeRunServiceAction(
  executor: ReviewActionExecutor,
  actionId: 'execution.run.list' | 'execution.run.get' | 'execution.run.action',
  input: Readonly<Record<string, unknown>>,
  sessionId: string,
): Promise<RunServiceResult> {
  const executed = await executor.execute(actionId, input, { defaultSessionId: sessionId });
  const normalized = normalizeActionExecuteResult(executed);
  if (!normalized.ok) {
    return { ok: false, code: normalized.errorCode, message: normalized.errorMessage ?? normalized.errorCode };
  }

  const service = normalized.data as Readonly<{ ok?: unknown; data?: unknown }> | null;
  if (service && typeof service === 'object' && service.ok === true) {
    return { ok: true, data: service.data ?? null };
  }
  return { ok: true, data: null };
}

export type ResolveReviewRunIdResult =
  | Readonly<{ ok: true; runId: string }>
  | Readonly<{ ok: false; code: string; message: string }>;

/**
 * Resolves the review run to act on. An explicit `--run` wins; otherwise the most
 * recent `review` run for the session is selected via `execution.run.list`. Fails
 * with a clear message when there is no review run or when the most-recent run is
 * ambiguous (a tie on `startedAtMs`) — never guesses.
 */
export async function resolveReviewRunId(params: Readonly<{
  executor: ReviewActionExecutor;
  sessionId: string;
  explicitRunId: string | null;
}>): Promise<ResolveReviewRunIdResult> {
  if (params.explicitRunId) return { ok: true, runId: params.explicitRunId };

  const listRes = await executeRunServiceAction(
    params.executor,
    'execution.run.list',
    { sessionId: params.sessionId },
    params.sessionId,
  );
  if (!listRes.ok) return { ok: false, code: listRes.code, message: listRes.message };

  const listData = listRes.data as Readonly<{ runs?: unknown }> | null;
  const runs = Array.isArray(listData?.runs) ? listData.runs : [];
  const reviewRuns = runs.filter((run) => {
    const record = run as Readonly<{ intent?: unknown }> | null;
    return record?.intent === 'review';
  });

  if (reviewRuns.length === 0) {
    return {
      ok: false,
      code: 'execution_run_not_found',
      message: `No review run found for session "${params.sessionId}". Run "happier session review start" first, or pass --run <runId>.`,
    };
  }

  const ordered = reviewRuns
    .map((run) => {
      const record = run as Readonly<{ runId?: unknown; startedAtMs?: unknown }>;
      return {
        runId: String(record.runId ?? ''),
        startedAtMs: typeof record.startedAtMs === 'number' ? record.startedAtMs : 0,
      };
    })
    .sort((a, b) => b.startedAtMs - a.startedAtMs);

  if (ordered.length > 1 && ordered[0].startedAtMs === ordered[1].startedAtMs) {
    return {
      ok: false,
      code: 'execution_run_ambiguous',
      message: `Multiple review runs found for session "${params.sessionId}" with the same start time; pass --run <runId> to choose one.`,
    };
  }

  return { ok: true, runId: ordered[0].runId };
}

export type ReviewStructuredMeta = Readonly<{
  kind: 'review_findings.v1' | 'review_findings.v2';
  payload: unknown;
}>;

export type ResolveReviewMetaResult =
  | Readonly<{ ok: true; meta: ReviewStructuredMeta }>
  | Readonly<{ ok: false; code: string; message: string }>;

/**
 * Fetches the run's structured meta (with findings) via `execution.run.get`.
 */
export async function fetchReviewStructuredMeta(params: Readonly<{
  executor: ReviewActionExecutor;
  sessionId: string;
  runId: string;
}>): Promise<ResolveReviewMetaResult> {
  const getRes = await executeRunServiceAction(
    params.executor,
    'execution.run.get',
    { sessionId: params.sessionId, runId: params.runId, includeStructured: true },
    params.sessionId,
  );
  if (!getRes.ok) return { ok: false, code: getRes.code, message: getRes.message };

  const getData = getRes.data as Readonly<{ structuredMeta?: unknown }> | null;
  const meta = getData?.structuredMeta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const record = meta as Readonly<{ kind?: unknown; payload?: unknown }>;
    if (record.kind === 'review_findings.v1' || record.kind === 'review_findings.v2') {
      return { ok: true, meta: { kind: record.kind, payload: record.payload } };
    }
  }

  return {
    ok: false,
    code: 'execution_run_action_not_supported',
    message: `Run "${params.runId}" is not a review run.`,
  };
}

export type ResolvedReviewFindings = Readonly<{
  runRef: Readonly<{ runId: string; callId: string; backendId: string }>;
  findings: readonly ReviewFinding[];
  publishedIds: ReadonlySet<string>;
}>;

/**
 * Parses the review structured meta into the run ref, findings, and the set of
 * already-published finding ids (v1 carries no publication overlay, so all findings
 * are treated as unpublished).
 */
export function resolveReviewFindings(meta: ReviewStructuredMeta): ResolvedReviewFindings | null {
  if (meta.kind === 'review_findings.v2') {
    const parsed = ReviewFindingsV2Schema.safeParse(meta.payload);
    if (!parsed.success) return null;
    const publishedIds = new Set<string>();
    for (const entry of parsed.data.publication?.findings ?? []) {
      if (entry.published === true) publishedIds.add(entry.id);
    }
    return {
      runRef: {
        runId: parsed.data.runRef.runId,
        callId: parsed.data.runRef.callId,
        backendId: parsed.data.runRef.backendId,
      },
      findings: parsed.data.findings,
      publishedIds,
    };
  }

  const parsed = ReviewFindingsV1Schema.safeParse(meta.payload);
  if (!parsed.success) return null;
  return {
    runRef: {
      runId: parsed.data.runRef.runId,
      callId: parsed.data.runRef.callId,
      backendId: parsed.data.runRef.backendId,
    },
    findings: parsed.data.findings,
    publishedIds: new Set<string>(),
  };
}

/**
 * Expands the `--findings` value into a concrete id list. `all` means every finding
 * (optionally excluding already-published ones for publish); otherwise a csv list.
 */
export function expandFindingIds(params: Readonly<{
  findings: readonly ReviewFinding[];
  publishedIds: ReadonlySet<string>;
  rawFindings: string;
  excludePublished: boolean;
}>): string[] {
  const trimmed = params.rawFindings.trim();
  if (trimmed === 'all') {
    return params.findings
      .map((finding) => finding.id)
      .filter((id) => !params.excludePublished || !params.publishedIds.has(id));
  }
  return splitCsv(trimmed);
}
