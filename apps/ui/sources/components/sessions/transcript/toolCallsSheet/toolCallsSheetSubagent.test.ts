import { describe, expect, it } from 'vitest';

import {
    isToolCallsSheetSubagentCall,
    readToolCallsSheetSubagentPrompt,
    readToolCallsSheetSubagentReport,
    readToolCallsSheetSubagentType,
    shouldShowToolCallsSheetSubagentPrompt,
    shouldShowToolCallsSheetSubagentReport,
} from './toolCallsSheetSubagent';

describe('toolCallsSheetSubagent', () => {
    it('detects subagent tools', () => {
        expect(isToolCallsSheetSubagentCall({ name: 'Task' })).toBe(true);
        expect(isToolCallsSheetSubagentCall({ name: 'Agent' })).toBe(true);
        expect(isToolCallsSheetSubagentCall({ name: 'Bash' })).toBe(false);
    });

    it('reads the type and the prompt from the input', () => {
        const tool = { input: { subagent_type: ' Explore ', prompt: 'Find the bug' } };
        expect(readToolCallsSheetSubagentType(tool)).toBe('Explore');
        expect(readToolCallsSheetSubagentPrompt(tool)).toBe('Find the bug');
        expect(readToolCallsSheetSubagentType({ input: null })).toBeNull();
        expect(readToolCallsSheetSubagentPrompt({ input: { prompt: '  ' } })).toBeNull();
    });

    it('reads the agent and the tasks of a pi-subagents call', () => {
        expect(readToolCallsSheetSubagentType({ input: { agent: 'scout', task: 'Map the parser' } })).toBe('scout');
        expect(readToolCallsSheetSubagentPrompt({ input: { agent: 'scout', task: 'Map the parser' } })).toBe('Map the parser');
        expect(readToolCallsSheetSubagentPrompt({
            input: { tasks: [{ agent: 'scout', task: 'Map the parser' }, { agent: 'reviewer', task: 'Review it' }] },
        })).toBe('scout: Map the parser\n\nreviewer: Review it');
        expect(readToolCallsSheetSubagentPrompt({ input: { chain: [{ agent: 'planner', task: 'Plan' }] } })).toBe('planner: Plan');
    });

    it('reads the tasks and the agent of a pi-subagents workflow call', () => {
        const parallel = { input: { workflow: 'parallel', args: { tasks: [{ agent: 'worker', task: 'Map the image' }, { agent: 'worker', task: 'Map the RAM' }] } } };
        expect(readToolCallsSheetSubagentPrompt(parallel)).toBe('worker: Map the image\n\nworker: Map the RAM');
        expect(readToolCallsSheetSubagentPrompt({ input: { workflow: 'chain', args: { chain: [{ agent: 'planner', task: 'Plan' }] } } })).toBe('planner: Plan');
        const single = { input: { workflow: 'single', args: { agent: 'scout', task: 'Map the parser' } } };
        expect(readToolCallsSheetSubagentType(single)).toBe('scout');
        expect(readToolCallsSheetSubagentPrompt(single)).toBe('Map the parser');
    });

    it('reads the report from string and content results', () => {
        expect(readToolCallsSheetSubagentReport({ state: 'completed', result: 'Done' })).toBe('Done');
        expect(readToolCallsSheetSubagentReport({
            state: 'completed',
            result: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] },
        })).toBe('A\n\nB');
        expect(readToolCallsSheetSubagentReport({ state: 'completed', result: { result: 'Ok' } })).toBe('Ok');
        expect(readToolCallsSheetSubagentReport({ state: 'completed', result: { agentId: 'x' } })).toBeNull();
    });

    it('shows no report while the call runs', () => {
        expect(readToolCallsSheetSubagentReport({ state: 'running', result: 'Partial' })).toBeNull();
    });

    it('shows the prompt only when no user message holds it', () => {
        expect(shouldShowToolCallsSheetSubagentPrompt([{ kind: 'agent-text' }])).toBe(true);
        expect(shouldShowToolCallsSheetSubagentPrompt([{ kind: 'user-text' }, { kind: 'agent-text' }])).toBe(false);
    });
});

describe('shouldShowToolCallsSheetSubagentReport', () => {
    it('hides the report when the last text message already shows it', () => {
        const messages = [{ kind: 'agent-text', id: 'a', localId: null, createdAt: 0, text: ' Done. \n' }] as any;
        expect(shouldShowToolCallsSheetSubagentReport('Done.', messages)).toBe(false);
        expect(shouldShowToolCallsSheetSubagentReport('Other', messages)).toBe(true);
    });
});
