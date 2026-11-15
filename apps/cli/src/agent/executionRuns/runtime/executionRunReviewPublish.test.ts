import { describe, expect, it, vi } from 'vitest';

import {
  buildConnectedServiceCredentialRecord,
  createFeatureDecision,
  type FeatureDecision,
  type ReviewFinding,
  type ReviewFindingsV2,
  type ReviewPublishRequestV1,
  type ScmHostingProvider,
  type ScmPullRequestSummary,
} from '@happier-dev/protocol';

import type { ExecutionRunState } from '@/agent/executionRuns/runtime/executionRunTypes';
import { buildReviewFindingsV2Payload } from '@/agent/reviews/normalize/buildReviewFindingsV2Payload';
import type { ScmBackendRegistry } from '@/scm/registry';
import {
  computeReviewLineContentHash,
  publishReviewFindings,
  REVIEW_LINE_HASH_ALGORITHM,
  type ReviewPublishDeps,
} from '@/agent/executionRuns/runtime/executionRunReviewPublish';

const githubProvider: ScmHostingProvider = {
  kind: 'github',
  name: 'GitHub',
  baseUrl: 'https://github.com',
  nameWithOwner: 'happier-dev/happier',
  remoteName: 'origin',
};

const enabledDecision: FeatureDecision = createFeatureDecision({
  featureId: 'scm.writeOperations',
  state: 'enabled',
  blockedBy: null,
  blockerCode: 'none',
  diagnostics: [],
  evaluatedAt: 1,
  scope: { scopeKind: 'runtime' },
});

const disabledDecision: FeatureDecision = createFeatureDecision({
  featureId: 'scm.writeOperations',
  state: 'disabled',
  blockedBy: 'local_policy',
  blockerCode: 'flag_disabled',
  diagnostics: [],
  evaluatedAt: 1,
  scope: { scopeKind: 'runtime' },
});

const githubCredential = buildConnectedServiceCredentialRecord({
  now: 1_000,
  serviceId: 'github',
  profileId: 'primary',
  kind: 'token',
  token: { token: 'ghp_connected', providerAccountId: '42', providerEmail: 'octo@example.com' },
});

function makeFinding(overrides: Partial<ReviewFinding> & Pick<ReviewFinding, 'id'>): ReviewFinding {
  return {
    title: overrides.title ?? 'Title',
    severity: overrides.severity ?? 'low',
    category: overrides.category ?? 'style',
    summary: overrides.summary ?? 'Summary',
    ...overrides,
  };
}

function makePayload(params: {
  findings: ReviewFinding[];
  summary?: string;
  overviewMarkdown?: string;
  publication?: ReviewFindingsV2['publication'];
}) {
  return {
    ...buildReviewFindingsV2Payload({
      runId: 'run-1',
      callId: 'call-1',
      backendId: 'claude',
      summary: params.summary ?? 'Summary',
      ...(params.overviewMarkdown ? { overviewMarkdown: params.overviewMarkdown } : {}),
      findings: params.findings,
      generatedAtMs: 1,
    }),
    ...(params.publication ? { publication: params.publication } : {}),
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

function publishInput(params: {
  findingIds: string[];
  publishedFindings: ReviewFinding[];
  pullRequestNumber?: number;
}): ReviewPublishRequestV1 {
  return {
    sourceRunRef: { runId: 'run-1', callId: 'call-1', backendId: 'claude' },
    findingIds: params.findingIds,
    publishedFindings: params.publishedFindings,
    ...(typeof params.pullRequestNumber === 'number' ? { pullRequestNumber: params.pullRequestNumber } : {}),
  };
}

type FakeList = ReturnType<typeof vi.fn>;
type FakeCreateReview = ReturnType<typeof vi.fn>;

function runPublish(params: {
  findings: ReviewFinding[];
  findingIds: string[];
  publication?: ReviewFindingsV2['publication'];
  summary?: string;
  overviewMarkdown?: string;
  featureDecision?: FeatureDecision;
  branchHead?: string | null;
  detached?: boolean;
  list?: FakeList;
  createReview?: FakeCreateReview;
  readFileLines?: (path: string) => Promise<string[] | null>;
  githubAuthAvailable?: boolean;
  gitlabAuthAvailable?: boolean;
  providerKind?: 'github' | 'gitlab';
  provider?: ScmHostingProvider | null;
  pullRequestNumber?: number;
  cwd?: string;
}) {
  const provider = params.provider === undefined
    ? (params.providerKind === 'gitlab'
      ? { kind: 'gitlab', name: 'GitLab', baseUrl: 'https://gitlab.com', nameWithOwner: 'x/y', remoteName: 'origin' } as ScmHostingProvider
      : githubProvider)
    : params.provider;

  const list = params.list ?? vi.fn(async () => ({
    success: true as const,
    pullRequests: [{
      provider: githubProvider,
      number: 42,
      title: 'PR',
      url: 'https://github.com/happier-dev/happier/pull/42',
      baseBranch: 'main',
      headBranch: 'feature-branch',
      state: 'open',
    } as ScmPullRequestSummary],
  }));
  const createReview = params.createReview ?? vi.fn(async () => ({
    success: true as const,
    reviewId: 'review-1',
    url: 'https://github.com/happier-dev/happier/pull/42',
  }));

  const backend = {
    pullRequests: { list, createReview },
    statusSnapshot: async () => ({
      success: true as const,
      snapshot: {
        hostingProvider: provider,
        branch: { head: params.branchHead ?? 'feature-branch', detached: params.detached ?? false },
      },
    }),
  };

  const selectBackend = vi.fn(async () => ({
    backend,
    detection: { isRepo: true, rootPath: '/repo', mode: '.git' },
    mode: '.git',
  }));
  const registry = { selectBackend } as unknown as ScmBackendRegistry;

  const deps: ReviewPublishDeps = {
    cwd: params.cwd ?? '/repo',
    connectedAccounts: {
      resolveCredential: async (serviceId) => serviceId === 'github' && params.githubAuthAvailable !== false
        ? githubCredential
        : null,
    },
    featureDecision: params.featureDecision ?? enabledDecision,
    scmRegistry: registry,
    detectGithubCliAuth: async () => ({ kind: 'missing-auth', command: 'gh', host: 'github.com' }),
    detectGitlabCliAuth: async () => params.gitlabAuthAvailable === true
      ? ({ kind: 'authenticated', command: 'glab', host: 'gitlab.com' })
      : ({ kind: 'missing-auth', command: 'glab', host: 'gitlab.com' }),
    readFileLines: params.readFileLines ?? (async () => null),
  };

  const payload = makePayload({
    findings: params.findings,
    ...(params.summary ? { summary: params.summary } : {}),
    ...(params.overviewMarkdown ? { overviewMarkdown: params.overviewMarkdown } : {}),
    ...(params.publication ? { publication: params.publication } : {}),
  });
  const run = makeRun({ kind: 'review_findings.v2', payload });
  const runs = new Map<string, ExecutionRunState>([[run.runId, run]]);

  const promise = publishReviewFindings({
    run,
    input: publishInput({
      findingIds: params.findingIds,
      publishedFindings: params.findings,
      ...(typeof params.pullRequestNumber === 'number' ? { pullRequestNumber: params.pullRequestNumber } : {}),
    }),
    deps,
    runs,
  });

  return { promise, runs, list, createReview, selectBackend };
}

describe('publishReviewFindings', () => {
  it('maps located findings to inline comments and body-only findings to severity-grouped body bullets', async () => {
    const located = makeFinding({
      id: 'f1',
      filePath: 'src/a.ts',
      startLine: 1,
      severity: 'low',
      category: 'style',
      title: 'Use const',
      summary: 'Prefer const here.',
    });
    const bodyOnly = makeFinding({
      id: 'f2',
      severity: 'medium',
      category: 'correctness',
      title: 'Null check',
      summary: 'Handle null.',
    });

    const harness = runPublish({
      findings: [located, bodyOnly],
      findingIds: ['f1', 'f2'],
      overviewMarkdown: '## Overview',
      readFileLines: async () => ['const x = 1;', 'const y = 2;'],
    });

    const result = await harness.promise;

    expect(result.ok).toBe(true);
    expect(harness.createReview).toHaveBeenCalledTimes(1);
    const request = harness.createReview.mock.calls[0][0].request;
    expect(request.event).toBe('comment');
    expect(request.comments).toEqual([
      expect.objectContaining({ path: 'src/a.ts', line: 1, side: 'new' }),
    ]);
    expect(request.comments[0].body).toContain('Use const');
    expect(request.body).toContain('## Medium');
    expect(request.body).toContain('Null check');
    expect(request.body).toContain('## Overview');

    expect(result).toMatchObject({
      ok: true,
      result: {
        published: 2,
        skipped: 0,
        reviewId: 'review-1',
        pullRequest: { number: 42, url: 'https://github.com/happier-dev/happier/pull/42' },
      },
    });

    // Write-back: both findings carry publication, and the located finding gained a line hash.
    const updatedMeta = harness.runs.get('run-1')?.structuredMeta;
    expect(updatedMeta?.kind).toBe('review_findings.v2');
    const updatedPayload = updatedMeta?.payload as ReviewFindingsV2;
    expect(updatedPayload.publication?.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'f1', published: true, publishedMessageRef: 'review-1' }),
        expect.objectContaining({ id: 'f2', published: true, publishedMessageRef: 'review-1' }),
      ]),
    );
    const f1 = updatedPayload.findings.find((f) => f.id === 'f1');
    expect(f1?.lineHash).toBe(computeReviewLineContentHash('const x = 1;'));
    expect(f1?.lineHashAlgorithm).toBe(REVIEW_LINE_HASH_ALGORITHM);
  });

  it('selects request_changes when any published finding is blocker or high, else comment', async () => {
    const blocker = makeFinding({ id: 'b1', severity: 'blocker', filePath: 'src/a.ts', startLine: 1 });
    const blockerHarness = runPublish({
      findings: [blocker],
      findingIds: ['b1'],
      readFileLines: async () => ['x'],
    });
    const blockerResult = await blockerHarness.promise;
    expect(blockerResult.ok).toBe(true);
    expect(blockerHarness.createReview.mock.calls[0][0].request.event).toBe('request_changes');

    const low = makeFinding({ id: 'l1', severity: 'low', filePath: 'src/a.ts', startLine: 1 });
    const lowHarness = runPublish({
      findings: [low],
      findingIds: ['l1'],
      readFileLines: async () => ['x'],
    });
    const lowResult = await lowHarness.promise;
    expect(lowResult.ok).toBe(true);
    expect(lowHarness.createReview.mock.calls[0][0].request.event).toBe('comment');
  });

  it('skips already-published findings and returns ok when nothing remains', async () => {
    const done = makeFinding({ id: 'done', filePath: 'src/a.ts', startLine: 1 });
    const fresh = makeFinding({ id: 'fresh', filePath: 'src/b.ts', startLine: 2 });

    const harness = runPublish({
      findings: [done, fresh],
      findingIds: ['done', 'fresh'],
      publication: { findings: [{ id: 'done', published: true, publishedAtMs: 5, publishedMessageRef: 'old-review' }] },
      readFileLines: async () => ['a', 'b'],
    });
    const result = await harness.promise;

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ result: { published: 1, skipped: 1 } });
    expect(harness.createReview).toHaveBeenCalledTimes(1);
    const request = harness.createReview.mock.calls[0][0].request;
    expect(request.comments).toHaveLength(1);
    expect(request.comments[0].path).toBe('src/b.ts');
  });

  it('returns ok with a message when every requested finding is already published', async () => {
    const done = makeFinding({ id: 'done', filePath: 'src/a.ts', startLine: 1 });
    const harness = runPublish({
      findings: [done],
      findingIds: ['done'],
      publication: { findings: [{ id: 'done', published: true }] },
    });
    const result = await harness.promise;

    expect(result).toMatchObject({ ok: true, result: { published: 0, skipped: 1 } });
    expect(result.result).toHaveProperty('message');
    expect(harness.createReview).not.toHaveBeenCalled();
  });

  it('fails with execution_run_failed naming the branch when no open PR exists', async () => {
    const finding = makeFinding({ id: 'f1', filePath: 'src/a.ts', startLine: 1 });
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      branchHead: 'feature-branch',
      list: vi.fn(async () => ({ success: true as const, pullRequests: [] })),
    });
    const result = await harness.promise;

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('execution_run_failed');
    expect(result.error).toContain('feature-branch');
    expect(harness.createReview).not.toHaveBeenCalled();
  });

  it('fails closed with execution_run_not_allowed when scm.writeOperations is disabled', async () => {
    const finding = makeFinding({ id: 'f1', filePath: 'src/a.ts', startLine: 1 });
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      featureDecision: disabledDecision,
    });
    const result = await harness.promise;

    expect(result).toMatchObject({ ok: false, errorCode: 'execution_run_not_allowed' });
    expect(result.error).toContain('scm.writeOperations');
    expect(harness.selectBackend).not.toHaveBeenCalled();
    expect(harness.createReview).not.toHaveBeenCalled();
  });

  it('distinguishes not-authenticated from no-PR before listing', async () => {
    const finding = makeFinding({ id: 'f1', filePath: 'src/a.ts', startLine: 1 });
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      githubAuthAvailable: false,
    });
    const result = await harness.promise;

    expect(result).toMatchObject({ ok: false, errorCode: 'execution_run_not_allowed' });
    expect(result.error).toContain('GitHub authentication');
    expect(harness.list).not.toHaveBeenCalled();
  });

  it('re-anchors a comment when the line hash matches within ±200 lines', async () => {
    const target = 'const target = 1;';
    const finding = makeFinding({
      id: 'f1',
      filePath: 'src/a.ts',
      startLine: 5,
      lineHash: computeReviewLineContentHash(target),
      lineHashAlgorithm: REVIEW_LINE_HASH_ALGORITHM,
    });
    const lines = ['l1', 'l2', 'l3', 'l4', 'stale-line', 'l6', 'l7', 'l8', 'l9', 'l10', target];
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      readFileLines: async () => lines,
    });
    const result = await harness.promise;

    expect(result.ok).toBe(true);
    const request = harness.createReview.mock.calls[0][0].request;
    expect(request.comments[0].line).toBe(11);
    expect(request.comments[0].body).not.toContain('Anchor could not be re-verified');
  });

  it('degrades a lost anchor to a body bullet instead of guessing a line', async () => {
    const finding = makeFinding({
      id: 'f1',
      filePath: 'src/a.ts',
      startLine: 3,
      lineHash: computeReviewLineContentHash('moved-away-line'),
      lineHashAlgorithm: REVIEW_LINE_HASH_ALGORITHM,
    });
    const lines = ['l1', 'l2', 'unique-current-line', 'l4'];
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      readFileLines: async () => lines,
    });
    const result = await harness.promise;

    expect(result.ok).toBe(true);
    const request = harness.createReview.mock.calls[0][0].request;
    // A guessed line can 422 the whole review, so the finding moves into the body instead.
    expect(request.comments).toHaveLength(0);
    expect(request.body).toContain('src/a.ts:3');
    expect(request.body).toContain(finding.title);
  });

  it('never reads a path outside the workspace and publishes it as a body bullet', async () => {
    const readCalls: string[] = [];
    const finding = makeFinding({
      id: 'f1',
      filePath: '../../etc/passwd',
      startLine: 1,
    });
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      cwd: '/repo',
      readFileLines: async (absolutePath: string) => {
        readCalls.push(absolutePath);
        return ['root:x:0:0:root:/root:/bin/sh'];
      },
    });
    const result = await harness.promise;

    expect(result.ok).toBe(true);
    expect(readCalls).toEqual([]);
    const request = harness.createReview.mock.calls[0][0].request;
    // Nothing was read from disk and no comment path escapes the workspace.
    expect(request.comments).toHaveLength(0);
  });

  it('caps inline comments at 100 and moves the overflow into the body', async () => {
    const findings = Array.from({ length: 103 }, (_, index) => makeFinding({
      id: `f${index + 1}`,
      filePath: 'src/a.ts',
      startLine: 1,
    }));
    const harness = runPublish({
      findings,
      findingIds: findings.map((finding) => finding.id),
      readFileLines: async () => ['const x = 1;'],
    });
    const result = await harness.promise;

    expect(result.ok).toBe(true);
    const request = harness.createReview.mock.calls[0][0].request;
    expect(request.comments).toHaveLength(100);
    // The three overflow findings still reach the review, as body bullets.
    expect(request.body).toContain('src/a.ts:1');
  });

  it('publishes to an explicit pullRequestNumber without listing pull requests', async () => {
    const finding = makeFinding({ id: 'f1', filePath: 'src/a.ts', startLine: 1 });
    const list = vi.fn(async () => ({ success: true as const, pullRequests: [] }));
    const harness = runPublish({
      findings: [finding],
      findingIds: ['f1'],
      pullRequestNumber: 77,
      list,
      readFileLines: async () => ['const x = 1;'],
    });
    const result = await harness.promise;

    expect(result.ok).toBe(true);
    expect(list).not.toHaveBeenCalled();
    const request = harness.createReview.mock.calls[0][0].request;
    expect(request.prReference).toEqual({ number: 77 });
  });

  it('rejects invalid input with execution_run_invalid_action_input', async () => {
    const finding = makeFinding({ id: 'f1' });
    const payload = makePayload({ findings: [finding] });
    const run = makeRun({ kind: 'review_findings.v2', payload });
    const runs = new Map<string, ExecutionRunState>([[run.runId, run]]);

    const result = await publishReviewFindings({
      run,
      input: { findingIds: 'not-an-array' },
      deps: {
        cwd: '/repo',
        connectedAccounts: { resolveCredential: async () => null },
        featureDecision: enabledDecision,
      },
      runs,
    });

    expect(result).toMatchObject({ ok: false, errorCode: 'execution_run_invalid_action_input' });
  });
});
