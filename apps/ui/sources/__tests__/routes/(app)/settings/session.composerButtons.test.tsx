import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSettingsEntryModuleMocks();

beforeEach(() => {
    sessionSettingsEntryState.settingsState = {
        agentInputEnterToSend: true,
        agentInputHistoryScope: 'perSession',
        sessionMessageSendMode: 'agent_queue',
        sessionBusySteerSendPolicy: 'steer_immediately',
        alwaysShowContextSize: true,
        agentInputActionBarLayout: 'auto',
        agentInputChipDensity: 'auto',
        agentInputHiddenControls: ['mcp'],
    };
});

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
});

describe('Session composer settings: composer buttons', () => {
    it('switches a composer button off and back on', async () => {
        const mod = await import('@/app/(app)/settings/session/composer');
        const SessionComposerSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionComposerSettingsScreen));

        expect(screen.findGroup('settingsSession.composerButtons.title')).toBeTruthy();
        // The long list opens on demand.
        expect(screen.findRowByTitle('settingsSession.composerButtons.controls.connectedServices')).toBeFalsy();
        screen.pressRow('settings-composer-buttons-expander');

        screen.pressRowByTitle('settingsSession.composerButtons.controls.connectedServices');
        expect(sessionSettingsEntryState.settingsState.agentInputHiddenControls).toEqual(['mcp', 'connectedServices']);

        // The fixture store does not re-render, so a fresh screen reads the written value.
        standardCleanup();
        const next = await renderSettingsView(React.createElement(SessionComposerSettingsScreen));
        next.pressRow('settings-composer-buttons-expander');
        next.pressRowByTitle('settingsSession.composerButtons.controls.mcp');
        expect(sessionSettingsEntryState.settingsState.agentInputHiddenControls).toEqual(['connectedServices']);
    });

    it('switches the model chip to model and effort', async () => {
        const mod = await import('@/app/(app)/settings/session/composer');
        const SessionComposerSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionComposerSettingsScreen));

        screen.pressRowByTitle('settingsSession.modelChip.modelAndEffortTitle');
        expect(sessionSettingsEntryState.settingsState.agentInputModelChipStyle).toBe('modelAndEffort');
    });
});
