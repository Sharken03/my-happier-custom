import {
  ReviewFindingApplyInputSchema,
  ReviewFindingsV1Schema,
  ReviewFindingsV2Schema,
  type ExecutionRunActionPermissionMode,
  type ReviewFinding,
  type ReviewFindingsV2,
  type SessionPermissionMode,
} from '@happier-dev/protocol';

import type { ExecutionRunStructuredMeta } from '@/agent/executionRuns/profiles/ExecutionRunIntentProfile';
import type {
  ExecutionRunActionResult,
  ExecutionRunState,
} from '@/agent/executionRuns/runtime/executionRunTypes';
import { buildReviewFindingsV2Payload } from '@/agent/reviews/normalize/buildReviewFindingsV2Payload';

/**
 * Runtime dependencies for `review.finding.apply`.
 *
 * Both helpers are optional at the call site so the runtime branch can fail
 * closed ("not wired yet") exactly like `review.publish` does when its deps are
 * absent. Production callers supply:
 * - `sendToSession`: the manager's `enqueueParentSessionInput` (sends a user
 *   input into the originating session), and
 * - `spawnSession`: a session spawn helper scoped to the same workspace.
 * The functions themselves are the existing send/spawn owners; this action does
 * not invent a new RPC.
 */
export type ReviewFindingApplyDeps = Readonly<{
  cwd: string;
  sendToSession: (input: Readonly<{ text: string; meta: Record<string, unknown> }>) => Promise<void>;
  spawnSession: (input: Readonly<{
    text: string;
    directory: string;
    permissionMode: SessionPermissionMode;
  }>) => Promise<unknown>;
}>;

/**
 * Action permission intents are a smaller vocabulary than session permission modes
 * (`read_only | default | workspace_write | yolo` vs
 * `default | acceptEdits | bypassPermissions | plan | read-only | safe-yolo | yolo`), and a spawned
 * session speaks the latter. This is the inverse of `normalizeExecutionRunActionPermissionMode`.
 */
export function toSessionPermissionMode(mode: ExecutionRunActionPermissionMode): SessionPermissionMode {
  switch (mode) {
    case 'read_only':
      return 'read-only';
    case 'workspace_write':
      return 'acceptEdits';
    case 'yolo':
      return 'yolo';
    case 'default':
      return 'default';
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

function formatFindingLocation(finding: ReviewFinding): string {
  if (finding.filePath) {
    return finding.startLine ? `${finding.filePath}:${finding.startLine}` : finding.filePath;
  }
  return 'no file location';
}

/**
 * Builds the fix prompt. Each finding appears exactly once, carrying its
 * location, so the applying session can fix precisely the selected set and
 * report per finding id.
 *
 * `finding.patch` is a bare string with no hunk/line metadata, so it cannot be
 * applied as a mechanical diff. When `includePatch` is set it is embedded only
 * as proposed text to read and adapt.
 */
export function buildReviewFindingFixPrompt(params: Readonly<{
  findings: readonly ReviewFinding[];
  includePatch: boolean;
}>): string {
  const sections: string[] = [
    'Fix exactly the review findings below and nothing else. After applying the fixes, report back per finding: one line per finding id naming what changed.',
  ];

  for (const finding of params.findings) {
    const lines = [
      `Finding ${finding.id} (severity: ${finding.severity}, category: ${finding.category})`,
      `Location: ${formatFindingLocation(finding)}`,
      `Title: ${finding.title}`,
      `Summary: ${finding.summary}`,
    ];
    if (finding.whyItMatters) lines.push(`Why it matters: ${finding.whyItMatters}`);
    if (finding.suggestion) lines.push(`Suggestion: ${finding.suggestion}`);
    if (params.includePatch && finding.patch) {
      lines.push('Proposed text to read (NOT a mechanically applicable diff):');
      lines.push(finding.patch);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Applies the `review.finding.apply` run action.
 *
 * Contract (see `executionRunApplyAction.ts` caller):
 * - Up-convert `review_findings.v1` structured meta to `review_findings.v2`
 *   before reading findings (reuse `buildReviewFindingsV2Payload`, the same
 *   helper the triage/follow-up/publish paths use).
 * - Select `findingIds` order-preserving and deduped; an id that does not exist
 *   in the run's findings is an invalid-action-input failure naming the ids.
 * - Build the fix prompt, then route to `deps.sendToSession` or
 *   `deps.spawnSession` according to `mode`.
 */
export async function applyReviewFindingFix(params: Readonly<{
  run: ExecutionRunState;
  input: unknown;
  deps: ReviewFindingApplyDeps;
}>): Promise<ExecutionRunActionResult> {
  const { run, input, deps } = params;

  const parsed = ReviewFindingApplyInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, errorCode: 'execution_run_invalid_action_input', error: 'Invalid review finding apply input' };
  }

  const existing = resolveExistingPayload(run.structuredMeta);
  if (existing.kind === 'none') {
    return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Not a review run' };
  }
  if (existing.kind === 'malformed') {
    return { ok: false, errorCode: 'execution_run_invalid_action_input', error: 'Review findings metadata is malformed' };
  }
  const existingPayload = existing.payload;

  const requestedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const id of parsed.data.findingIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    requestedIds.push(id);
  }

  const findingsById = new Map<string, ReviewFinding>();
  for (const finding of existingPayload.findings) findingsById.set(finding.id, finding);

  const unknownIds = requestedIds.filter((id) => !findingsById.has(id));
  if (unknownIds.length > 0) {
    return {
      ok: false,
      errorCode: 'execution_run_invalid_action_input',
      error: `Unknown finding ids: ${unknownIds.join(', ')}`,
    };
  }

  const selectedFindings = requestedIds.map((id) => findingsById.get(id) as ReviewFinding);
  const prompt = buildReviewFindingFixPrompt({
    findings: selectedFindings,
    includePatch: parsed.data.includePatch === true,
  });

  try {
    if (parsed.data.mode === 'send_to_session') {
      await deps.sendToSession({
        text: prompt,
        meta: { source: 'review_finding_apply', runId: run.runId },
      });
      return { ok: true, result: { mode: 'send_to_session', findingIds: requestedIds, sessionId: run.sessionId } };
    }

    const spawnResult = await deps.spawnSession({
      text: prompt,
      directory: deps.cwd,
      permissionMode: toSessionPermissionMode(parsed.data.permissionMode),
    });
    return { ok: true, result: { mode: 'spawn_session', findingIds: requestedIds, spawned: spawnResult } };
  } catch (error) {
    return {
      ok: false,
      errorCode: 'execution_run_failed',
      error: error instanceof Error ? error.message : 'Failed to apply review findings',
    };
  }
}
