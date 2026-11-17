import { describe, expect, it } from 'vitest';

describe('actionsSettings', () => {
    it('treats per-action overrides as disabled and supports per-surface gating', async () => {
        const { isActionEnabledInState } = await import('./actionsSettings');

        const state: any = {
            settings: {
                experiments: true,
                featureToggles: { 'execution.runs': true },
                actionsSettingsV1: {
                    v: 1,
                    actions: {
                        'review.start': { enabled: false },
                        'subagents.plan.start': { disabledSurfaces: ['mcp'] },
                    },
                },
            },
        };

        expect(isActionEnabledInState(state, 'review.start' as any, { surface: 'ui_button', placement: 'command_palette' } as any)).toBe(false);
        expect(isActionEnabledInState(state, 'subagents.plan.start' as any, { surface: 'ui_button', placement: 'command_palette' } as any)).toBe(true);
        expect(isActionEnabledInState(state, 'subagents.plan.start' as any, { surface: 'mcp' } as any)).toBe(false);
    });

    it('treats review.start as an execution-runs-gated action', async () => {
        const { isActionEnabledInState } = await import('./actionsSettings');

        const disabledState: any = {
            settings: {
                experiments: false,
                featureToggles: { 'execution.runs': false },
                actionsSettingsV1: { v: 1, actions: {} },
            },
        };
        const enabledState: any = {
            settings: {
                experiments: true,
                featureToggles: { 'execution.runs': true },
                actionsSettingsV1: { v: 1, actions: {} },
            },
        };

        expect(isActionEnabledInState(disabledState, 'review.start' as any, { surface: 'ui_button', placement: 'command_palette' } as any)).toBe(false);
        expect(isActionEnabledInState(enabledState, 'review.start' as any, { surface: 'ui_button', placement: 'command_palette' } as any)).toBe(true);
    });

    it('enables execution-runs-gated actions by default without the experiments switch', async () => {
        const { isActionEnabledInState } = await import('./actionsSettings');

        const defaultState: any = {
            settings: {
                experiments: false,
                featureToggles: {},
                actionsSettingsV1: { v: 1, actions: {} },
            },
        };

        expect(isActionEnabledInState(defaultState, 'review.start' as any, { surface: 'ui_button', placement: 'command_palette' } as any)).toBe(true);
    });
});

describe('resolveActionsSettingsV1FromState', () => {
    it('returns the same parsed settings for the same stored settings object', async () => {
        const { resolveActionsSettingsV1FromState } = await import('./actionsSettings');
        const actionsSettingsV1 = { v: 1, actions: { 'review.start': { enabled: false } } };

        const first = resolveActionsSettingsV1FromState({ settings: { actionsSettingsV1 } });
        const second = resolveActionsSettingsV1FromState({ settings: { actionsSettingsV1 } });
        const changed = resolveActionsSettingsV1FromState({
            settings: { actionsSettingsV1: { v: 1, actions: {} } },
        });

        expect(second).toBe(first);
        expect(changed).not.toBe(first);
        expect(changed.actions).toEqual({});
    });
});
