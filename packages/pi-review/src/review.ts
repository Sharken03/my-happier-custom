/**
 * Core review flow: resolve the diff scope, resolve the model, gather the diff,
 * call the model, parse the trailing JSON, validate it, write
 * `.happier/review/<runId>.json`, and render a severity-sorted table.
 *
 * Divergences from Happier (documented):
 *  - Happier's LLM review engines compute no diff: `buildStandardReviewPrompt`
 *    emits only scope guidance and the model reads files itself with read-only
 *    tools. pi-review is a single-shot offline flow, so it inlines the diff
 *    content into the prompt instead of granting the model file tools.
 *  - Standalone run identity: `runId`/`callId` are generated locally
 *    (`crypto.randomUUID()`), `backendId` is `'pi'`, and no `publication`
 *    overlay is written (publication is Happier-only state).
 *  - Happier records the resolved model on the execution run's
 *    `requestedConfiguration`; `ReviewFindingsV2` has no such field. pi-review
 *    records the resolved policy + model id as `.passthrough()` extra keys on
 *    the findings payload (`requestedConfiguration`, `modelPolicy`, `depth`).
 *  - `--model` is a Pi model spec (`provider/modelId` or a bare model id), not a
 *    Happier model id — the id namespaces differ.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import {
  parseReviewFindingsV2,
  ReviewAssumptionSchema,
  ReviewFindingSchema,
  ReviewQuestionSchema,
  type ReviewFinding,
} from './schema.js';
import { resolveReviewScope, type ReviewBase, type ReviewChangeType } from './diffScope.js';
import { buildStandardReviewPrompt } from './prompt.js';
import {
  resolveReviewCallSitePolicyFlagMapping,
  resolveReviewModelPolicy,
  type ReviewModelPolicy,
} from './modelPolicy.js';

const execFileAsync = promisify(execFile);

// pi-review inlines the diff (Happier does not). Cap the inline to protect the
// model context window; this is a pi-review-specific guard, not a Happier bound.
const MAX_DIFF_CHARS = 500_000;

// The model returns the V2 shape minus the envelope fields the normalizer adds
// (runRef / generatedAtMs / triage / publication / limits).
const ModelReviewOutputSchema = z.object({
  summary: z.string().min(1),
  overviewMarkdown: z.string().min(1),
  findings: z.array(ReviewFindingSchema),
  questions: z.array(ReviewQuestionSchema).optional(),
  assumptions: z.array(ReviewAssumptionSchema).optional(),
}).passthrough();

export interface ReviewModelHost {
  activeModel: unknown;
  find: (provider: string, modelId: string) => unknown;
  hasConfiguredAuth?: (model: unknown) => boolean;
  complete: (
    model: unknown,
    context: { messages: unknown[] },
    options: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
}

export interface ReviewRunParams {
  host: ReviewModelHost;
  cwd: string;
  changeType?: ReviewChangeType;
  base?: string;
  model?: string;
  depth?: 'fast' | 'deep';
  instructions?: string;
  signal?: AbortSignal;
}

export interface ReviewRunResult {
  ok: boolean;
  message: string;
  runId?: string;
  path?: string;
  findingsCount?: number;
}

interface ResolvedModel {
  model: unknown;
  modelId: string;
  reasoningEffort?: string;
  depth?: 'fast' | 'deep';
  policy: ReviewModelPolicy;
}

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

function baseFromArg(base: string | undefined): ReviewBase {
  if (!base || base.trim().length === 0) return { kind: 'none' };
  const ref = base.trim();
  // Heuristic only: a full-ish hex string is treated as a commit; anything else
  // as a branch. `git diff <ref>...HEAD` accepts both, so this only affects the
  // scope-guidance wording, not the diff itself.
  if (/^[0-9a-f]{7,40}$/i.test(ref)) return { kind: 'commit', baseCommit: ref };
  return { kind: 'branch', baseBranch: ref };
}

function findModel(host: ReviewModelHost, modelId: string): unknown {
  const slash = modelId.indexOf('/');
  if (slash > 0) {
    const provider = modelId.slice(0, slash);
    const id = modelId.slice(slash + 1);
    return host.find(provider, id) ?? null;
  }

  const active = host.activeModel as { id?: string; provider?: string } | null;
  if (active?.id === modelId) return active;
  if (active?.provider) {
    const found = host.find(active.provider, modelId);
    if (found) return found;
  }
  for (const provider of ['anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'opencode', 'opencode-zen']) {
    const found = host.find(provider, modelId);
    if (found) return found;
  }
  return null;
}

function resolveModel(host: ReviewModelHost, params: {
  model?: string;
  depth?: 'fast' | 'deep';
}): { ok: true; resolved: ResolvedModel } | { ok: false; error: string } {
  const mapping = resolveReviewCallSitePolicyFlagMapping({ model: params.model ?? null, depth: params.depth ?? null });
  if (!mapping.ok) {
    return { ok: false, error: 'Passing both --model and --depth is a conflict (review_model_policy_conflict): only one may win.' };
  }

  let policy: ReviewModelPolicy;
  if (mapping.kind === 'fixed') {
    policy = { kind: 'fixed', modelId: mapping.modelId };
  } else if (mapping.kind === 'depth') {
    // Offline pi-review has no account/engine policy to name the fast/deep pair,
    // so the pair comes from environment variables. Fail loudly rather than
    // silently picking one model.
    const fast = process.env.PI_REVIEW_FAST_MODEL?.trim();
    const deep = process.env.PI_REVIEW_DEEP_MODEL?.trim();
    if (!fast || !deep) {
      return {
        ok: false,
        error:
          '--depth requires a fast/deep model pair: set PI_REVIEW_FAST_MODEL and PI_REVIEW_DEEP_MODEL (offline pi-review has no account/engine policy to name the pair).',
      };
    }
    policy = { kind: 'depth', fast: { modelId: fast }, deep: { modelId: deep }, depthDefault: mapping.depthDefault };
  } else {
    policy = { kind: 'inherit' };
  }

  const resolution = resolveReviewModelPolicy({ policy });

  if (resolution.modelId) {
    const model = findModel(host, resolution.modelId);
    if (!model) {
      return { ok: false, error: `Model not found: ${resolution.modelId} (use provider/modelId).` };
    }
    if (host.hasConfiguredAuth && host.hasConfiguredAuth(model) === false) {
      return { ok: false, error: `No authentication configured for model ${resolution.modelId}.` };
    }
    return {
      ok: true,
      resolved: {
        model,
        modelId: resolution.modelId,
        reasoningEffort: resolution.reasoningEffort,
        depth: resolution.depth,
        policy: resolution.policy,
      },
    };
  }

  // inherit: use the session's active model.
  const active = host.activeModel as { id?: string; provider?: string } | null;
  const activeId = active ? (active.id ? `${active.provider ?? ''}/${active.id}` : '') : '';
  if (!active) {
    return { ok: false, error: 'No model selected and none is active for this session.' };
  }
  return {
    ok: true,
    resolved: { model: active, modelId: activeId || 'inherit', policy: resolution.policy },
  };
}

async function gatherDiff(cwd: string, scope: {
  changeType: ReviewChangeType;
  baseRef: string | null;
  untrackedPaths: string[];
}): Promise<{ diff: string; truncated: boolean }> {
  const sections: string[] = [];
  const needCommitted = scope.changeType === 'committed' || scope.changeType === 'all';
  const needUncommitted = scope.changeType === 'uncommitted' || scope.changeType === 'all';

  if (needCommitted && scope.baseRef) {
    const committed = await tryRunGit(cwd, ['diff', '--no-color', `${scope.baseRef}...HEAD`]);
    if (committed && committed.trim()) {
      sections.push(`Committed changes (${scope.baseRef}...HEAD):\n${committed.trim()}`);
    }
  }

  if (needUncommitted) {
    const tracked = await tryRunGit(cwd, ['diff', '--no-color', 'HEAD']);
    if (tracked && tracked.trim()) {
      sections.push(`Uncommitted tracked changes:\n${tracked.trim()}`);
    }

    for (const rel of scope.untrackedPaths) {
      const abs = join(cwd, rel);
      let buffer: Buffer;
      try {
        buffer = await readFile(abs);
      } catch (error) {
        sections.push(`# ${rel}: unreadable (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      if (buffer.includes(0)) {
        sections.push(`# ${rel}: binary file (skipped)`);
        continue;
      }
      sections.push(`Untracked new file: ${rel}\n\`\`\`\n${buffer.toString('utf8')}\n\`\`\``);
    }
  }

  let combined = sections.join('\n\n');
  const truncated = combined.length > MAX_DIFF_CHARS;
  if (truncated) {
    combined = combined.slice(0, MAX_DIFF_CHARS);
    combined += `\n\n[Diff truncated at ${MAX_DIFF_CHARS} characters — pi-review inline diff guard.]`;
  }
  return { diff: combined, truncated };
}

function extractTrailingJsonObject(text: string): unknown | null {
  let candidate = text.trim();
  if (!candidate) return null;

  const fence = candidate.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) candidate = fence[1].trim();

  const start = candidate.lastIndexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        candidate = candidate.slice(start, i + 1);
        break;
      }
    }
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

const SEVERITY_ORDER = ['blocker', 'high', 'medium', 'low', 'nit'] as const;

function severityRank(severity: string): number {
  const index = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return index < 0 ? SEVERITY_ORDER.length : index;
}

function formatLocation(finding: ReviewFinding): string {
  if (finding.filePath && finding.startLine) {
    const range = finding.endLine && finding.endLine !== finding.startLine
      ? `${finding.startLine}-${finding.endLine}`
      : `${finding.startLine}`;
    return `${finding.filePath}:${range}`;
  }
  return finding.filePath ?? '(no location)';
}

function formatFindingsTable(findings: ReviewFinding[]): string {
  if (findings.length === 0) return 'No findings.';

  const sorted = [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return (a.filePath ?? '').localeCompare(b.filePath ?? '');
  });

  const header = ['SEVERITY', 'CATEGORY', 'LOCATION', 'TITLE'];
  const rows = sorted.map((f) => [f.severity, f.category, formatLocation(f), f.title]);
  const widths = [0, 1, 2, 3].map((ci) =>
    Math.max(header[ci].length, ...rows.map((r) => r[ci].length)),
  );
  const render = (cells: string[]) => cells.map((c, ci) => c.padEnd(widths[ci])).join('  ').trimEnd();
  return [render(header), ...rows.map(render)].join('\n');
}

export async function runReview(params: ReviewRunParams): Promise<ReviewRunResult> {
  const cwd = String(params.cwd ?? '').trim();
  if (!cwd) return { ok: false, message: 'Review requires a working directory.' };

  const changeType: ReviewChangeType = params.changeType ?? 'uncommitted';
  const base = baseFromArg(params.base);

  const modelResolution = resolveModel(params.host, { model: params.model, depth: params.depth });
  if (!modelResolution.ok) return { ok: false, message: modelResolution.error };

  const scope = await resolveReviewScope({ cwd, changeType, base });
  if (!scope.ok) return { ok: false, message: scope.error };

  const prompt = buildStandardReviewPrompt({
    instructions: params.instructions ?? '',
    intentInput: { changeType, base },
  });

  let diffBlock: { diff: string; truncated: boolean };
  try {
    diffBlock = await gatherDiff(cwd, {
      changeType,
      baseRef: scope.baseRef,
      untrackedPaths: scope.untrackedPaths,
    });
  } catch (error) {
    return { ok: false, message: `Failed to gather the diff: ${error instanceof Error ? error.message : String(error)}` };
  }

  const fullPrompt = diffBlock.diff.length > 0
    ? `${prompt}\n\nReview the following diff content:\n\n${diffBlock.diff}`
    : prompt;

  const messages = [
    { role: 'user', content: [{ type: 'text', text: fullPrompt }], timestamp: Date.now() },
  ];
  const options: Record<string, unknown> = { maxTokens: 8192 };
  if (params.signal) options.signal = params.signal;
  if (modelResolution.resolved.reasoningEffort) options.reasoningEffort = modelResolution.resolved.reasoningEffort;

  let completion: { content: Array<{ type: string; text?: string }> };
  try {
    completion = await params.host.complete(modelResolution.resolved.model, { messages }, options);
  } catch (error) {
    return { ok: false, message: `Model call failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const rawText = completion.content
    .filter((c): c is { type: string; text: string } => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
  if (!rawText.trim()) {
    return { ok: false, message: 'Model returned no text.' };
  }

  const rawJson = extractTrailingJsonObject(rawText);
  if (rawJson === null) {
    return { ok: false, message: 'Model output contained no parseable trailing JSON object.' };
  }

  const modelOutput = ModelReviewOutputSchema.safeParse(rawJson);
  if (!modelOutput.success) {
    return { ok: false, message: `Model JSON failed validation: ${modelOutput.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }

  const runId = randomUUID();
  const callId = randomUUID();
  // Built untyped first: `requestedConfiguration`/`modelPolicy`/`depth` are
  // passthrough extra keys, so annotating this as `ReviewFindingsV2` would trip
  // TypeScript excess-property checks. `parseReviewFindingsV2` below is the
  // single validation step (and proves the standalone output round-trips).
  const payload = {
    runRef: { runId, callId, backendId: 'pi' },
    summary: modelOutput.data.summary,
    overviewMarkdown: modelOutput.data.overviewMarkdown,
    findings: modelOutput.data.findings,
    questions: modelOutput.data.questions ?? [],
    assumptions: modelOutput.data.assumptions ?? [],
    generatedAtMs: Date.now(),
    // Happier records these on the execution run, not the findings payload; as a
    // standalone run they ride along as passthrough keys (see header note).
    requestedConfiguration: { modelId: modelResolution.resolved.modelId },
    modelPolicy: modelResolution.resolved.policy,
    ...(modelResolution.resolved.depth ? { depth: modelResolution.resolved.depth } : {}),
  };

  const findings = parseReviewFindingsV2(payload);
  if (findings === null) {
    return { ok: false, message: 'Internal error: generated findings failed the local V2 schema.' };
  }

  const outputPath = join(cwd, '.happier', 'review', `${runId}.json`);
  try {
    await mkdir(join(cwd, '.happier', 'review'), { recursive: true });
    await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    return { ok: false, message: `Failed to write ${outputPath}: ${error instanceof Error ? error.message : String(error)}` };
  }

  const table = formatFindingsTable(findings.findings);
  const truncNote = diffBlock.truncated ? ' (diff truncated)' : '';
  const message = [
    `Review complete: ${findings.findings.length} finding(s)${truncNote}.`,
    `Wrote ${outputPath}`,
    '',
    table,
  ].join('\n');

  return {
    ok: true,
    message,
    runId,
    path: outputPath,
    findingsCount: findings.findings.length,
  };
}
