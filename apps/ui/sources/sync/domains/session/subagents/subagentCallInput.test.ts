import { describe, expect, it } from 'vitest';

import { readSubagentCallPrompt, readSubagentCallType } from './subagentCallInput';

describe('subagentCallInput', () => {
    it('reads the type and the prompt from the input', () => {
        const tool = { input: { subagent_type: ' Explore ', prompt: 'Find the bug' } };
        expect(readSubagentCallType(tool)).toBe('Explore');
        expect(readSubagentCallPrompt(tool)).toBe('Find the bug');
        expect(readSubagentCallType({ input: null })).toBeNull();
        expect(readSubagentCallPrompt({ input: { prompt: '  ' } })).toBeNull();
    });

    it('reads the agent and the tasks of a pi-subagents call', () => {
        expect(readSubagentCallType({ input: { agent: 'scout', task: 'Map the parser' } })).toBe('scout');
        expect(readSubagentCallPrompt({ input: { agent: 'scout', task: 'Map the parser' } })).toBe('Map the parser');
        expect(readSubagentCallPrompt({
            input: { tasks: [{ agent: 'scout', task: 'Map the parser' }, { agent: 'reviewer', task: 'Review it' }] },
        })).toBe('scout: Map the parser\n\nreviewer: Review it');
        expect(readSubagentCallPrompt({ input: { chain: [{ agent: 'planner', task: 'Plan' }] } })).toBe('planner: Plan');
    });

    it('reads the tasks and the agent of a pi-subagents workflow call', () => {
        const parallel = { input: { workflow: 'parallel', args: { tasks: [{ agent: 'worker', task: 'Map the image' }, { agent: 'worker', task: 'Map the RAM' }] } } };
        expect(readSubagentCallPrompt(parallel)).toBe('worker: Map the image\n\nworker: Map the RAM');
        expect(readSubagentCallPrompt({ input: { workflow: 'chain', args: { chain: [{ agent: 'planner', task: 'Plan' }] } } })).toBe('planner: Plan');
        const single = { input: { workflow: 'single', args: { agent: 'scout', task: 'Map the parser' } } };
        expect(readSubagentCallType(single)).toBe('scout');
        expect(readSubagentCallPrompt(single)).toBe('Map the parser');
    });
});
