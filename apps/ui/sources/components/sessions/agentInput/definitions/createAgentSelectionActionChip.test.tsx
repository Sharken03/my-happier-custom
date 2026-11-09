import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentSelectionActionChip } from './createAgentSelectionActionChip';

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: () => null,
}));

vi.mock('@/agents/registry/registryUi', () => ({
    getAgentPickerIconScale: () => 1,
}));

describe('createAgentSelectionActionChip', () => {
    it('routes pointer, focus, and touch approach through one intent owner', () => {
        const onIntent = vi.fn();
        const chip = createAgentSelectionActionChip({
            anchorRef: React.createRef(),
            agentId: 'codex',
            tint: 'currentColor',
            showLabel: true,
            label: 'Codex',
            chipStyle: () => null,
            textStyle: null,
            onPress: vi.fn(),
            onIntent,
        }) as React.ReactElement<{
            onHoverIn?: () => void;
            onPressIn?: () => void;
            onFocus?: () => void;
        }>;

        chip.props.onHoverIn?.();
        chip.props.onFocus?.();
        chip.props.onPressIn?.();

        expect(onIntent).toHaveBeenCalledTimes(3);
    });

    it('leaves out the agent mark in the "Model + effort" style and keeps the label', () => {
        const build = (showAgentMark: boolean) => createAgentSelectionActionChip({
            anchorRef: React.createRef(),
            agentId: 'pi',
            tint: 'currentColor',
            showLabel: true,
            label: 'DS Pro · High',
            showAgentMark,
            chipStyle: () => null,
            textStyle: null,
            onPress: vi.fn(),
        }) as React.ReactElement<{ children: React.ReactNode }>;

        const children = (chip: React.ReactElement<{ children: React.ReactNode }>) =>
            React.Children.toArray(chip.props.children) as Array<React.ReactElement<{ label?: string }>>;
        expect(children(build(true))).toHaveLength(2);
        const withoutMark = children(build(false));
        expect(withoutMark).toHaveLength(1);
        expect(withoutMark[0]!.props.label).toBe('DS Pro · High');
    });
});
