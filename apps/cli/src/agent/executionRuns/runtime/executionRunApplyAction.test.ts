import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ACPMessageData } from '@/api/session/sessionMessageTypes';
import type { ExecutionRunState } from '@/agent/executionRuns/runtime/executionRunTypes';
import type { VoiceAgentManager } from '@/agent/voice/agent/VoiceAgentManager';
import { applyExecutionRunAction } from '@/agent/executionRuns/runtime/executionRunApplyAction';
import { publishReviewFindings } from '@/agent/executionRuns/runtime/executionRunReviewPublish';
import { applyReviewFindingFix } from '@/agent/executionRuns/runtime/executionRunReviewFindingApply';

vi.mock('@/agent/executionRuns/runtime/executionRunReviewPublish', () => ({
  publishReviewFindings: vi.fn(),
}));

vi.mock('@/agent/executionRuns/runtime/executionRunReviewFindingApply', () => ({
  applyReviewFindingFix: vi.fn(),
}));

const mockedPublish = vi.mocked(publishReviewFindings);
const mockedApply = vi.mocked(applyReviewFindingFix);

type SentMessage = Readonly<{ provider: string; body: ACPMessageData; meta?: Record<string, unknown> }>;
type ApplyActionArgs = Parameters<typeof applyExecutionRunAction>[0];

function makeRun(): ExecutionRunState {
  return {
    runId: 'run-1',
    callId: 'call-1',
    sidechainId: 'sidechain-1',
    sessionId: 'session-1',
    depth: 0,
    intent: 'review',
    backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
    backendId: 'claude',
    instructions: '',
    permissionMode: 'read_only',
    retentionPolicy: 'ephemeral',
    runClass: 'bounded',
    ioMode: 'request_response',
    status: 'succeeded',
    startedAtMs: 100,
    structuredMeta: { kind: 'review_findings.v2', payload: {} },
  };
}

function makeHarness(overrides: Partial<ApplyActionArgs> = {}): {
  sent: SentMessage[];
  args: ApplyActionArgs;
} {
  const sent: SentMessage[] = [];
  const runs = new Map<string, ExecutionRunState>([['run-1', makeRun()]]);
  const args: ApplyActionArgs = {
    runId: 'run-1',
    params: { actionId: 'review.publish', input: {} },
    runs,
    controllers: new Map(),
    voiceAgentManager: {} as unknown as VoiceAgentManager,
    startRun: vi.fn(async () => ({ runId: '', callId: '', sidechainId: '' })),
    sendAcp: (provider, body, opts) => {
      sent.push({ provider, body, meta: opts?.meta });
    },
    parentProvider: 'claude',
    ...overrides,
  };
  return { sent, args };
}

describe('applyExecutionRunAction review.publish / review.finding.apply write-back', () => {
  beforeEach(() => {
    mockedPublish.mockReset();
    mockedApply.mockReset();
  });

  it('re-emits an ACP tool-result carrying the publication overlay for review.publish', async () => {
    const updatedStructuredMeta = {
      kind: 'review_findings.v2',
      payload: {
        publication: { findings: [{ id: 'f1', published: true, publishedMessageRef: 'review-1' }] },
      },
    };
    mockedPublish.mockResolvedValue({
      ok: true,
      result: { published: 1, skipped: 0, reviewId: 'review-1', pullRequest: { number: 42, url: 'https://x' } },
      updatedStructuredMeta,
      updatedToolResultMeta: { happier: updatedStructuredMeta },
    });

    const { sent, args } = makeHarness({
      deps: { cwd: '/repo', connectedAccounts: { resolveCredential: async () => null } },
    });
    const result = await applyExecutionRunAction(args);

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ result: { published: 1, skipped: 0 } });

    const toolResult = [...sent].reverse().find((m) => m.body?.type === 'tool-result' && m.meta);
    expect(toolResult).toBeTruthy();
    expect(toolResult?.meta).toEqual({ happier: updatedStructuredMeta });
    expect((toolResult?.body as { output?: { actionId?: string } })?.output?.actionId).toBe('review.publish');
  });

  it('routes review.finding.apply through the same write-back path as publish', async () => {
    // The nested danger posture is NOT enforced here (documented in the branch as a known gap: the generic
    // execution.run.action dispatcher carries no approval signal). What this pins is that the action still
    // commits its result and re-emits the tool result, which is the behaviour that regressed before.
    mockedApply.mockResolvedValue({
      ok: true,
      result: { mode: 'send_to_session', findingIds: ['f1'], sessionId: 'session-1' },
    });
    const { args } = makeHarness({
      params: { actionId: 'review.finding.apply', input: { findingIds: ['f1'], mode: 'send_to_session' } },
      deps: { cwd: '/repo' },
      enqueueParentSessionInput: vi.fn(async () => {}),
      spawnSession: vi.fn(async () => ({})),
    });
    const result = await applyExecutionRunAction(args);

    expect(result.ok).toBe(true);
    expect(mockedApply).toHaveBeenCalled();
  });
});
