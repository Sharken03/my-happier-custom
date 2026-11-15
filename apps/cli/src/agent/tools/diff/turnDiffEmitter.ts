type TurnDiffOutput = {
  unified_diff?: string;
  files?: Array<{
    file_path: string;
    unified_diff?: string;
    oldText?: string;
    newText?: string;
    description?: string;
  }>;
};

type TextDiffSignal = Readonly<{
  filePath: string;
  oldText: string;
  newText: string;
  description?: string;
  /** The tool's own diff of this change (Pi's edit gives one), used when the turn has no whole file text. */
  unifiedDiff?: string | null;
}>;

type UnifiedDiffSignal = Readonly<{
  filePath?: string;
  unifiedDiff: string;
  description?: string;
  /** The diff is one more change after the earlier diff of the file, not a newer view of it. */
  appendHunks?: boolean;
}>;

type UnifiedDiffSnapshotSignal = Readonly<{
  unifiedDiff: string;
}>;

type Entry =
  | Readonly<{
      kind: 'text';
      filePath: string;
      oldText: string;
      newText: string;
      description?: string;
      order: number;
    }>
  | Readonly<{
      kind: 'unified';
      filePath: string;
      unifiedDiff: string;
      description?: string;
      order: number;
    }>;

export type TurnDiffEmitterOptions = Readonly<{
  /**
   * When enabled, `observeUnifiedDiffSnapshot()` stores a single `unified_diff` snapshot for the
   * whole turn. This is appropriate for providers like Codex that emit turn-level unified diffs.
   *
   * When disabled, snapshot signals are ignored.
   */
  snapshotUnifiedDiff?: boolean;
}>;

/** True when a unified diff adds or removes a line; a placeholder (empty hunk) is false. */
function hasUnifiedDiffLineChanges(unifiedDiff: string | null | undefined): unifiedDiff is string {
  if (typeof unifiedDiff !== 'string') return false;
  return unifiedDiff.split('\n').some((line) =>
    (line.startsWith('+') && !line.startsWith('+++ ')) || (line.startsWith('-') && !line.startsWith('--- ')));
}

/** The hunks of `second` after `first`, for two diffs of one file made one after the other. */
function appendUnifiedDiffHunks(first: string, second: string): string {
  const lines = second.split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@'));
  if (start < 0) return first;
  return `${first.replace(/\n+$/, '')}\n${lines.slice(start).join('\n')}`;
}

/**
 * Two text changes of one file as one. When the second starts from the text the first ended with
 * (whole file contents), they chain. When the first ends with whole file text that holds the
 * second's old snippet once, the snippet is replaced in it, as the edit did on disk. Else both edit
 * snippets stay, one after the other, with a separator line: pairing the old snippet of one edit
 * with the new snippet of another gives a false diff. Same rule as combineTextChanges in
 * @happier-dev/protocol.
 */
function combineTextChanges(
  first: Readonly<{ oldText: string; newText: string }>,
  second: Readonly<{ oldText: string; newText: string }>,
): { oldText: string; newText: string } {
  if (first.newText === second.oldText) return { oldText: first.oldText, newText: second.newText };
  const at = second.oldText ? first.newText.indexOf(second.oldText) : -1;
  if (at >= 0 && first.newText.indexOf(second.oldText, at + 1) < 0) {
    const newText = first.newText.slice(0, at) + second.newText + first.newText.slice(at + second.oldText.length);
    return { oldText: first.oldText, newText };
  }
  return { oldText: `${first.oldText}\n⋯\n${second.oldText}`, newText: `${first.newText}\n⋯\n${second.newText}` };
}

/**
 * Shared "turn diff" coalescer.
 *
 * Goal: emit a reliable per-turn representation of file changes:
 * - Prefer net text diffs (old/new full text pairs) when available.
 * - Otherwise keep the latest unified diff per file (best-effort).
 * - Optionally keep a single turn-level unified diff snapshot for snapshot providers.
 */
export class TurnDiffEmitter {
  private readonly snapshotUnifiedDiff: boolean;
  private orderCounter = 0;
  private readonly byFilePath = new Map<string, Entry>();
  private unifiedSnapshot: string | null = null;

  constructor(opts?: TurnDiffEmitterOptions) {
    this.snapshotUnifiedDiff = opts?.snapshotUnifiedDiff === true;
  }

  beginTurn(): void {
    this.orderCounter = 0;
    this.byFilePath.clear();
    this.unifiedSnapshot = null;
  }

  observeTextDiff(signal: TextDiffSignal): void {
    const filePath = signal.filePath.trim();
    if (!filePath) return;

    const existing = this.byFilePath.get(filePath);
    if (existing?.kind === 'text') {
      if (existing.newText === signal.newText) return;
      const combined = combineTextChanges(existing, signal);
      this.byFilePath.set(filePath, {
        kind: 'text',
        filePath,
        oldText: combined.oldText,
        newText: combined.newText,
        description: signal.description ?? existing.description,
        order: existing.order,
      });
      return;
    }

    // Without whole file text, the tool's own diff shows the edit with its context and line numbers.
    if (hasUnifiedDiffLineChanges(signal.unifiedDiff)) {
      const earlier = existing?.kind === 'unified' && hasUnifiedDiffLineChanges(existing.unifiedDiff) ? existing.unifiedDiff : null;
      this.byFilePath.set(filePath, {
        kind: 'unified',
        filePath,
        unifiedDiff: earlier ? appendUnifiedDiffHunks(earlier, signal.unifiedDiff) : signal.unifiedDiff,
        description: signal.description ?? existing?.description,
        order: existing?.order ?? this.orderCounter++,
      });
      return;
    }

    // A text diff replaces a unified diff of the same file.
    this.byFilePath.set(filePath, {
      kind: 'text',
      filePath,
      oldText: signal.oldText,
      newText: signal.newText,
      description: signal.description ?? existing?.description,
      order: existing?.order ?? this.orderCounter++,
    });
  }

  observeUnifiedDiff(signal: UnifiedDiffSignal): void {
    const rawPath = signal.filePath?.trim() ?? '';
    const filePath = rawPath;
    if (!filePath) return;

    const existing = this.byFilePath.get(filePath);
    // Do not overwrite net text diffs.
    if (existing && existing.kind === 'text') return;

    if (!existing) {
      this.byFilePath.set(filePath, {
        kind: 'unified',
        filePath,
        unifiedDiff: signal.unifiedDiff,
        description: signal.description,
        order: this.orderCounter++,
      });
      return;
    }

    if (existing.kind === 'unified' && existing.unifiedDiff === signal.unifiedDiff) return;
    const append = signal.appendHunks === true && hasUnifiedDiffLineChanges(existing.unifiedDiff);
    this.byFilePath.set(filePath, {
      kind: 'unified',
      filePath,
      unifiedDiff: append ? appendUnifiedDiffHunks(existing.unifiedDiff, signal.unifiedDiff) : signal.unifiedDiff,
      description: signal.description ?? existing.description,
      order: existing.order,
    });
  }

  observeUnifiedDiffSnapshot(signal: UnifiedDiffSnapshotSignal): void {
    if (!this.snapshotUnifiedDiff) return;
    if (this.unifiedSnapshot === signal.unifiedDiff) return;
    this.unifiedSnapshot = signal.unifiedDiff;
  }

  flushTurn(): TurnDiffOutput {
    const snapshot = this.unifiedSnapshot;
    const entries = Array.from(this.byFilePath.values()).sort((a, b) => a.order - b.order);

    this.byFilePath.clear();
    this.unifiedSnapshot = null;

    if (entries.length > 0) {
      return {
        files: entries.map((entry) => {
          if (entry.kind === 'text') {
            return {
              file_path: entry.filePath,
              oldText: entry.oldText,
              newText: entry.newText,
              ...(entry.description ? { description: entry.description } : {}),
            };
          }
          return {
            file_path: entry.filePath,
            unified_diff: entry.unifiedDiff,
            ...(entry.description ? { description: entry.description } : {}),
          };
        }),
      };
    }

    if (snapshot && snapshot.trim().length > 0) {
      return { unified_diff: snapshot };
    }

    return {};
  }
}
