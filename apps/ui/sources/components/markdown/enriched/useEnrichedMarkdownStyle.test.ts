import type { TextStyle } from 'react-native';
import { describe, expect, it } from 'vitest';

import { buildEnrichedMarkdownStyle } from './useEnrichedMarkdownStyle';

const colors = {
    text: { primary: '#111111', secondary: '#666666', link: '#0066cc' },
    surface: { inset: '#eeeeee', elevated: '#ffffff', selected: '#dddddd' },
    border: { default: '#cccccc' },
} as const;

type WebUnistylesTextStyle = TextStyle & Record<`unistyles_${string}`, unknown>;

// Mirrors the transcript's real web textStyle: a Unistyles-registered style whose numeric
// metrics are non-enumerable, non-writable (but configurable) data properties.
function createWebUnistylesTextStyle(values: Readonly<Record<'fontSize' | 'lineHeight', number>>): WebUnistylesTextStyle {
    const style: WebUnistylesTextStyle = { unistyles_test: {} };
    Object.defineProperties(
        style,
        Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
            value,
            enumerable: false,
            configurable: true,
        }])),
    );
    return style;
}

describe('buildEnrichedMarkdownStyle uiFontScale', () => {
    it('scales the markdown metrics from a plain transcript textStyle', () => {
        const bundle = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1.3,
            textStyle: { fontSize: 16, lineHeight: 24 },
        });

        expect(bundle.markdownStyle.paragraph?.fontSize).toBe(20.8);
        expect(bundle.markdownStyle.paragraph?.lineHeight).toBe(31.2);
        expect(bundle.markdownStyle.codeBlock?.fontSize).toBe(18.2);
    });

    it('scales the markdown metrics from a web Unistyles transcript textStyle', () => {
        const bundle = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1.3,
            textStyle: createWebUnistylesTextStyle({ fontSize: 16, lineHeight: 24 }),
        });

        expect(bundle.markdownStyle.paragraph?.fontSize).toBe(20.8);
        expect(bundle.markdownStyle.paragraph?.lineHeight).toBe(31.2);
        expect(bundle.markdownStyle.list?.fontSize).toBe(20.8);
        expect(bundle.markdownStyle.h1?.fontSize).toBe(31.2);
    });

    it('keeps the unscaled metrics at scale 1', () => {
        const bundle = buildEnrichedMarkdownStyle({
            colors,
            profile: 'transcript',
            uiFontScale: 1,
            textStyle: createWebUnistylesTextStyle({ fontSize: 16, lineHeight: 24 }),
        });

        expect(bundle.markdownStyle.paragraph?.fontSize).toBe(16);
        expect(bundle.markdownStyle.paragraph?.lineHeight).toBe(24);
    });
});

describe('buildEnrichedMarkdownStyle chat font', () => {
    const build = (profile: 'default' | 'transcript' | 'thinking', chatFont: unknown) => buildEnrichedMarkdownStyle({
        colors,
        profile,
        uiFontScale: 1,
        textStyle: { fontSize: 16, lineHeight: 24 },
        chatFont,
    }).markdownStyle;

    it('uses the DM Sans faces for transcript text and keeps the mono font for code', () => {
        const style = build('transcript', 'dm-sans');
        const standard = build('transcript', 'default');

        expect(style.paragraph?.fontFamily).toBe('DMSans-Regular');
        expect(style.h1?.fontFamily).toBe('DMSans-SemiBold');
        expect(style.link?.fontFamily).toBe('DMSans-Regular');
        expect(style.codeBlock?.fontFamily).toBe(standard.codeBlock?.fontFamily);
        expect(build('thinking', 'dm-sans').paragraph?.fontFamily).toBe('DMSans-Regular');
    });

    it('keeps the default typography outside transcripts and for unknown values', () => {
        const standard = build('transcript', 'default');

        expect(standard.paragraph?.fontFamily).not.toBe('DMSans-Regular');
        expect(build('default', 'dm-sans').paragraph?.fontFamily).toBe(standard.paragraph?.fontFamily);
        expect(build('transcript', true).paragraph?.fontFamily).toBe(standard.paragraph?.fontFamily);
        expect(build('transcript', undefined).h1?.fontFamily).toBe(standard.h1?.fontFamily);
    });
});
