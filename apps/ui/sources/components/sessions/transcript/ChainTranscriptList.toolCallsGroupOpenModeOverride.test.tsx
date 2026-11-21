import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installTranscriptCommonModuleMocks } from './transcriptTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * An overridden group mode has to reach the group header, not just the item decomposition.
 *
 * The header decides sheet-or-expand from the chrome it receives
 * (`isToolCallsGroupSheetMode(props.toolChromeCommon)`). A sidechain list passes
 * `toolCallsGroupOpenMode="inline"` so the tap expands in place; if the rows still got the account
 * chrome, the tap would keep pushing the Tool calls sheet, which then closed itself because a
 * sidechain call is not in the session's main transcript.
 */

const hostState = vi.hoisted(() => ({
    headerRowProps: [] as Array<Record<string, any>>,
}));

let accountOpenMode: 'inline' | 'sheet' | 'list' = 'sheet';

installTranscriptCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        const { settingsDefaults } = await import('@/sync/domains/settings/settings');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSetting: ((key: string) => {
                    if (key === 'transcriptToolCallsGroupOpenMode' || key === 'transcriptToolCallsGroupOpenModeWeb') {
                        return accountOpenMode;
                    }
                    return (settingsDefaults as Record<string, unknown>)[key] ?? null;
                }) as any,
            },
        });
    },
});

vi.mock('@/sync/sync', () => ({
    sync: {
        getSyncTuning: () => ({
            transcriptBackwardPrefetchThresholdPx: 800,
            transcriptFlashListEstimatedItemSize: 120,
            transcriptLegendListSpikeSurface: 'off',
            transcriptOlderLoadCooldownMs: 2500,
            transcriptOlderLoadSpinnerDelayMs: 0,
        }),
    },
}));

vi.mock('@/components/sessions/transcript/toolCalls/units/ToolCallsGroupUnitHeaderRow', () => ({
    ToolCallsGroupUnitHeaderRowWithSessionCommon: (props: Record<string, any>) => {
        hostState.headerRowProps.push(props);
        return React.createElement('ToolCallsGroupUnitHeaderRowWithSessionCommon', props);
    },
}));

function toolCallMessage(id: string, toolId: string, createdAt: number) {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        tool: {
            id: toolId,
            name: 'Read',
            state: 'completed',
            input: { file: 'a.ts' },
            result: 'a',
            createdAt,
            startedAt: createdAt,
            completedAt: createdAt,
            description: null,
        },
        children: [],
    };
}

async function renderList(props: { toolCallsGroupOpenMode?: 'inline' | 'sheet' | 'list' }) {
    const { ChainTranscriptList } = await import('./ChainTranscriptList');
    return renderScreen(
        <ChainTranscriptList
            sessionId="s1"
            datasetKey="sidechain-a"
            messages={[toolCallMessage('tool-message-1', 'tool-1', 1), toolCallMessage('tool-message-2', 'tool-2', 2)] as any}
            metadata={null}
            interaction={{ canSendMessages: true, canApprovePermissions: true, disableToolNavigation: true }}
            {...(props.toolCallsGroupOpenMode ? { toolCallsGroupOpenMode: props.toolCallsGroupOpenMode } : null)}
        />,
    );
}

describe('ChainTranscriptList tool calls group open mode override', () => {
    afterEach(() => {
        hostState.headerRowProps.length = 0;
        accountOpenMode = 'sheet';
        standardCleanup();
    });

    it('hands the overridden mode to the group header so the tap expands in place', async () => {
        accountOpenMode = 'sheet';
        await renderList({ toolCallsGroupOpenMode: 'inline' });

        const header = hostState.headerRowProps.at(-1);
        expect(header).toBeTruthy();
        expect(header?.toolChromeCommon?.transcriptToolCallsGroupOpenMode).toBe('inline');
    }, 240_000);

    it('keeps the account mode when the host passes no override', async () => {
        accountOpenMode = 'sheet';
        await renderList({});

        const header = hostState.headerRowProps.at(-1);
        expect(header).toBeTruthy();
        expect(header?.toolChromeCommon?.transcriptToolCallsGroupOpenMode).toBe('sheet');
    }, 240_000);
});
