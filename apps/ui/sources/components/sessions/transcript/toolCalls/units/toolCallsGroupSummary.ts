import { t } from '@/text';

type ToolCallKind = 'commands' | 'reads' | 'searches' | 'edits' | 'web' | 'agents' | 'other';

/** Tool names per kind, lowercased: Claude's (Bash, Read), Pi's (bash, read) and Codex's (shell, apply_patch). */
const KIND_BY_TOOL_NAME: Readonly<Record<string, ToolCallKind | null>> = {
    bash: 'commands', shell: 'commands', exec_command: 'commands', run_terminal_cmd: 'commands', bashoutput: 'commands',
    read: 'reads', read_file: 'reads', readfile: 'reads', notebookread: 'reads', view: 'reads',
    grep: 'searches', glob: 'searches', find: 'searches', ls: 'searches', search: 'searches', codesearch: 'searches',
    edit: 'edits', multiedit: 'edits', write: 'edits', notebookedit: 'edits', patch: 'edits', apply_patch: 'edits',
    webfetch: 'web', websearch: 'web', web_search: 'web', fetch: 'web',
    task: 'agents', agent: 'agents',
    // The canonical turn Diff repeats the edits of the same turn.
    diff: null,
};

/**
 * A Claude Code style header for a group of tool calls, such as "Ran 2 commands, read 3 files":
 * one part per kind, in the order the kinds first appear. Null when no call in the group counts.
 */
export function summarizeToolCallsGroup(toolNames: readonly string[]): string | null {
    const counts = new Map<ToolCallKind, number>();
    for (const name of toolNames) {
        const key = name.trim().toLowerCase();
        const kind = key in KIND_BY_TOOL_NAME ? KIND_BY_TOOL_NAME[key] : 'other';
        if (!kind) continue;
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    const parts = [...counts].map(([kind, count]) => t(`session.toolCallsSummary.${kind}`, { count }));
    const text = parts.join(t('session.toolCallsSummary.separator'));
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
