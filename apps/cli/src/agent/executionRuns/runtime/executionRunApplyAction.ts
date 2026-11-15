import { randomUUID } from 'node:crypto';

import {
  ReviewFindingsV1Schema,
  ReviewFindingsV2Schema,
  ReviewFollowUpInputSchema,
  type SessionPermissionMode,
} from '@happier-dev/protocol';

import type { ACPMessageData, ACPProvider } from '@/api/session/sessionMessageTypes';
import type { AcpSendFn } from '@/agent/acp/bridge/acpSessionForwarding';
import { resolveExecutionRunIntentProfile } from '@/agent/executionRuns/profiles/intentRegistry';
import type { ExecutionRunStructuredMeta } from '@/agent/executionRuns/profiles/ExecutionRunIntentProfile';
import { buildReviewFindingsV2Payload } from '@/agent/reviews/normalize/buildReviewFindingsV2Payload';
import { VoiceAgentError, type VoiceAgentManager } from '@/agent/voice/agent/VoiceAgentManager';
import { buildExecutionRunProfileStartParams } from '@/agent/executionRuns/runtime/buildExecutionRunProfileStartParams';
import type {
  ExecutionRunActionDeps,
  ExecutionRunActionParams,
  ExecutionRunActionResult,
  ExecutionRunManagerStartParams,
  ExecutionRunStartResult,
  ExecutionRunState,
} from '@/agent/executionRuns/runtime/executionRunTypes';
import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';
import { publishReviewFindings } from '@/agent/executionRuns/runtime/executionRunReviewPublish';
import { applyReviewFindingFix } from '@/agent/executionRuns/runtime/executionRunReviewFindingApply';

type CommitActionOutcomeInput = Readonly<{
  updatedStructuredMeta?: ExecutionRunStructuredMeta;
  updatedToolResultOutput?: unknown;
  updatedToolResultMeta?: Record<string, unknown>;
  /** RPC-visible action result (e.g. the publish summary), carried back without a structured-meta field. */
  result?: unknown;
}>;

/**
 * Shared tail for run actions that already resolved their outcome: persist the updated structured
 * meta + tool result into the run map, re-emit an ACP tool-result so the owning tool-call message can
 * merge the updated meta, and return the canonical action-result shape. Used by the profile path and
 * the `review.publish` / `review.finding.apply` branches so their write-back reaches the UI caller.
 */
async function commitActionOutcome(args: Readonly<{
  runId: string;
  run: ExecutionRunState;
  actionId: string;
  runs: Map<string, ExecutionRunState>;
  outcome: CommitActionOutcomeInput;
  sendAcp: AcpSendFn;
  sendCommittedAcp?: (
    provider: ACPProvider,
    body: ACPMessageData,
    opts: { localId: string; meta?: Record<string, unknown> },
  ) => Promise<void>;
  parentProvider: ACPProvider;
}>): Promise<ExecutionRunActionResult> {
  const { runId, run, actionId, runs, outcome, sendAcp, sendCommittedAcp, parentProvider } = args;

  runs.set(runId, {
    ...run,
    ...(outcome.updatedStructuredMeta ? { structuredMeta: outcome.updatedStructuredMeta } : {}),
    ...(typeof outcome.updatedToolResultOutput !== 'undefined' ? { latestToolResult: outcome.updatedToolResultOutput } : {}),
  });

  const output = outcome.updatedToolResultOutput ?? { ok: true, actionId };
  const toolResultBody: ACPMessageData = {
    type: 'tool-result',
    callId: run.callId,
    output,
    id: randomUUID(),
  };

  if (sendCommittedAcp) {
    try {
      await sendCommittedAcp(parentProvider, toolResultBody, {
        localId: randomUUID(),
        ...(outcome.updatedToolResultMeta ? { meta: outcome.updatedToolResultMeta } : {}),
      });
    } catch {
      sendAcp(
        parentProvider,
        toolResultBody,
        outcome.updatedToolResultMeta ? { meta: outcome.updatedToolResultMeta } : undefined,
      );
    }
  } else {
    // Re-emit a tool-result so the owning tool-call message can merge updated meta.
    sendAcp(
      parentProvider,
      toolResultBody,
      outcome.updatedToolResultMeta ? { meta: outcome.updatedToolResultMeta } : undefined,
    );
  }

  return {
    ok: true,
    ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    updatedToolResult: output,
  };
}

export async function applyExecutionRunAction(args: Readonly<{
  runId: string;
  params: ExecutionRunActionParams;
  runs: Map<string, ExecutionRunState>;
  controllers: ReadonlyMap<string, ExecutionRunController>;
  voiceAgentManager: VoiceAgentManager;
  startRun: (params: ExecutionRunManagerStartParams) => Promise<ExecutionRunStartResult>;
  sendAcp: AcpSendFn;
  sendCommittedAcp?: (
    provider: ACPProvider,
    body: ACPMessageData,
    opts: { localId: string; meta?: Record<string, unknown> },
  ) => Promise<void>;
  parentProvider: ACPProvider;
  /** Send a user input into the originating (parent) session. Reused by `review.finding.apply`. */
  enqueueParentSessionInput?: (input: Readonly<{ text: string; meta: Record<string, unknown> }>) => Promise<void>;
  /** Spawn a new session in the same workspace. Reused by `review.finding.apply`. */
  spawnSession?: (input: Readonly<{ text: string; directory: string; permissionMode: SessionPermissionMode }>) => Promise<unknown>;
  deps?: ExecutionRunActionDeps;
}>): Promise<ExecutionRunActionResult> {
  const run = args.runs.get(args.runId);
  if (!run) return { ok: false, errorCode: 'execution_run_not_found', error: 'Not found' };

  if (run.intent === 'review' && String(args.params.actionId ?? '').trim() === 'review.follow_up') {
    const canResume = run.retentionPolicy === 'resumable' && Boolean(run.resumeHandle);
    const canFallback = (() => {
      const target = run.backendTarget;
      if (!target) return false;
      if (target.kind !== 'builtInAgent') return false;
      // Coderabbit runs are not follow-up capable unless we can resume the original vendor session.
      if (target.agentId === 'coderabbit') return false;
      return true;
    })();
    if (!canResume && !canFallback) {
      return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Follow-up is not supported for this run' };
    }

    const parsed = ReviewFollowUpInputSchema.safeParse(args.params.input ?? {});
    if (!parsed.success) {
      return { ok: false, errorCode: 'execution_run_invalid_action_input', error: 'Invalid follow-up input' };
    }

    const existingPayload =
      run.structuredMeta?.kind === 'review_findings.v2'
        ? ReviewFindingsV2Schema.parse(run.structuredMeta.payload)
        : run.structuredMeta?.kind === 'review_findings.v1'
          ? (() => {
            const legacy = ReviewFindingsV1Schema.parse(run.structuredMeta.payload);
            return buildReviewFindingsV2Payload({
              runId: legacy.runRef.runId,
              callId: legacy.runRef.callId,
              backendId: legacy.runRef.backendId,
              backendTarget: legacy.runRef.backendTarget,
              summary: legacy.summary,
              findings: legacy.findings,
              triage: legacy.triage,
              limits: legacy.limits,
              generatedAtMs: legacy.generatedAtMs,
            });
          })()
          : null;
    if (!existingPayload) {
      return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Not a review run' };
    }

    const threadId = parsed.data.threadId ?? `review_thread_${randomUUID()}`;
    const started = await args.startRun({
      sessionId: run.sessionId,
      intent: 'review',
      backendTarget: run.backendTarget,
      instructions: run.instructions,
      intentInput: {
        kind: 'review_follow_up.v1',
        parentRunRef: existingPayload.runRef,
        threadId,
        findingIds: parsed.data.findingIds,
        ...(parsed.data.replyToQuestionId ? { replyToQuestionId: parsed.data.replyToQuestionId } : {}),
        messageMarkdown: parsed.data.messageMarkdown,
        summary: existingPayload.summary,
        overviewMarkdown: existingPayload.overviewMarkdown,
        findings: existingPayload.findings,
        questions: existingPayload.questions,
        assumptions: existingPayload.assumptions,
      },
      ...(run.display ? { display: run.display } : {}),
      permissionMode: run.permissionMode,
      retentionPolicy: run.resumeHandle ? 'resumable' : 'ephemeral',
      runClass: 'bounded',
      ioMode: 'streaming',
      ...(run.resumeHandle ? { resumeHandle: run.resumeHandle } : {}),
      parentRunId: run.runId,
    });

    return { ok: true, result: { threadId, ...started } };
  }

  if (run.intent === 'review' && String(args.params.actionId ?? '').trim() === 'review.publish') {
    const deps = args.deps;
    if (!deps?.cwd || !deps?.connectedAccounts) {
      return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Review publishing is not wired yet' };
    }
    const outcome = await publishReviewFindings({
      run,
      input: args.params.input,
      deps: {
        cwd: deps.cwd,
        connectedAccounts: deps.connectedAccounts,
        ...(deps.featureDecision ? { featureDecision: deps.featureDecision } : {}),
      },
    });
    if (!outcome.ok) return outcome;
    return commitActionOutcome({
      runId: args.runId,
      run,
      actionId: 'review.publish',
      runs: args.runs,
      outcome: {
        updatedStructuredMeta: outcome.updatedStructuredMeta,
        updatedToolResultOutput: { ok: true, actionId: 'review.publish', result: outcome.result },
        updatedToolResultMeta: outcome.updatedToolResultMeta,
        result: outcome.result,
      },
      sendAcp: args.sendAcp,
      sendCommittedAcp: args.sendCommittedAcp,
      parentProvider: args.parentProvider,
    });
  }

  if (run.intent === 'review' && String(args.params.actionId ?? '').trim() === 'review.finding.apply') {
    const deps = args.deps;
    const sendToSession = args.enqueueParentSessionInput;
    const spawnSession = args.spawnSession;
    if (!deps?.cwd || !sendToSession || !spawnSession) {
      return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Review finding apply is not wired yet' };
    }
    const outcome = await applyReviewFindingFix({
      run,
      input: args.params.input,
      deps: { cwd: deps.cwd, sendToSession, spawnSession },
    });
    if (!outcome.ok) return outcome;
    return commitActionOutcome({
      runId: args.runId,
      run,
      actionId: 'review.finding.apply',
      runs: args.runs,
      outcome: {
        updatedToolResultOutput: { ok: true, actionId: 'review.finding.apply', result: outcome.result },
        result: outcome.result,
      },
      sendAcp: args.sendAcp,
      sendCommittedAcp: args.sendCommittedAcp,
      parentProvider: args.parentProvider,
    });
  }

  if (run.intent === 'voice_agent') {
    const actionId = String(args.params.actionId ?? '').trim();
    if (actionId === 'voice_agent.commit') {
      const ctrl = args.controllers.get(args.runId);
      if (!ctrl || ctrl.kind !== 'voice_agent') {
        return { ok: false, errorCode: 'execution_run_not_allowed', error: 'Not running' };
      }
      try {
        const maxChars = (() => {
          const v: any = args.params.input ?? null;
          const raw = Number(v?.maxChars ?? 0);
          return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
        })();
        const committed = await args.voiceAgentManager.commit({ voiceAgentId: ctrl.voiceAgentId, ...(maxChars ? { maxChars } : {}) });
        const updatedResumeHandle = run.retentionPolicy === 'resumable' ? args.voiceAgentManager.getResumeHandle(ctrl.voiceAgentId) : null;
        if (updatedResumeHandle && run.retentionPolicy === 'resumable') {
          const latest = args.runs.get(args.runId) ?? null;
          if (latest && latest.status === 'running') {
            args.runs.set(args.runId, { ...latest, resumeHandle: updatedResumeHandle });
          }
        }
        return { ok: true, result: { commitText: committed.commitText } };
      } catch (e) {
        if (e instanceof VoiceAgentError) {
          if (e.code === 'VOICE_AGENT_BUSY') return { ok: false, errorCode: 'execution_run_busy', error: e.message };
          if (e.code === 'VOICE_AGENT_NOT_FOUND') return { ok: false, errorCode: 'execution_run_not_found', error: e.message };
          return { ok: false, errorCode: 'execution_run_failed', error: e.message };
        }
        return { ok: false, errorCode: 'execution_run_failed', error: e instanceof Error ? e.message : 'Commit failed' };
      }
    }
    if (actionId === 'voice_agent.welcome') {
      const ctrl = args.controllers.get(args.runId);
      if (!ctrl || ctrl.kind !== 'voice_agent') {
        return { ok: false, errorCode: 'execution_run_not_allowed', error: 'Not running' };
      }
      try {
        const welcomeText = (() => {
          const v: any = args.params.input ?? null;
          const raw = typeof v?.welcomeText === 'string' ? v.welcomeText.trim() : '';
          return raw ? raw : undefined;
        })();
        const welcomed = await args.voiceAgentManager.welcome({ voiceAgentId: ctrl.voiceAgentId, ...(welcomeText ? { welcomeText } : {}) });
        return { ok: true, result: { assistantText: welcomed.assistantText } };
      } catch (e) {
        if (e instanceof VoiceAgentError) {
          if (e.code === 'VOICE_AGENT_BUSY') return { ok: false, errorCode: 'execution_run_busy', error: e.message };
          if (e.code === 'VOICE_AGENT_NOT_FOUND') return { ok: false, errorCode: 'execution_run_not_found', error: e.message };
          return { ok: false, errorCode: 'execution_run_failed', error: e.message };
        }
        return { ok: false, errorCode: 'execution_run_failed', error: e instanceof Error ? e.message : 'Welcome failed' };
      }
    }
  }

  const profile = resolveExecutionRunIntentProfile(run.intent);
  if (!profile.applyAction) {
    return { ok: false, errorCode: 'execution_run_action_not_supported', error: 'Unsupported action' };
  }

  const acted = profile.applyAction({
    start: buildExecutionRunProfileStartParams(run),
    actionId: args.params.actionId,
    input: args.params.input,
    structuredMeta: run.structuredMeta ?? null,
  });

  if (!acted.ok) {
    return { ok: false, errorCode: acted.errorCode, error: acted.error };
  }

  return commitActionOutcome({
    runId: args.runId,
    run,
    actionId: args.params.actionId,
    runs: args.runs,
    outcome: {
      updatedStructuredMeta: acted.updatedStructuredMeta,
      updatedToolResultOutput: acted.updatedToolResultOutput,
      updatedToolResultMeta: acted.updatedToolResultMeta,
    },
    sendAcp: args.sendAcp,
    sendCommittedAcp: args.sendCommittedAcp,
    parentProvider: args.parentProvider,
  });
}
