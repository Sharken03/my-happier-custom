import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView } from '@/dev/testkit';
import { installSessionSettingsCommonModuleMocks } from './sessionSettingsViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setEnabled = vi.fn();
const setHosts = vi.fn();
const state = vi.hoisted(() => ({ enabled: true as boolean }));

installSessionSettingsCommonModuleMocks({
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: (name: string) => {
                    if (name === 'transcriptMarkdownRemoteImagesEnabled') return [state.enabled, setEnabled];
                    if (name === 'transcriptMarkdownRemoteImageHosts') return [['happy.example.org'], setHosts];
                    return [null, vi.fn()];
                },
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: { children?: React.ReactNode }) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, footer, title }: { children?: React.ReactNode; footer?: string; title?: string }) =>
        React.createElement('ItemGroup', { footer, title }, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
    TextInput: (props: any) => React.createElement('TextInput', props),
}));

describe('TranscriptMarkdownImagesSettingsGroup', () => {
    beforeEach(() => {
        state.enabled = true;
        setEnabled.mockClear();
        setHosts.mockClear();
    });

    it('toggles the setting and saves the parsed hosts when the field loses focus', async () => {
        const { TranscriptMarkdownImagesSettingsGroup } = await import('./TranscriptMarkdownImagesSettingsGroup');
        const screen = await renderSettingsView(React.createElement(TranscriptMarkdownImagesSettingsGroup));

        screen.findByProps({ testID: 'settings-session-transcript-markdown-images-enabled' }).props.onPress?.();
        expect(setEnabled).toHaveBeenCalledWith(false);

        const input = () => screen.findByProps({ testID: 'settings-session-transcript-markdown-images-hosts-input' }).props as {
            value: string; onChangeText: (value: string) => void; onBlur: () => void;
        };
        expect(input().value).toBe('happy.example.org');
        await act(async () => input().onChangeText('happy.example.org, https://CDN.example.org/x\nbad_host'));
        expect(setHosts).not.toHaveBeenCalled();
        await act(async () => input().onBlur());
        expect(setHosts).toHaveBeenCalledWith(['happy.example.org', 'cdn.example.org']);
    });

    it('hides the host field while the setting is off', async () => {
        state.enabled = false;
        const { TranscriptMarkdownImagesSettingsGroup } = await import('./TranscriptMarkdownImagesSettingsGroup');
        const screen = await renderSettingsView(React.createElement(TranscriptMarkdownImagesSettingsGroup));
        expect(screen.findAll((node) => node.props?.testID === 'settings-session-transcript-markdown-images-hosts-input')).toHaveLength(0);
    });
});
