import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';

import { computeLineContentHashV1, type ReviewFinding, ReviewFindingsV1Schema, type ReviewFindingsV2, ReviewFindingsV2Schema, ReviewPublishRequestV1Schema, type ReviewPendingPublicationOverlay, type ScmHostingProvider, type ScmPullRequestCreateReviewRequest, type ScmPullRequestListRequest, type ScmPullRequestReference, type ScmPullRequestReviewComment, type ScmPullRequestReviewEvent, type ScmWorkingSnapshot } from '@happier-dev/protocol';

import type {
  ExecutionRunActionDeps,
  ExecutionRunActionResult,
  ExecutionRunState,
} from '@/agent/executionRuns/runtime/executionRunTypes';
import type { ExecutionRunStructuredMeta } from '@/agent/executionRuns/profiles/ExecutionRunIntentProfile';
import { buildReviewFindingsV2Payload } from '@/agent/reviews/normalize/buildReviewFindingsV2Payload';
import { defaultScmBackendRegistry } from '@/scm/defaultRegistry';
import { resolveScmSelection } from '@/scm/resolveScmSelection';
import type { ScmBackendRegistry } from '@/scm/registry';
import type { ScmBackendContext } from '@/scm/types';
import { resolveGithubConnectedAccountAuth } from '@/scm/backends/git/operations/pullRequestOperationHelpers';
import { detectGithubCliAuth } from '@/scm/hostingProviders/providers/githubCliDetection';
import { detectGitlabCliAuth } from '@/scm/hostingProviders/providers/gitlabCliDetection';

/**
 * Line-content hashing algorithm id recorded alongside `ReviewFinding.lineHash`.
 *
 * Review findings reuse the workspace anchor hash the UI and protocol already share
 * (`computeLineContentHashV1`, `lh1:` + FNV-1a), so a finding anchored here can be re-verified by the
 * same code that re-verifies a workspace anchor. One hash format, one algorithm id.
 */
export const REVIEW_LINE_HASH_ALGORITHM = 'line-content-hash-v1' as const;

const REANCHOR_SEARCH_RADIUS = 200;
const SEVERITY_ORDER: readonly ReviewFinding['severity'][] = ['blocker', 'high', 'medium', 'low', 'nit'];

/**
 * How long a `pendingPublication` entry may block a retry before it is treated as stale and
 * ignored. A pending entry is written BEFORE the provider call so a lost/failed response cannot
 * silently turn into a duplicate review; the window bounds that protection so a crashed attempt
 * cannot block a legitimate later publish forever.
 */
const PENDING_PUBLICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function buildPublishFingerprint(runId: string, findingIds: readonly string[]): string {
  return createHash('sha256').update(`${runId}\u0000${[...findingIds].sort().join('\u0000')}`).digest('hex');
}

function mergePendingPublication(
  payload: ReviewFindingsV2,
  findingIds: readonly string[],
  startedAtMs: number,
  requestFingerprint: string,
): ReviewFindingsV2 {
  const entries = new Map<string, ReviewPendingPublicationOverlay['findings'][number]>(
    (payload.pendingPublication?.findings ?? []).map((entry) => [entry.id, entry]),
  );
  for (const id of findingIds) {
    entries.set(id, { id, startedAtMs, requestFingerprint });
  }
  return { ...payload, pendingPublication: { findings: [...entries.values()] } };
}

/**
 * Resolved dependencies required by the `review.publish` runtime branch.
 *
 * These are resolved once at the RPC layer (`rpc/handlers/executionRuns.ts`) and passed through
 * `ExecutionRunManager.applyAction` so the runtime never re-resolves the feature decision or the
 * connected-account credentials on its own. The optional `scmRegistry`, CLI auth detectors and
 * `readFileLines` fields are test seams; production callers leave them unset.
 */
export type ReviewPublishDeps = Readonly<{
  cwd: string;
  connectedAccounts: NonNullable<ExecutionRunActionDeps['connectedAccounts']>;
  featureDecision?: ExecutionRunActionDeps['featureDecision'];
  /** Test seam: SCM backend registry. Defaults to the production git/sapling catalog. */
  scmRegistry?: ScmBackendRegistry;
  /** Test seam: GitHub CLI auth detector. */
  detectGithubCliAuth?: typeof detectGithubCliAuth;
  /** Test seam: GitLab CLI auth detector. */
  detectGitlabCliAuth?: typeof detectGitlabCliAuth;
  /** Test seam: reads an absolute path into lines. Defaults to `node:fs` readFile + split. */
  readFileLines?: (absolutePath: string) => Promise<string[] | null>;
  /**
   * Persists an updated structured meta into the run map BEFORE the provider call (the pending
   * marker). Production callers write into `ExecutionRunManager.runs`; tests inject a recorder.
   */
  persistStructuredMeta?: (meta: ExecutionRunStructuredMeta) => void;
}>;

/**
 * Successful publish outcome: the canonical action-result shape plus the write-back the caller needs
 * to emit — the updated structured meta (publication overlay) and the ACP tool-result meta envelope.
 * `ExecutionRunActionResult` itself gains no structured-meta field.
 */
export type ReviewPublishOutcome = ExecutionRunActionResult & Readonly<{
  updatedStructuredMeta?: ExecutionRunStructuredMeta;
  updatedToolResultMeta?: Record<string, unknown>;
}>;

/**
 * In-flight guard for concurrent publishes of the same run.
 *
 * Two concurrent publishes both read the pre-publication overlay before either writes back, so the
 * same findings would be posted twice. Keyed by run id: overlapping-but-not-identical selections
 * (e.g. `[f1,f2]` vs `[f1]`) must collide, otherwise both read the pre-overlay and both post `f1`.
 * A second concurrent call returns `execution_run_busy` without touching SCM. Released in a
 * `finally`, so a later sequential call still runs and skips already-published findings via the
 * overlay.
 */
const inFlightPublishes = new Set<string>();

export function computeReviewLineContentHash(line: string): string {
  // Delegates to the shared workspace-anchor hash so review findings and file anchors cannot drift.
  return computeLineContentHashV1(line);
}

/**
 * Resolves a finding's `filePath` to an absolute path ONLY when the real target stays inside the
 * workspace root.
 *
 * `filePath` comes from a review engine's output, so it is untrusted: an absolute path or a `..`
 * escape (a) must not be read for hashing and (b) must never reach a provider as a review comment
 * path. Returns null when the path escapes the root. The containment check is lexical first, then
 * symlinks are resolved with `realpath` so a symlinked directory inside the root cannot point the
 * subsequent read outside the workspace.
 */
export function resolveWorkspaceContainedPath(root: string, filePath: string): string | null {
  const rootAbsolute = resolvePath(root);
  const candidate = isAbsolute(filePath) ? resolvePath(filePath) : resolvePath(rootAbsolute, filePath);
  if (candidate === rootAbsolute) return null;
  const rootWithSeparator = rootAbsolute.endsWith('/') ? rootAbsolute : `${rootAbsolute}/`;
  if (!candidate.startsWith(rootWithSeparator)) return null;
  try {
    const rootReal = realpathSync(rootAbsolute);
    const candidateReal = realpathSync(candidate);
    const rootRealWithSeparator = rootReal.endsWith('/') ? rootReal : `${rootReal}/`;
    return candidateReal.startsWith(rootRealWithSeparator) ? candidate : null;
  } catch {
    // The candidate (or root) cannot be resolved to a real path — a missing file, a dangling
    // symlink, or a loop. The subsequent read fails in the same way, so returning the lexical
    // candidate cannot cause an outside read.
    return candidate;
  }
}

async function defaultReadFileLines(absolutePath: string): Promise<string[] | null> {
  try {
    const content = await readFile(absolutePath, 'utf8');
    return content.split(/\r?\n/);
  } catch {
    return null;
  }
}

type ExistingPayloadResolution =
  | Readonly<{ kind: 'ok'; payload: ReviewFindingsV2 }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'malformed' }>;

function resolveExistingPayload(structuredMeta: ExecutionRunStructuredMeta | null | undefined): ExistingPayloadResolution {
  if (!structuredMeta) return { kind: 'none' };
  if (structuredMeta.kind === 'review_findings.v2') {
    const parsed = ReviewFindingsV2Schema.safeParse(structuredMeta.payload);
    return parsed.success ? { kind: 'ok', payload: parsed.data } : { kind: 'malformed' };
  }
  if (structuredMeta.kind === 'review_findings.v1') {
    const legacy = ReviewFindingsV1Schema.safeParse(structuredMeta.payload);
    if (!legacy.success) return { kind: 'malformed' };
    return {
      kind: 'ok',
      payload: buildReviewFindingsV2Payload({
        runId: legacy.data.runRef.runId,
        callId: legacy.data.runRef.callId,
        backendId: legacy.data.runRef.backendId,
        backendTarget: legacy.data.runRef.backendTarget,
        summary: legacy.data.summary,
        findings: legacy.data.findings,
        triage: legacy.data.triage,
        limits: legacy.data.limits,
        generatedAtMs: legacy.data.generatedAtMs,
      }),
    };
  }
  return { kind: 'none' };
}

type AuthResolution =
  | Readonly<{ kind: 'available'; providerLabel: string }>
  | Readonly<{ kind: 'missing'; providerLabel: string }>;

async function resolvePublishAuth(params: Readonly<{
  provider: ScmHostingProvider;
  context: ScmBackendContext;
  deps: ReviewPublishDeps;
}>): Promise<AuthResolution> {
  const { provider, context, deps } = params;
  if (provider.kind === 'github') {
    const connected = await resolveGithubConnectedAccountAuth({
      context,
      providerBaseUrl: provider.baseUrl,
      requireDotComHost: true,
    });
    if (connected.kind === 'available') return { kind: 'available', providerLabel: 'GitHub' };
    const cli = await (deps.detectGithubCliAuth ?? detectGithubCliAuth)({ providerBaseUrl: provider.baseUrl });
    return cli.kind === 'authenticated'
      ? { kind: 'available', providerLabel: 'GitHub' }
      : { kind: 'missing', providerLabel: 'GitHub' };
  }
  if (provider.kind === 'gitlab') {
    const cli = await (deps.detectGitlabCliAuth ?? detectGitlabCliAuth)({ providerBaseUrl: provider.baseUrl });
    return cli.kind === 'authenticated'
      ? { kind: 'available', providerLabel: 'GitLab' }
      : { kind: 'missing', providerLabel: 'GitLab' };
  }
  return { kind: 'missing', providerLabel: provider.name || provider.kind };
}

function capitalizeSeverity(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function buildInlineCommentBody(finding: ReviewFinding, anchorLost: boolean): string {
  const parts: string[] = [
    `Severity: ${finding.severity}`,
    `Category: ${finding.category}`,
    finding.title,
    finding.summary,
  ];
  if (finding.whyItMatters) parts.push(`Why it matters: ${finding.whyItMatters}`);
  if (finding.suggestion) parts.push(`Suggestion: ${finding.suggestion}`);
  if (anchorLost) parts.push('Anchor could not be re-verified.');
  return parts.join('\n\n');
}

function buildBodyBullet(finding: ReviewFinding): string {
  // The location is part of the bullet because a body bullet is where a finding lands when it cannot be
  // anchored to a line (no file, unreadable file, path outside the workspace, lost anchor, overflow).
  const location = finding.filePath
    ? ` (${finding.filePath}${finding.startLine ? `:${finding.startLine}` : ''})`
    : '';
  const parts: string[] = [`**${finding.title}**${location}`, finding.summary];
  if (finding.whyItMatters) parts.push(`Why it matters: ${finding.whyItMatters}`);
  if (finding.suggestion) parts.push(`Suggestion: ${finding.suggestion}`);
  return `- ${parts.join(' — ')}`;
}

function buildReviewBody(params: Readonly<{
  summary: string;
  overviewMarkdown?: string;
  bodyFindings: readonly ReviewFinding[];
}>): string {
  const head = [params.summary, params.overviewMarkdown]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
  const sections: string[] = [];
  if (head) sections.push(head);
  for (const severity of SEVERITY_ORDER) {
    const group = params.bodyFindings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    sections.push(`## ${capitalizeSeverity(severity)}`);
    for (const finding of group) sections.push(buildBodyBullet(finding));
  }
  return sections.join('\n\n');
}

type CommentAnchor = Readonly<{
  line: number;
  anchorLost: boolean;
  /** Hash computed for a finding that had none; otherwise null. */
  computedHash: string | null;
}>;

function resolveCommentAnchor(finding: ReviewFinding, lines: readonly string[]): CommentAnchor {
  const startLine = finding.startLine ?? 0;
  const storedIndex = startLine - 1;
  const hasHash = typeof finding.lineHash === 'string' && finding.lineHash.length > 0;

  if (hasHash) {
    // Only trust the stored hash when its algorithm is this build's (or was recorded before the
    // algorithm id existed). A hash from any other algorithm cannot be verified here, so the
    // finding is treated as unanchored instead of silently degrading to a guess.
    const algorithmTrusted = !finding.lineHashAlgorithm || finding.lineHashAlgorithm === REVIEW_LINE_HASH_ALGORITHM;
    if (algorithmTrusted) {
      // Re-anchor within ±200 lines of the stored line by content hash.
      if (storedIndex >= 0 && storedIndex < lines.length) {
        const from = Math.max(0, storedIndex - REANCHOR_SEARCH_RADIUS);
        const to = Math.min(lines.length, storedIndex + REANCHOR_SEARCH_RADIUS + 1);
        for (let index = from; index < to; index += 1) {
          const line = lines[index];
          if (line !== undefined && computeReviewLineContentHash(line) === finding.lineHash) {
            return { line: index + 1, anchorLost: false, computedHash: null };
          }
        }
      }
    }
    // Hash miss or an unverifiable algorithm: the anchor is lost. The caller degrades to a body
    // bullet rather than guessing a line (the old "current line at the stored index" fallback could
    // only ever hit a coincidental duplicate of the wrong line, so it is dropped).
    return { line: startLine, anchorLost: true, computedHash: null };
  }

  // No stored hash: publish at the stored line and record the hash for future re-anchoring.
  const content = storedIndex >= 0 && storedIndex < lines.length ? (lines[storedIndex] ?? '') : '';
  return {
    line: startLine,
    anchorLost: false,
    computedHash: content.trim() ? computeReviewLineContentHash(content) : null,
  };
}

/**
 * Publishes review findings to the connected SCM backend as a PR review.
 *
 * Contract (see `executionRunApplyAction.ts` caller):
 * - Up-convert `review_findings.v1` structured meta to `review_findings.v2` before reading findings
 *   (reuse `buildReviewFindingsV2Payload`, the same helper the triage and follow-up paths use).
 * - Require the pre-resolved `scm.writeOperations` feature decision to be `enabled`; otherwise fail
 *   closed without reaching SCM.
 * - Resolve the SCM selection for `deps.cwd` via `resolveScmSelection` and build the backend through
 *   `createGitBackend()`, passing `deps.connectedAccounts` for token auth.
 * - Look up the target PR via `pullRequests.list` (lookup only — never `openOrReuse`, which creates
 *   PRs); no PR is a failure naming the branch and the reason.
 * - Write idempotently through the `publication` overlay (`published: true` + provider-specific ref);
 *   never re-publish findings that already carry a `publication`.
 * - Return the canonical `{ ok, errorCode?, error?, result? }` action-result shape.
 */
export async function publishReviewFindings(params: Readonly<{
  run: ExecutionRunState;
  input: unknown;
  deps: ReviewPublishDeps;
}>): Promise<ReviewPublishOutcome> {
  const { run, input, deps } = params;

  // The gate is checked before the input is even parsed: an outward write refuses first and explains
  // nothing else, so a disabled machine cannot be probed with malformed payloads.
  if (deps.featureDecision?.state !== 'enabled') {
    return {
      ok: false,
      errorCode: 'execution_run_not_allowed',
      error: 'Review publishing is not enabled (feature: scm.writeOperations)',
    };
  }

  const parsed = ReviewPublishRequestV1Schema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, errorCode: 'execution_run_invalid_action_input', error: 'Invalid publish input' };
  }

  const existing = resolveExistingPayload(run.structuredMeta);
  if (existing.kind === 'none') {
    return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Not a review run' };
  }
  if (existing.kind === 'malformed') {
    return { ok: false, errorCode: 'execution_run_invalid_action_input', error: 'Review findings metadata is malformed' };
  }
  const existingPayload = existing.payload;

  // `sourceRunRef` / `publishedFindings` are required by the wire schema but the runtime re-derives
  // its selection from the run's own structured meta. Verify the client's account of what it is
  // publishing, so a selection that diverged from the run (meta changed between `get` and `action`)
  // is refused instead of silently publishing a different set.
  if (parsed.data.sourceRunRef.runId !== run.runId) {
    return {
      ok: false,
      errorCode: 'execution_run_invalid_action_input',
      error: `sourceRunRef.runId "${parsed.data.sourceRunRef.runId}" does not match the run being published ("${run.runId}").`,
    };
  }

  // Order-preserving, deduped selection from the run's findings.
  const requestedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const id of parsed.data.findingIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    requestedIds.push(id);
  }

  // Every requested id must be present in the client's `publishedFindings` set.
  const publishedFindingIds = new Set(parsed.data.publishedFindings.map((finding) => finding.id));
  const missingFromPublished = requestedIds.filter((id) => !publishedFindingIds.has(id));
  if (missingFromPublished.length > 0) {
    return {
      ok: false,
      errorCode: 'execution_run_invalid_action_input',
      error: `Finding ids missing from publishedFindings: ${missingFromPublished.join(', ')}.`,
    };
  }

  // An unknown id is an input error, never a silent skip.
  const findingsById = new Map(existingPayload.findings.map((finding) => [finding.id, finding]));
  const unknownIds = requestedIds.filter((id) => !findingsById.has(id));
  if (unknownIds.length > 0) {
    return {
      ok: false,
      errorCode: 'execution_run_invalid_action_input',
      error: `Unknown finding ids: ${unknownIds.join(', ')}.`,
    };
  }

  const guardKey = run.runId;
  if (inFlightPublishes.has(guardKey)) {
    return {
      ok: false,
      errorCode: 'execution_run_busy',
      error: 'A review publish for this run is already in progress.',
    };
  }
  inFlightPublishes.add(guardKey);
  try {
    return await publishSelectedFindings({
      run,
      deps,
      requestedIds,
      existingPayload,
      pullRequestNumber: parsed.data.pullRequestNumber,
    });
  } finally {
    inFlightPublishes.delete(guardKey);
  }
}

async function publishSelectedFindings(params: Readonly<{
  run: ExecutionRunState;
  deps: ReviewPublishDeps;
  requestedIds: readonly string[];
  existingPayload: ReviewFindingsV2;
  pullRequestNumber: number | undefined;
}>): Promise<ReviewPublishOutcome> {
  const { run, deps, requestedIds, existingPayload, pullRequestNumber } = params;

  const findingsById = new Map<string, ReviewFinding>();
  for (const finding of existingPayload.findings) findingsById.set(finding.id, finding);
  const publishedIds = new Set(
    (existingPayload.publication?.findings ?? [])
      .filter((entry) => entry.published === true)
      .map((entry) => entry.id),
  );

  // A pending entry is a durable "a previous attempt may have reached the provider" marker. This is
  // fail-closed: on a retry we refuse rather than risk a duplicate outward write, because a review
  // that double-applies is worse than an explicit refusal. Entries older than the pending window are
  // stale and no longer block.
  const nowMs = Date.now();
  const blockingPending = (existingPayload.pendingPublication?.findings ?? []).filter((entry) => {
    return requestedIds.includes(entry.id) && nowMs - entry.startedAtMs <= PENDING_PUBLICATION_WINDOW_MS;
  });
  if (blockingPending.length > 0) {
    return {
      ok: false,
      errorCode: 'execution_run_busy',
      error: 'A previous publish attempt for these findings may have reached the provider. Check the pull request before retrying.',
    };
  }

  // Unknown ids were already rejected upstream; here only already-published findings are skipped.
  const selectedFindings = requestedIds
    .map((id) => findingsById.get(id))
    .filter((finding): finding is ReviewFinding => finding !== undefined && !publishedIds.has(finding.id));

  if (selectedFindings.length === 0) {
    return {
      ok: true,
      result: {
        published: 0,
        skipped: requestedIds.length,
        message: 'No findings to publish: every requested finding was already published.',
      },
    };
  }

  const scmRegistry = deps.scmRegistry ?? defaultScmBackendRegistry;
  const resolved = await resolveScmSelection({
    workingDirectory: deps.cwd,
    cwd: deps.cwd,
    registry: scmRegistry,
    connectedAccounts: deps.connectedAccounts,
  });
  if (!resolved) {
    return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'No source-control repository detected' };
  }
  const { selection, context } = resolved;
  const pullRequests = selection.backend.pullRequests;
  if (!pullRequests) {
    return {
      ok: false,
      errorCode: 'execution_run_action_not_supported',
      error: 'Pull request review operations are not supported by the selected source-control backend.',
    };
  }
  const createReview = pullRequests.createReview;
  if (!createReview) {
    return {
      ok: false,
      errorCode: 'execution_run_action_not_supported',
      error: 'Pull request review operations are not supported by the selected source-control backend.',
    };
  }

  const status = await selection.backend.statusSnapshot({ context, request: { cwd: context.cwd } });
  const snapshot: ScmWorkingSnapshot | null = status.success && status.snapshot ? status.snapshot : null;
  const provider = snapshot?.hostingProvider ?? null;
  if (!provider) {
    return {
      ok: false,
      errorCode: 'execution_run_action_not_supported',
      error: 'No supported SCM hosting provider was detected for this repository.',
    };
  }

  const auth = await resolvePublishAuth({ provider, context, deps });
  const branch = (snapshot?.branch?.head ?? '').trim() || null;
  const detached = snapshot?.branch?.detached ?? false;

  let prReference: ScmPullRequestReference;
  let prNumber: number | null;
  let prUrl: string | null;

  if (typeof pullRequestNumber === 'number') {
    if (auth.kind === 'missing') {
      return {
        ok: false,
        errorCode: 'execution_run_not_allowed',
        error: `Review publishing requires ${auth.providerLabel} authentication.`,
      };
    }
    prReference = { number: pullRequestNumber };
    prNumber = pullRequestNumber;
    prUrl = null;
  } else {
    if (!branch || detached) {
      return {
        ok: false,
        errorCode: 'execution_run_failed',
        error: 'A pull request head branch is required while HEAD is detached.',
      };
    }
    if (auth.kind === 'missing') {
      return {
        ok: false,
        errorCode: 'execution_run_not_allowed',
        error: `Review publishing requires ${auth.providerLabel} authentication.`,
      };
    }
    const listRequest: ScmPullRequestListRequest = { cwd: context.cwd, head: branch };
    const listResult = await pullRequests.list({ context, request: listRequest });
    if (!listResult.success) {
      return {
        ok: false,
        errorCode: 'execution_run_failed',
        error: listResult.error ?? 'Failed to list open pull requests.',
      };
    }
    const first = listResult.pullRequests[0];
    if (!first) {
      return {
        ok: false,
        errorCode: 'execution_run_failed',
        error: `No open pull request found for branch "${branch}". Open a pull request before publishing a review.`,
      };
    }
    prReference = first.number != null ? { number: first.number } : { headBranch: branch };
    prNumber = first.number;
    prUrl = first.url;
  }

  // Map findings to inline comments / body bullets, re-anchoring located findings.
  const comments: ScmPullRequestReviewComment[] = [];
  const inlineCandidates: {
    finding: ReviewFinding;
    comment: ScmPullRequestReviewComment;
    computedHash: string | null;
  }[] = [];
  const bodyFindings: ReviewFinding[] = [];
  const computedHashes = new Map<string, string>();

  for (const finding of selectedFindings) {
    const absolutePath = finding.filePath
      ? resolveWorkspaceContainedPath(deps.cwd, finding.filePath)
      : null;
    if (!finding.filePath || !finding.startLine || !absolutePath) {
      // No location, or a path outside the workspace: it belongs in the review body, never in a
      // provider comment (an escaping path must not be published as a comment path either).
      bodyFindings.push(finding);
      continue;
    }
    const lines = await (deps.readFileLines ?? defaultReadFileLines)(absolutePath);
    if (!lines) {
      bodyFindings.push(finding);
      continue;
    }
    const anchor: CommentAnchor = resolveCommentAnchor(finding, lines);
    if (anchor.anchorLost || anchor.line < 1 || anchor.line > lines.length) {
      // Guessing a line a provider will reject fails the whole review, so a lost anchor degrades to a
      // body bullet that carries the stored location instead (plan §A2).
      bodyFindings.push(finding);
      continue;
    }
    inlineCandidates.push({
      finding,
      comment: {
        path: finding.filePath,
        line: anchor.line,
        side: 'new',
        body: buildInlineCommentBody(finding, false),
      },
      computedHash: anchor.computedHash,
    });
  }

  // Providers cap inline comments per review (the request schema caps at 100). Overflow degrades to body
  // bullets rather than failing the publish outright.
  const MAX_INLINE_COMMENTS = 100;
  for (const candidate of inlineCandidates.slice(0, MAX_INLINE_COMMENTS)) {
    comments.push(candidate.comment);
    if (candidate.computedHash) computedHashes.set(candidate.finding.id, candidate.computedHash);
  }
  for (const candidate of inlineCandidates.slice(MAX_INLINE_COMMENTS)) {
    bodyFindings.push(candidate.finding);
  }

  const hasBlocking = selectedFindings.some(
    (finding) => finding.severity === 'blocker' || finding.severity === 'high',
  );
  const event: ScmPullRequestReviewEvent = hasBlocking ? 'request_changes' : 'comment';
  const body = buildReviewBody({
    summary: existingPayload.summary,
    overviewMarkdown: existingPayload.overviewMarkdown,
    bodyFindings,
  });

  let reviewId: string;
  let reviewUrl: string | null;
  let eventApplied: boolean | undefined;
  let postedCommentCount: number | undefined;
  try {
    const request: ScmPullRequestCreateReviewRequest = {
      cwd: context.cwd,
      prReference,
      event,
      body,
      comments,
    };
    // Write the pending marker BEFORE the provider call. If the provider applies the review but the
    // response is lost or failed, the marker survives and a retry refuses instead of posting a
    // duplicate (fail-closed). It is cleared in the same write that marks the findings published.
    const selectedFindingIds = selectedFindings.map((finding) => finding.id);
    const pendingPayload = mergePendingPublication(
      existingPayload,
      selectedFindingIds,
      Date.now(),
      buildPublishFingerprint(run.runId, selectedFindingIds),
    );
    deps.persistStructuredMeta?.({ kind: 'review_findings.v2', payload: pendingPayload });

    const reviewResult = await createReview({ context, request });
    if (!reviewResult.success) {
      return {
        ok: false,
        errorCode: 'execution_run_failed',
        error: reviewResult.error ?? 'Pull request review creation failed.',
      };
    }
    reviewId = reviewResult.reviewId;
    reviewUrl = reviewResult.url;
    eventApplied = reviewResult.eventApplied;
    postedCommentCount = reviewResult.postedCommentCount;
  } catch (error) {
    return {
      ok: false,
      errorCode: 'execution_run_failed',
      error: error instanceof Error ? error.message : 'Pull request review creation failed.',
    };
  }

  // Record computed line hashes on findings that lacked one.
  const updatedFindings = existingPayload.findings.map((finding) => {
    const computedHash = computedHashes.get(finding.id);
    if (computedHash && !finding.lineHash) {
      return { ...finding, lineHash: computedHash, lineHashAlgorithm: REVIEW_LINE_HASH_ALGORITHM };
    }
    return finding;
  });

  // Merge publication overlay entries (idempotent by finding id).
  const publishedAtMs = Date.now();
  const publicationById = new Map<
    string,
    Readonly<{ id: string; published: boolean; publishedAtMs?: number; publishedMessageRef?: string }>
  >();
  for (const entry of existingPayload.publication?.findings ?? []) {
    publicationById.set(entry.id, entry);
  }
  for (const finding of selectedFindings) {
    publicationById.set(finding.id, {
      id: finding.id,
      published: true,
      publishedAtMs,
      publishedMessageRef: reviewId,
    });
  }

  // Clear the pending markers for the findings that are now published, in the same write that marks
  // them published. Pending entries for other findings (none selected, or stale) are preserved.
  const pendingById = new Map<string, ReviewPendingPublicationOverlay['findings'][number]>(
    (existingPayload.pendingPublication?.findings ?? []).map((entry) => [entry.id, entry]),
  );
  for (const finding of selectedFindings) pendingById.delete(finding.id);
  const remainingPending = [...pendingById.values()];

  const updatedPayload: ReviewFindingsV2 = {
    ...existingPayload,
    findings: updatedFindings,
    publication: { findings: [...publicationById.values()] },
    ...(remainingPending.length > 0 ? { pendingPublication: { findings: remainingPending } } : {}),
  };
  const updatedStructuredMeta: ExecutionRunStructuredMeta = {
    kind: 'review_findings.v2',
    payload: updatedPayload,
  };

  // A verdict the provider could not record, or comments it applied only partly, must be visible in the
  // result: the findings are marked published, so silence would read as "all of it landed".
  const warnings: string[] = [];
  if (eventApplied === false) {
    warnings.push(
      `The provider did not record the "${event}" verdict; GitLab has no request-changes state, so the review `
        + 'exists as comments only.',
    );
  }
  if (typeof postedCommentCount === 'number' && postedCommentCount !== comments.length) {
    warnings.push(
      `The provider recorded ${postedCommentCount} of ${comments.length} inline comments; the rest were not posted.`,
    );
  }

  return {
    ok: true,
    result: {
      published: selectedFindings.length,
      skipped: requestedIds.length - selectedFindings.length,
      reviewId,
      pullRequest: {
        number: prNumber,
        url: reviewUrl ?? prUrl,
      },
      ...(eventApplied === undefined ? {} : { eventApplied }),
      ...(typeof postedCommentCount === 'number' ? { postedCommentCount } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
    updatedStructuredMeta,
    updatedToolResultMeta: { happier: updatedStructuredMeta },
  };
}
