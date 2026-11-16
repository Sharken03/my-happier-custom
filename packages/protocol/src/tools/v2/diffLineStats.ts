/**
 * Line counts ("+N −M") of file edits. The app counts the edit calls of a transcript with these
 * functions, and the CLI counts the edit calls of a subagent's own session with them. The CLI
 * sends its count in the subagent result as `details.happierDiffStats`.
 */

export type DiffLineStats = Readonly<{ added: number; removed: number }>;

/** Key in a subagent result's `details` that holds the lines the subagent changed. */
export const HAPPIER_DIFF_STATS_DETAILS_KEY = 'happierDiffStats';

const ZERO: DiffLineStats = { added: 0, removed: 0 };

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Lines of a text; an empty text has none. A final line break does not add a line. */
function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function sumDiffLineStats(parts: readonly DiffLineStats[]): DiffLineStats {
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    added += part.added;
    removed += part.removed;
  }
  return { added, removed };
}

/**
 * Cheap line diff of one replacement. It drops the common first and last lines, then matches the
 * rest as multisets: a line that appears in both texts is not counted. Order is ignored.
 */
export function countReplacementLines(oldText: string, newText: string): DiffLineStats {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const pool = new Map<string, number>();
  for (let i = start; i < oldEnd; i++) pool.set(oldLines[i], (pool.get(oldLines[i]) ?? 0) + 1);
  let added = 0;
  for (let i = start; i < newEnd; i++) {
    const left = pool.get(newLines[i]) ?? 0;
    if (left > 0) pool.set(newLines[i], left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of pool.values()) removed += left;
  return { added, removed };
}

/** Counts the '+' and '-' lines of patch text, without the '+++' and '---' file headers. */
function countPatchText(text: string): DiffLineStats {
  let added = 0;
  let removed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

/** One edit object: Claude (old_string, new_string) or Pi (oldText, newText). */
function countEditObject(edit: unknown): DiffLineStats {
  const record = asRecord(edit);
  if (!record) return ZERO;
  const oldText = asString(record.old_string) ?? asString(record.oldText) ?? asString(record.oldString) ?? '';
  const newText = asString(record.new_string) ?? asString(record.newText) ?? asString(record.newString) ?? '';
  return countReplacementLines(oldText, newText);
}

const PATCH_TEXT_KEYS = ['patchText', 'patch', 'input', 'diff', 'unified_diff'] as const;

function countPatchInput(input: UnknownRecord): DiffLineStats {
  for (const key of PATCH_TEXT_KEYS) {
    const text = asString(input[key]);
    if (text !== null) return countPatchText(text);
  }
  // Codex style: a map (or list) of per-file changes with a unified diff or the new content.
  const changes = input.changes;
  const changesRecord = asRecord(changes);
  const entries = Array.isArray(changes) ? changes : changesRecord ? Object.values(changesRecord) : [];
  const parts: DiffLineStats[] = [];
  for (const rawChange of entries) {
    const change = asRecord(rawChange);
    if (!change) continue;
    const diff = asString(change.unified_diff) ?? asString(change.diff);
    const content = asString(change.content);
    if (diff !== null) parts.push(countPatchText(diff));
    else if (change.type === 'add' && content !== null) parts.push({ added: splitLines(content).length, removed: 0 });
  }
  return sumDiffLineStats(parts);
}

/**
 * Lines that one edit tool call changes, read from its input. It knows the Claude, Pi, Codex and
 * Gemini edit, write and patch tools. Other tools count as zero.
 */
export function countToolCallDiffLines(name: string, input: unknown): DiffLineStats {
  const record = asRecord(input);
  if (!record) return ZERO;
  switch (name.trim().toLowerCase()) {
    case 'edit':
      // Pi's edit may carry a list of edits; Claude's carries one.
      return Array.isArray(record.edits) ? sumDiffLineStats(record.edits.map(countEditObject)) : countEditObject(record);
    case 'multiedit':
      return Array.isArray(record.edits) ? sumDiffLineStats(record.edits.map(countEditObject)) : ZERO;
    case 'write':
    case 'write_file':
      return { added: splitLines(asString(record.content) ?? '').length, removed: 0 };
    case 'apply_patch':
    case 'patch':
    case 'codexpatch':
    case 'geminipatch':
      return countPatchInput(record);
    default:
      return ZERO;
  }
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

/** The count in a subagent result's `details`, or null when it has none or it is not valid. */
export function readHappierDiffStats(details: unknown): DiffLineStats | null {
  const stats = asRecord(asRecord(details)?.[HAPPIER_DIFF_STATS_DETAILS_KEY]);
  if (!stats) return null;
  const added = readCount(stats.added);
  const removed = readCount(stats.removed);
  return added === null || removed === null ? null : { added, removed };
}
