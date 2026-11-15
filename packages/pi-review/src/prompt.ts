/**
 * Vendored from apps/cli/src/agent/reviews/prompt/buildStandardReviewPrompt.ts
 * and buildReviewScopeGuidanceBlock.ts, trimmed to what works without the
 * `@happier-dev/protocol` import.
 *
 * Divergences:
 *  - The follow-up branch of `buildStandardReviewPrompt` is dropped: it needs
 *    `ReviewFollowUpIntentInputSchema` from the protocol package, and pi-review
 *    only starts fresh reviews (no follow-up thread).
 *  - `buildReviewScopeGuidanceBlock` parses a minimal `{ changeType, base }`
 *    shape instead of the full `ReviewStartInputSchema` (engineIds, modelPolicy,
 *    permissionMode, ...). The emitted scope text is identical.
 */
import { z } from 'zod';

export const ReviewChangeTypeSchema = z.enum(['all', 'committed', 'uncommitted']);
export type ReviewChangeType = z.infer<typeof ReviewChangeTypeSchema>;

export const ReviewBaseSchema = z.union([
  z.object({ kind: z.literal('none') }).passthrough(),
  z.object({ kind: z.literal('branch'), baseBranch: z.string().min(1) }).passthrough(),
  z.object({ kind: z.literal('commit'), baseCommit: z.string().min(1) }).passthrough(),
]);
export type ReviewBase = z.infer<typeof ReviewBaseSchema>;

const ReviewScopeInputSchema = z.object({
  changeType: ReviewChangeTypeSchema,
  base: ReviewBaseSchema,
}).passthrough();

export function buildReviewGuidanceBlock(): string {
  return [
    'Return ONLY the final JSON object as your complete message — no preamble, no markdown fences, no trailing text.',
    'While working, you may emit brief progress updates as plain text.',
    'Inspect the accessible workspace before you finalize the review.',
    'Do not stop at a plan or restate the request as your final answer.',
    'Use the available read-only tools to inspect relevant files, tests, and supporting context before deciding whether there are findings.',
    'When finished, output ONE final JSON object with this shape as the LAST thing in your message:',
    '{',
    '  "summary": string,',
    '  "overviewMarkdown": string,',
    '  "findings": Array<{',
    '    "id": string,',
    '    "title": string,',
    '    "severity": "blocker"|"high"|"medium"|"low"|"nit",',
    '    "category": "correctness"|"security"|"performance"|"maintainability"|"testing"|"style"|"docs",',
    '    "summary": string,',
    '    "whyItMatters"?: string,',
    '    "evidence"?: string,',
    '    "confidence"?: number,',
    '    "filePath"?: string,',
    '    "startLine"?: number,',
    '    "endLine"?: number,',
    '    "suggestion"?: string,',
    '    "patch"?: string',
    '  }>,',
    '  "questions": Array<{ "id": string, "text": string, "findingIds"?: string[], "status": "open"|"answered"|"superseded" }>,',
    '  "assumptions": Array<{ "id": string, "text": string, "findingIds"?: string[] }>',
    '}',
    '',
    'Rules for the final JSON:',
    '- It MUST be valid JSON (parsable by JSON.parse).',
    '- Do NOT wrap it in markdown code fences.',
    '- Do NOT include any extra text after the JSON.',
    '- Put the reviewer narrative in overviewMarkdown.',
    '- Only emit findings you can support with evidence.',
    '- If you need missing context from the user, add a question instead of guessing.',
  ].join('\n');
}

export function buildReviewScopeGuidanceBlock(intentInput: unknown): string | null {
  const parsed = ReviewScopeInputSchema.safeParse(intentInput);
  if (!parsed.success) return null;

  const payload = parsed.data;
  const baseLine = payload.base.kind === 'branch'
    ? `Base branch: ${payload.base.baseBranch}`
    : payload.base.kind === 'commit'
      ? `Base commit: ${payload.base.baseCommit}`
      : 'Base: infer the repository\'s normal comparison base from the current branch context.';
  const scopeInstruction = payload.changeType === 'uncommitted'
    ? 'Focus on the current uncommitted worktree changes, including untracked files when they are relevant to the review.'
    : payload.changeType === 'all'
      ? 'Review both the committed diff for the selected base and the current uncommitted worktree changes.'
      : 'Focus on the committed changes for the selected review base.';

  return [
    'Review scope:',
    `- Change type: ${payload.changeType}`,
    `- ${baseLine}`,
    `- ${scopeInstruction}`,
    '- Do not broaden the review to unrelated repository areas unless they are directly needed to validate a scoped finding.',
  ].join('\n');
}

export function buildStandardReviewPrompt(params: Readonly<{
  instructions: string;
  intentInput?: unknown;
}>): string {
  const scopeBlock = buildReviewScopeGuidanceBlock(params.intentInput);
  const instructions = params.instructions.trim().length > 0
    ? params.instructions
    : 'Review the scoped changes.';
  return [
    instructions,
    scopeBlock,
    buildReviewGuidanceBlock(),
  ].filter((line) => typeof line === 'string' && line.length > 0).join('\n\n');
}
