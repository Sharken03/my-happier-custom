import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const motionPreference = {
    matches: false,
    listeners: new Set<(event: { matches: boolean }) => void>(),
    addEventListener(_event: string, listener: (event: { matches: boolean }) => void) {
        this.listeners.add(listener);
    },
};

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Platform: { OS: 'web', select: (value: any) => value?.web ?? value?.default },
    });
});

// react-native-svg is a native drawing boundary; plain host elements keep the tree inspectable.
vi.mock('react-native-svg', async () => {
    const React = await import('react');
    const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props);
    return { default: host('Svg'), Path: host('Path'), Rect: host('Rect') };
});

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

/** The preference store reads the media query once, so later changes arrive as change events. */
function setReducedMotion(matches: boolean) {
    motionPreference.matches = matches;
    for (const listener of motionPreference.listeners) listener({ matches });
}

async function setQuillSetting(enabled: boolean) {
    const { storage } = await import('@/sync/domains/state/storage');
    storage.setState((state) => ({ settings: { ...state.settings, composerWorkingQuillMarkEnabled: enabled } }));
}

describe('ComposerStatusMark', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { matchMedia: () => motionPreference });
        vi.stubGlobal('document', Object.assign(new EventTarget(), {
            visibilityState: 'visible',
            getElementById: () => null,
            createElement: () => ({}),
            head: { appendChild: () => {} },
        }));
        setReducedMotion(false);
    });

    afterEach(() => {
        standardCleanup();
        vi.unstubAllGlobals();
    });

    it('draws the writing quill while the agent works and the setting is on', async () => {
        await setQuillSetting(true);
        const { ComposerStatusMark } = await import('./ComposerStatusMark');
        const screen = await renderScreen(
            <ComposerStatusMark working={true} isPulsing={true} dotColor="orange" inkColor="gray" />,
        );

        expect(screen.findAll((node: any) => node.props?.testID === 'agent-input-status-quill')).not.toHaveLength(0);
        expect(screen.findAll((node: any) => node.props?.testID === 'agent-input-status-dot')).toHaveLength(0);
        const quill = screen.findAll((node: any) => node.props?.testID === 'agent-input-status-quill-quill')[0];
        expect(flattenStyle(quill.props.style).animationName).toBe('happierQuillPen');
    });

    it('keeps the status dot when the setting is off or the agent does not work', async () => {
        const { ComposerStatusMark } = await import('./ComposerStatusMark');

        await setQuillSetting(false);
        const settingOff = await renderScreen(
            <ComposerStatusMark working={true} isPulsing={true} dotColor="orange" inkColor="gray" />,
        );
        expect(settingOff.findAll((node: any) => node.props?.testID === 'agent-input-status-dot')).not.toHaveLength(0);
        expect(settingOff.findAll((node: any) => node.props?.testID === 'agent-input-status-quill')).toHaveLength(0);
        standardCleanup();

        await setQuillSetting(true);
        const idle = await renderScreen(
            <ComposerStatusMark working={false} isPulsing={false} dotColor="green" inkColor="gray" />,
        );
        expect(idle.findAll((node: any) => node.props?.testID === 'agent-input-status-dot')).not.toHaveLength(0);
        expect(idle.findAll((node: any) => node.props?.testID === 'agent-input-status-quill')).toHaveLength(0);
    });

    it('holds the quill still when reduced motion is requested', async () => {
        await setQuillSetting(true);
        await React.act(async () => setReducedMotion(true));
        const { ComposerStatusMark } = await import('./ComposerStatusMark');
        const screen = await renderScreen(
            <ComposerStatusMark working={true} isPulsing={true} dotColor="orange" inkColor="gray" />,
        );

        const quill = screen.findAll((node: any) => node.props?.testID === 'agent-input-status-quill-quill')[0];
        expect(flattenStyle(quill.props.style).animationName).toBeUndefined();
    });
});
