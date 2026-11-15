/** The line between two unrelated edit snippets of one file when they are shown as one text diff. */
export const TEXT_CHANGE_SNIPPET_SEPARATOR = '⋯';

export type TextChange = Readonly<{ oldText: string; newText: string }>;

/**
 * True when a unified diff adds or removes at least one line. A placeholder (headers and an empty
 * `@@ -0,0 +0,0 @@` hunk, which a tool call without content gives) is false.
 */
export function hasUnifiedDiffLineChanges(unifiedDiff: string | null | undefined): boolean {
  if (typeof unifiedDiff !== 'string') return false;
  return unifiedDiff.split('\n').some((line) =>
    (line.startsWith('+') && !line.startsWith('+++ ')) || (line.startsWith('-') && !line.startsWith('--- ')));
}

/**
 * Two text changes of one file as one. When the second starts from the text the first ended with
 * (whole file contents), the result goes from the first old text to the second new text. Edit
 * snippets do not connect like that; then both snippets stay, one after the other, with a separator
 * line that is the same on both sides.
 */
export function combineTextChanges(first: TextChange, second: TextChange): TextChange {
  if (first.newText === second.oldText) return { oldText: first.oldText, newText: second.newText };
  const separator = `\n${TEXT_CHANGE_SNIPPET_SEPARATOR}\n`;
  return {
    oldText: `${first.oldText}${separator}${second.oldText}`,
    newText: `${first.newText}${separator}${second.newText}`,
  };
}
