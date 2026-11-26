import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string, vars?: any) => {
            if (key === 'tools.subAgentTitle') return `${vars?.label} Agent`;
            if (key === 'tools.names.subAgent') return 'Agent';
            return key;
        },
    });
});

function tool(input: Record<string, unknown>) {
    return { name: 'SubAgent', state: 'running', input, result: null, createdAt: 0, startedAt: 0, completedAt: null, description: null } as any;
}

describe('resolveSubagentToolPresentation', () => {
    it('does not label a Pi subagent with the parent chat model', async () => {
        const { resolveSubagentToolPresentation } = await import('./subAgentPresentation');
        const metadata = {
            flavor: 'pi',
            sessionAppliedModelV1: { v: 1, provider: 'pi', modelId: 'nemotron-free', updatedAt: 1 },
        } as any;

        const { title } = resolveSubagentToolPresentation({ tool: tool({ agent: 'reviewer', task: 'x' }), metadata });

        expect(title).not.toMatch(/nemotron/i);
        expect(title).toMatch(/Reviewer Agent$/);
    });

    it('uses the model that the Pi subagent call names', async () => {
        const { resolveSubagentToolPresentation } = await import('./subAgentPresentation');
        const { title } = resolveSubagentToolPresentation({
            tool: tool({ agent: 'reviewer', task: 'x', model: 'deepseek-v4-pro' }),
            metadata: { flavor: 'pi' } as any,
        });

        expect(title).toMatch(/^deepseek-v4-pro Reviewer Agent$/);
    });
});
