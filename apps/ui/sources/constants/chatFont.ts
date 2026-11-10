import type { TextStyle } from 'react-native';

import type { MarkdownRenderingProfile } from '@/components/markdown/rendering/MarkdownRenderingProfile';

/**
 * Chat font: the font of message text in a transcript. The rest of the app keeps the default
 * typography. Each family name encodes its weight and style, like the Inter families.
 */
export type ChatFontFaces = Readonly<{
    regular: Readonly<{ fontFamily: string }>;
    italic: Readonly<{ fontFamily: string }>;
    semiBold: Readonly<{ fontFamily: string }>;
}>;

const DM_SANS_FACES: ChatFontFaces = {
    regular: { fontFamily: 'DMSans-Regular' },
    italic: { fontFamily: 'DMSans-Italic' },
    semiBold: { fontFamily: 'DMSans-SemiBold' },
};

/** Returns null when the text keeps the default typography. */
export function resolveChatFontFaces(
    chatFont: unknown,
    profile: MarkdownRenderingProfile,
): ChatFontFaces | null {
    if (profile === 'default') return null;
    return chatFont === 'dm-sans' ? DM_SANS_FACES : null;
}

/** The chat font face for a text style that has a bundled family name with a weight or style in it. */
export function resolveChatFontSpanStyle(
    faces: ChatFontFaces,
    styleName: string,
): Pick<TextStyle, 'fontFamily'> | null {
    if (styleName === 'bold' || styleName === 'semibold') return faces.semiBold;
    if (styleName === 'italic') return faces.italic;
    return null;
}
