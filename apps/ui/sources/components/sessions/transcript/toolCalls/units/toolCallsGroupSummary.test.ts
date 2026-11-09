import { describe, expect, it } from 'vitest';

import { summarizeToolCallsGroup } from './toolCallsGroupSummary';

describe('summarizeToolCallsGroup', () => {
    it('names what a group did, in the order the kinds first appear', () => {
        expect(summarizeToolCallsGroup(['Bash', 'Read', 'bash', 'read', 'read'])).toBe('Ran 2 commands, read 3 files');
    });

    it('counts Pi, Claude and Codex names alike, and leaves out the turn Diff', () => {
        expect(summarizeToolCallsGroup(['edit', 'Write', 'apply_patch', 'Diff'])).toBe('Edited 3 files');
        expect(summarizeToolCallsGroup(['Grep', 'find', 'WebFetch', 'Task', 'mcp__happy__change_title']))
            .toBe('Searched for 2 patterns, fetched 1 web page, ran 1 agent, used 1 tool');
    });

    it('returns null when nothing in the group is countable', () => {
        expect(summarizeToolCallsGroup(['Diff'])).toBeNull();
        expect(summarizeToolCallsGroup([])).toBeNull();
    });
});
