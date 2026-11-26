import React from 'react';
import renderer from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { renderScreen } from '@/dev/testkit';
import { installTranscriptCommonModuleMocks, resetTranscriptCommonModuleMockState } from './transcriptTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const syntaxState = vi.hoisted(() => ({
    mode: 'simple' as 'off' | 'simple' | 'advanced',
    maxBytes: 100_000,
}));

vi.mock('@/components/ui/code/highlighting/useCodeSyntaxHighlighting', () => ({
    useCodeSyntaxHighlighting: () => ({
        mode: syntaxState.mode,
        language: 'bash',
        maxBytes: syntaxState.maxBytes,
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
        syntaxState.maxBytes = 100_000;
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

    it('keeps the stream tint for untokenized output text', async () => {
        const { CommandView } = await import('./CommandView');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CommandView
            command="make"
            stdout={'ok'}
            stderr={'warn'}
        />)).tree;

        const [command, stdout, stderr] = tree.findAllByType('SimpleSyntaxHighlighter' as any);
        expect(command.props.defaultColor).toBeUndefined();
        expect(typeof stdout.props.defaultColor).toBe('string');
        expect(typeof stderr.props.defaultColor).toBe('string');
        expect(stderr.props.defaultColor).not.toBe(stdout.props.defaultColor);
    });

    it('keeps the same text face and baseline as the plain path', async () => {
        const { CommandView } = await import('./CommandView');

        let plainTree!: renderer.ReactTestRenderer;
        syntaxState.mode = 'off';
        plainTree = (await renderScreen(<CommandView command="make test" stdout={'ok'} />)).tree;
        const plainCommandStyle = plainTree.findAllByType('Text' as any)
            .find((node) => node.props.children === 'make test')?.props.style;
        const plainStdoutStyle = plainTree.findAllByType('Text' as any)
            .find((node) => node.props.children === 'ok')?.props.style;

        let highlightedTree!: renderer.ReactTestRenderer;
        syntaxState.mode = 'simple';
        highlightedTree = (await renderScreen(<CommandView command="make test" stdout={'ok'} />)).tree;
        const [command, stdout] = highlightedTree.findAllByType('SimpleSyntaxHighlighter' as any);

        expect(command.props.textStyle.fontFamily).toBe(plainCommandStyle.fontFamily);
        expect(stdout.props.textStyle.fontFamily).toBe(plainStdoutStyle.fontFamily);
        expect(stdout.props.textStyle.fontSize).toBe(plainStdoutStyle.fontSize);
        expect(stdout.props.textStyle.lineHeight).toBe(plainStdoutStyle.lineHeight);

        // The plain command Text sits on the row's baseline; the highlighted container
        // must not stretch, or the command would top-align with the prompt instead.
        expect(command.props.containerStyle.alignSelf).toBe('baseline');
    });

    it('budgets each stream separately, so a long output stays plain text', async () => {
        syntaxState.maxBytes = 20;
        const { CommandView } = await import('./CommandView');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<CommandView
            command="make"
            stdout={'x'.repeat(200)}
            stderr={'warn'}
        />)).tree;

        const highlighted = tree.findAllByType('SimpleSyntaxHighlighter' as any);
        expect(highlighted.map((node) => node.props.code)).toEqual(['make', 'warn']);

        const contents = tree.findAllByType('Text' as any).map((node) => node.props.children);
        expect(contents).toContain('x'.repeat(200));
    });
});
