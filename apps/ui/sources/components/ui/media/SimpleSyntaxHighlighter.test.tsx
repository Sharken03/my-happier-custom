import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installMediaCommonModuleMocks } from './mediaTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installMediaCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: ({ children, ...props }: any) => React.createElement('View', props, children),
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: { colors: { text: '#111' } },
        });
    },
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
}));

vi.mock('@/components/ui/code/tokenization/simpleSyntaxTokenizer', () => ({
    tokenizeSimpleSyntaxText: () => [
        { type: 'keyword', text: 'const' },
        { type: 'default', text: ' x = 1' },
    ],
}));

describe('SimpleSyntaxHighlighter', () => {
    it('does not shrink/wrap inside horizontal scroll containers', async () => {
        const { SimpleSyntaxHighlighter } = await import('./SimpleSyntaxHighlighter');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<SimpleSyntaxHighlighter code={'const x = 1'} language={'typescript'} selectable={true} />)).tree;

        const view = tree.findByType('View');
        expect(view.props.style).toEqual(expect.objectContaining({ flexShrink: 0 }));

        const texts = tree.findAllByType('Text');
        const outerText = texts[0];
        const outerStyle = Array.isArray(outerText.props.style) ? Object.assign({}, ...outerText.props.style) : outerText.props.style;
        expect(outerStyle).toEqual(expect.objectContaining({ flexShrink: 0 }));
        expect(outerStyle).toEqual(expect.objectContaining({ whiteSpace: 'pre' }));
        expect(outerStyle).toEqual(expect.objectContaining({ display: 'inline-block' }));
    });

    it('lets a caller merge container and text styles over the defaults', async () => {
        const { SimpleSyntaxHighlighter } = await import('./SimpleSyntaxHighlighter');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<SimpleSyntaxHighlighter
            code={'const x = 1'}
            language={'typescript'}
            selectable={true}
            wrap
            textStyle={{ fontSize: 13, lineHeight: 18 }}
            containerStyle={{ flex: 1, marginTop: 8 }}
        />)).tree;

        const outerStyle = tree.findByType('View').props.style;
        expect(Array.isArray(outerStyle)).toBe(true);
        expect(Object.assign({}, ...outerStyle)).toEqual(expect.objectContaining({ flex: 1, marginTop: 8 }));

        const outerTextStyle = Object.assign({}, ...tree.findAllByType('Text')[0].props.style);
        expect(outerTextStyle).toEqual(expect.objectContaining({ fontSize: 13, lineHeight: 18 }));
    });

    it('tints untokenized text with the caller default colour', async () => {
        const { SimpleSyntaxHighlighter } = await import('./SimpleSyntaxHighlighter');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<SimpleSyntaxHighlighter
            code={'const x = 1'}
            language={'typescript'}
            selectable={true}
            defaultColor={'#abc'}
        />)).tree;

        const tokenColors = tree.findAllByType('Text').slice(1).map((node) => node.props.style.color);
        expect(tokenColors).toHaveLength(2);
        expect(tokenColors[1]).toBe('#abc');
        expect(tokenColors[0]).not.toBe('#abc');
    });

    it('leaves the font to the outer text so caller overrides reach the glyphs', async () => {
        const { SimpleSyntaxHighlighter } = await import('./SimpleSyntaxHighlighter');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<SimpleSyntaxHighlighter
            code={'const x = 1'}
            language={'typescript'}
            selectable={true}
            textStyle={{ fontFamily: 'Menlo' }}
        />)).tree;

        const [outerText, ...tokenTexts] = tree.findAllByType('Text');
        expect(Object.assign({}, ...outerText.props.style)).toEqual(expect.objectContaining({ fontFamily: 'Menlo' }));
        expect(tokenTexts).toHaveLength(2);
        for (const tokenText of tokenTexts) {
            expect(tokenText.props.style.fontFamily).toBeUndefined();
        }
    });
});
