import { describe, expect, it, vi } from 'vitest';

import type { ReviewFinding, SessionPermissionMode } from '@happier-dev/protocol';

import type { ExecutionRunState } from '@/agent/executionRuns/runtime/executionRunTypes';
import { buildReviewFindingsV2Payload } from '@/agent/reviews/normalize/buildReviewFindingsV2Payload';
import {
  applyReviewFindingFix,
  buildReviewFindingFixPrompt,
  type ReviewFindingApplyDeps,
} from '@/agent/executionRuns/runtime/executionRunReviewFindingApply';

function makeFinding(overrides: Partial<ReviewFinding> & Pick<ReviewFinding, 'id'>): ReviewFinding {
  return {
    title: overrides.title ?? 'Title',
    severity: overrides.severity ?? 'low',
    category: overrides.category ?? 'style',
    summary: overrides.summary ?? 'Summary',
    ...overrides,
  };
}

function makeRun(structuredMeta: { kind: string; payload: unknown }): ExecutionRunState {
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
    structuredMeta,
  };
}

function makeV2Run(findings: ReviewFinding[]): ExecutionRunState {
  return makeRun({
    kind: 'review_findings.v2',
    payload: buildReviewFindingsV2Payload({
      runId: 'run-1',
      callId: 'call-1',
      backendId: 'claude',
      summary: 'Summary',
      findings,
      generatedAtMs: 1,
    }),
  });
}

function makeDeps(overrides: Partial<ReviewFindingApplyDeps> = {}): ReviewFindingApplyDeps {
  return {
    cwd: '/workspace',
    sendToSession: vi.fn(async (_input: Readonly<{ text: string; meta: Record<string, unknown> }>) => {}),
    spawnSession: vi.fn(async (_input: Readonly<{ text: string; directory: string; permissionMode: SessionPermissionMode }>) => ({ sessionId: 'spawned-1' })),
    ...overrides,
  };
}

describe('buildReviewFindingFixPrompt', () => {
  it('includes each finding exactly once with its location', () => {
    const prompt = buildReviewFindingFixPrompt({
      includePatch: false,
      findings: [
        makeFinding({ id: 'f1', title: 'First', filePath: 'src/a.ts', startLine: 10, summary: 'Do it.' }),
        makeFinding({ id: 'f2', title: 'Second', filePath: 'src/b.ts', startLine: 42, summary: 'Also.' }),
      ],
    });

    expect(prompt).toContain('Finding f1');
    expect(prompt).toContain('Location: src/a.ts:10');
    expect(prompt).toContain('Finding f2');
    expect(prompt).toContain('Location: src/b.ts:42');
    expect(prompt.match(/Finding f1/g)).toHaveLength(1);
    expect(prompt.match(/Finding f2/g)).toHaveLength(1);
  });

  it('embeds patch as proposed text only when includePatch is set', () => {
    const finding = makeFinding({ id: 'f1', patch: '--- a.ts\n+++ b.ts' });
    const withPatch = buildReviewFindingFixPrompt({ includePatch: true, findings: [finding] });
    expect(withPatch).toContain('Proposed text to read');
    expect(withPatch).toContain('--- a.ts\n+++ b.ts');

    const withoutPatch = buildReviewFindingFixPrompt({ includePatch: false, findings: [finding] });
    expect(withoutPatch).not.toContain('--- a.ts');
  });
});

describe('applyReviewFindingFix', () => {
  it('selects requested finding ids order-preserving and deduped', async () => {
    const sendToSession = vi.fn(async (_input: Readonly<{ text: string; meta: Record<string, unknown> }>) => {});
    const result = await applyReviewFindingFix({
      run: makeV2Run([
        makeFinding({ id: 'f1' }),
        makeFinding({ id: 'f2' }),
        makeFinding({ id: 'f3' }),
      ]),
      input: { runId: 'run-1', findingIds: ['f2', 'f1', 'f2'], mode: 'send_to_session' },
      deps: makeDeps({ sendToSession }),
    });

    expect(result.ok).toBe(true);
    const sent = sendToSession.mock.calls[0][0];
    expect(sent.text).toContain('Finding f2');
    expect(sent.text).toContain('Finding f1');
    expect(sent.text).not.toContain('Finding f3');
    expect(sent.text.match(/Finding f1/g)).toHaveLength(1);
    expect(sent.text.match(/Finding f2/g)).toHaveLength(1);
    expect(result).toMatchObject({ result: { mode: 'send_to_session', findingIds: ['f2', 'f1'], sessionId: 'session-1' } });
  });

  it('fails for an unknown finding id, naming the ids', async () => {
    const result = await applyReviewFindingFix({
      run: makeV2Run([makeFinding({ id: 'f1' })]),
      input: { runId: 'run-1', findingIds: ['f1', 'nope'], mode: 'send_to_session' },
      deps: makeDeps(),
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'execution_run_invalid_action_input',
    });
    expect(String(result.error)).toContain('nope');
  });

  it('fails for a non-review run', async () => {
    const result = await applyReviewFindingFix({
      run: makeRun({ kind: 'other', payload: {} }),
      input: { runId: 'run-1', findingIds: ['f1'], mode: 'send_to_session' },
      deps: makeDeps(),
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'execution_run_action_not_supported',
      error: 'Not a review run',
    });
  });

  it('up-converts review_findings.v1 meta', async () => {
    const sendToSession = vi.fn(async (_input: Readonly<{ text: string; meta: Record<string, unknown> }>) => {});
    const result = await applyReviewFindingFix({
      run: makeRun({
        kind: 'review_findings.v1',
        payload: {
          runRef: { runId: 'run-1', callId: 'call-1', backendId: 'claude' },
          summary: 'Summary',
          findings: [makeFinding({ id: 'f1', title: 'Legacy', filePath: 'legacy.ts', startLine: 3 })],
          generatedAtMs: 1,
        },
      }),
      input: { runId: 'run-1', findingIds: ['f1'], mode: 'send_to_session' },
      deps: makeDeps({ sendToSession }),
    });

    expect(result.ok).toBe(true);
    const sent = sendToSession.mock.calls[0][0];
    expect(sent.text).toContain('Finding f1');
    expect(sent.text).toContain('Location: legacy.ts:3');
  });

  it('routes send_to_session to the send helper', async () => {
    const sendToSession = vi.fn(async (_input: Readonly<{ text: string; meta: Record<string, unknown> }>) => {});
    const spawnSession = vi.fn(async (_input: Readonly<{ text: string; directory: string; permissionMode: SessionPermissionMode }>) => ({}));
    await applyReviewFindingFix({
      run: makeV2Run([makeFinding({ id: 'f1' })]),
      input: { runId: 'run-1', findingIds: ['f1'], mode: 'send_to_session' },
      deps: { cwd: '/workspace', sendToSession, spawnSession },
    });

    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(spawnSession).not.toHaveBeenCalled();
    expect(sendToSession.mock.calls[0][0].meta).toMatchObject({
      source: 'review_finding_apply',
      runId: 'run-1',
    });
  });

  it('routes spawn_session to the spawn helper with the workspace and permission mode', async () => {
    const sendToSession = vi.fn(async (_input: Readonly<{ text: string; meta: Record<string, unknown> }>) => {});
    const spawnSession = vi.fn(async (_input: Readonly<{ text: string; directory: string; permissionMode: SessionPermissionMode }>) => ({ sessionId: 'spawned-1' }));
    const result = await applyReviewFindingFix({
      run: makeV2Run([makeFinding({ id: 'f1' })]),
      input: { runId: 'run-1', findingIds: ['f1'], mode: 'spawn_session', permissionMode: 'workspace_write' },
      deps: { cwd: '/workspace', sendToSession, spawnSession },
    });

    expect(spawnSession).toHaveBeenCalledTimes(1);
    expect(sendToSession).not.toHaveBeenCalled();
    expect(spawnSession.mock.calls[0][0]).toMatchObject({
      directory: '/workspace',
      permissionMode: 'acceptEdits',
    });
    expect(result).toMatchObject({ ok: true, result: { mode: 'spawn_session' } });
  });

  it('defaults permission mode to read_only for spawn_session', async () => {
    const spawnSession = vi.fn(async (_input: Readonly<{ text: string; directory: string; permissionMode: SessionPermissionMode }>) => ({}));
    await applyReviewFindingFix({
      run: makeV2Run([makeFinding({ id: 'f1' })]),
      input: { runId: 'run-1', findingIds: ['f1'], mode: 'spawn_session' },
      deps: makeDeps({ spawnSession }),
    });

    // The action's read_only intent reaches the spawned session as read-only.
    expect(spawnSession.mock.calls[0][0].permissionMode).toBe('read-only');
  });

  it('errors with an error code when stored meta is malformed instead of throwing', async () => {
    const result = await applyReviewFindingFix({
      run: makeRun({ kind: 'review_findings.v2', payload: { runRef: { runId: 'run-1' } } }),
      input: { runId: 'run-1', findingIds: ['f1'], mode: 'send_to_session' },
      deps: makeDeps(),
    });

    expect(result).toMatchObject({ ok: false, errorCode: 'execution_run_invalid_action_input' });
    expect(String(result.error)).toContain('malformed');
  });
});
