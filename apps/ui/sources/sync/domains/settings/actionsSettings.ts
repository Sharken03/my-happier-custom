import type { ActionId } from '@happier-dev/protocol';
import { ActionsSettingsV1Schema, isActionEnabledByActionsSettings } from '@happier-dev/protocol';

import { isExecutionRunsFeatureAction } from '@/sync/domains/actions/isExecutionRunsFeatureAction';
import { resolveLocalFeaturePolicyEnabled } from '@/sync/domains/features/featureLocalPolicy';

// Parsed settings per stored settings object. Settings objects keep their identity until they
// change, so the menus that check every action spec parse once instead of once per spec.
const parsedActionsSettingsByRaw = new WeakMap<object, any>();

export function resolveActionsSettingsV1FromState(state: Readonly<{ settings?: unknown }>) {
    const raw = (state as any)?.settings?.actionsSettingsV1;
    const cacheable = typeof raw === 'object' && raw !== null;
    if (cacheable) {
        const cached = parsedActionsSettingsByRaw.get(raw);
        if (cached) return cached;
    }
    const parsed = ActionsSettingsV1Schema.safeParse(raw);
    const result = parsed.success ? (parsed.data as any) : { v: 1 as const, actions: {} };
    if (cacheable) parsedActionsSettingsByRaw.set(raw, result);
    return result;
}

export function isActionEnabledInState(
    state: Readonly<{ settings?: unknown }>,
    actionId: ActionId,
    ctx?: Readonly<{ surface?: string | null; placement?: string | null }>,
): boolean {
    const settingsState = ((state as any)?.settings ?? {}) as any;
    if (isExecutionRunsFeatureAction(actionId) && !resolveLocalFeaturePolicyEnabled('execution.runs', settingsState)) {
        return false;
    }

    const settings = resolveActionsSettingsV1FromState(state);
    return isActionEnabledByActionsSettings(actionId, settings as any, ctx as any);
}
