/**
 * Reimplementation of Happier's only programmatic review-scope resolver:
 * apps/cli/src/agent/reviews/engines/coderabbit/preflightCodeRabbitReviewScope.ts.
 *
 * Edge cases handled (mirrored from that file):
 *  - git-worktree check via `rev-parse --is-inside-work-tree`
 *  - changeType committed / uncommitted / all
 *  - base resolution: explicit `branch`/`commit` returned verbatim, `none` →
 *    default base (`@{upstream}`, else the remote default branch via
 *    `symbolic-ref refs/remotes/<remote>/HEAD` with remote inference from the
 *    branch-owner prefix); throws when unresolvable
 *  - committed paths: `git diff --name-only <baseRef>...HEAD` — merge-base
 *    delegated to git's three-dot syntax (no explicit merge-base code)
 *  - uncommitted paths: `git diff --name-only --find-renames -z HEAD` +
 *    `git ls-files --others --exclude-standard -z` — renames and untracked
 *    files handled
 *  - dedup via Set; empty scope → error; `maxEligibleFiles` cap
 *
 * Not handled here (same as Happier's scope resolver):
 *  - binary detection (name-only listing), line numbers, explicit merge-base.
 *
 * Where pi-review cannot match Happier exactly (documented, not silent):
 *  - Happier resolves the default base only for the coderabbit engine. pi-review
 *    reuses the same resolution for its committed/all scopes, so the default
 *    base for a detached-HEAD checkout (no `@{upstream}`, no remote HEAD) throws
 *    the same "unable to resolve" error and requires an explicit `--base`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ReviewChangeType = 'uncommitted' | 'committed' | 'all';

export type ReviewBase =
  | { kind: 'none' }
  | { kind: 'branch'; baseBranch: string }
  | { kind: 'commit'; baseCommit: string };

export type ReviewScopeResult =
  | {
      ok: true;
      committedPaths: string[];
      uncommittedPaths: string[];
      trackedPaths: string[];
      untrackedPaths: string[];
      allPaths: string[];
      baseRef: string | null;
      eligibleFileCount: number;
    }
  | { ok: false; error: string };

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  });
  return String(result.stdout ?? '');
}

async function tryRunGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(cwd, args);
  } catch {
    return null;
  }
}

function parsePathsZ(raw: string | null): string[] {
  return String(raw ?? '')
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function ensureGitWorktree(cwd: string): Promise<boolean> {
  const raw = await tryRunGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return String(raw ?? '').trim() === 'true';
}

async function currentBranchName(cwd: string): Promise<string> {
  return String(await tryRunGit(cwd, ['branch', '--show-current']) ?? '').trim();
}

function branchOwnerPrefix(branch: string): string {
  const normalized = String(branch ?? '').trim();
  if (!normalized.includes('/')) return '';
  return normalized.split('/')[0] ?? '';
}

function parseGithubOwner(remoteUrl: string): string {
  const normalized = String(remoteUrl ?? '').trim();
  if (!normalized) return '';

  const sshMatch = normalized.match(/^[^@]+@[^:]+:([^/]+)\/[^/]+(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[0] ?? '';
  } catch {
    return '';
  }
}

async function inferRemoteFromBranchOwner(cwd: string): Promise<string> {
  const owner = branchOwnerPrefix(await currentBranchName(cwd));
  if (!owner) return '';

  for (const remoteName of ['upstream', 'origin', 'fork']) {
    const remoteUrl = await tryRunGit(cwd, ['remote', 'get-url', remoteName]);
    if (parseGithubOwner(String(remoteUrl ?? '')) === owner) {
      return remoteName;
    }
  }

  return '';
}

async function resolveRemoteDefaultBranch(cwd: string, remote: string): Promise<string> {
  const symbolic = await tryRunGit(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
  const trimmed = String(symbolic ?? '').trim();
  if (trimmed.includes('/')) {
    return trimmed.split('/').slice(1).join('/');
  }
  return '';
}

async function ensureRemoteRefAvailable(cwd: string, remote: string, branch: string): Promise<boolean> {
  const ref = `refs/remotes/${remote}/${branch}`;
  return (await tryRunGit(cwd, ['rev-parse', '--verify', ref])) !== null;
}

async function resolveDefaultBaseRef(cwd: string): Promise<string | null> {
  const upstream = String(
    await tryRunGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) ?? '',
  ).trim();
  if (upstream.includes('/')) {
    return upstream;
  }

  const inferredRemote = await inferRemoteFromBranchOwner(cwd);
  const remoteCandidates = new Set<string>();
  for (const candidate of [inferredRemote, 'upstream', 'origin', 'fork']) {
    const trimmed = String(candidate ?? '').trim();
    if (trimmed) remoteCandidates.add(trimmed);
  }

  for (const remote of remoteCandidates) {
    const branch = await resolveRemoteDefaultBranch(cwd, remote);
    if (!branch) continue;
    if (await ensureRemoteRefAvailable(cwd, remote, branch)) {
      return `${remote}/${branch}`;
    }
  }

  // No throw: a missing default base is an expected state in a fresh clone or a detached HEAD, and the
  // caller reports it as `{ ok: false }` like every other scope problem.
  return null;
}

async function listCommittedPaths(cwd: string, baseRef: string): Promise<string[]> {
  const raw = await runGit(cwd, ['diff', '--name-only', `${baseRef}...HEAD`]);
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function listUncommittedPaths(cwd: string): Promise<{
  tracked: string[];
  untracked: string[];
  all: string[];
}> {
  const tracked = await tryRunGit(cwd, ['diff', '--name-only', '--find-renames', '-z', 'HEAD']);
  const untracked = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  const trackedPaths = parsePathsZ(tracked);
  const untrackedPaths = parsePathsZ(untracked);
  return {
    tracked: trackedPaths,
    untracked: untrackedPaths,
    all: Array.from(new Set([...trackedPaths, ...untrackedPaths])),
  };
}

export async function resolveReviewBaseRef(params: Readonly<{
  cwd: string;
  changeType: ReviewChangeType;
  base: ReviewBase;
}>): Promise<string | null> {
  if (params.changeType !== 'committed' && params.changeType !== 'all') {
    return null;
  }

  if (params.base.kind === 'branch') {
    return params.base.baseBranch;
  }
  if (params.base.kind === 'commit') {
    return params.base.baseCommit;
  }
  return await resolveDefaultBaseRef(params.cwd);
}

export async function resolveReviewScope(params: Readonly<{
  cwd: string;
  changeType: ReviewChangeType;
  base: ReviewBase;
  maxEligibleFiles?: number | null;
}>): Promise<ReviewScopeResult> {
  const cwd = String(params.cwd ?? '').trim();
  if (!cwd) {
    return { ok: false, error: 'Review requires a working directory.' };
  }

  if (!(await ensureGitWorktree(cwd))) {
    return { ok: false, error: 'Review requires a git worktree in the current directory.' };
  }

  let committedPaths: string[] = [];
  let baseRef: string | null = null;
  if (params.changeType === 'committed' || params.changeType === 'all') {
    baseRef = await resolveReviewBaseRef({ cwd, changeType: params.changeType, base: params.base });
    if (!baseRef) {
      return {
        ok: false,
        error: `Could not resolve a base ref for a "${params.changeType}" review. Pass --base <branch|commit>, `
          + 'or run the review from a branch with an upstream.',
      };
    }
    committedPaths = await listCommittedPaths(cwd, baseRef);
  }

  let uncommittedPaths: string[] = [];
  let trackedPaths: string[] = [];
  let untrackedPaths: string[] = [];
  if (params.changeType === 'uncommitted' || params.changeType === 'all') {
    const uncommitted = await listUncommittedPaths(cwd);
    uncommittedPaths = uncommitted.all;
    trackedPaths = uncommitted.tracked;
    untrackedPaths = uncommitted.untracked;
  }

  const allPaths = Array.from(new Set([...committedPaths, ...uncommittedPaths]));
  const eligibleFileCount = allPaths.length;
  if (eligibleFileCount <= 0) {
    return {
      ok: false,
      error:
        'No reviewable files found in the current scope. Change the review scope, choose another change type, or run the review from a directory rooted at the files you want reviewed.',
    };
  }

  const maxEligibleFiles =
    typeof params.maxEligibleFiles === 'number' && Number.isFinite(params.maxEligibleFiles)
      ? Math.max(1, Math.trunc(params.maxEligibleFiles))
      : null;
  if (maxEligibleFiles !== null && eligibleFileCount > maxEligibleFiles) {
    return {
      ok: false,
      error:
        `Too many reviewable files found in the current scope (${eligibleFileCount} > ${maxEligibleFiles}). Narrow the review scope or choose another change type.`,
    };
  }

  return {
    ok: true,
    committedPaths,
    uncommittedPaths,
    trackedPaths,
    untrackedPaths,
    allPaths,
    baseRef,
    eligibleFileCount,
  };
}
