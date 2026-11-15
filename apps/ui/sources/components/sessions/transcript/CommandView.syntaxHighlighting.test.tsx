import React from 'react';
import renderer from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { renderScreen } from '@/dev/testkit';
import { installTranscriptCommonModuleMocks, resetTranscriptCommonModuleMockState } from './transcriptTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const syntaxState = vi.hoisted(() => ({
    mode: 'simple' as 'off' | 'simple' | 'advanced',
}));

vi.mock('@/components/ui/code/highlighting/useCodeSyntaxHighlighting', () => ({
    useCodeSyntaxHighlighting: () => ({
        mode: syntaxState.mode,
        language: 'bash',
        maxBytes: 100_000,
        maxLines: 1_000,
        maxLineLength: 10_000,
    }),
}));

vi.mock('@/components/ui/media/SimpleSyntaxHighlighter', () => ({
    SimpleSyntaxHighlighter: (props: any) => React.createElement('SimpleSyntaxHighlighter', props),
}));

installTranscriptCommonModuleMocks();

vi.mock('@/components/ui/text/Text', () => createPassThroughModule(['Text']));

describe('CommandView (syntax highlighting)', () => {
    beforeEach(() => {
        syntaxState.mode = 'simple';
    });
    afterEach(resetTranscriptCommonModuleMockState);

    it('highlights the command line and its output when highlighting is enabled', async () => {
        const { CommandView } = await import('./CommandView');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CommandView
            command="git status --short"
            stdout={' M sources/a.ts'}
            stderr={'warning: something'}
        />)).tree;

        const highlighted = tree.findAllByType('SimpleSyntaxHighlighter' as any);
        expect(highlighted.map((node) => node.props.code)).toEqual([
            'git status --short',
            ' M sources/a.ts',
            'warning: something',
        ]);
        expect(highlighted.every((node) => node.props.language === 'bash')).toBe(true);
        expect(highlighted.every((node) => node.props.selectable === true)).toBe(true);
    });

    it('falls back to plain command and output text when highlighting is off', async () => {
        syntaxState.mode = 'off';
        const { CommandView } = await import('./CommandView');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CommandView
            command="git status --short"
            stdout={' M sources/a.ts'}
            stderr={'warning: something'}
        />)).tree;

        expect(tree.findAllByType('SimpleSyntaxHighlighter' as any)).toHaveLength(0);
        const texts = tree.findAllByType('Text' as any);
        const contents = texts.map((node) => node.props.children);
        expect(contents).toContain('git status --short');
        expect(contents).toContain(' M sources/a.ts');
        expect(contents).toContain('warning: something');
    });
});
