import type { MarkdownStyle } from 'react-native-enriched-markdown';

/**
 * Android only. The native renderer resolves the strong, em and code font families with
 * `Typeface.create(name)`, which knows system families only. A bundled family name such as
 * "Inter-SemiBold" gives the default regular face, so bold and italic text look like normal text
 * and code is not monospace. With an empty family the renderer derives bold and italic from the
 * paragraph face and uses the system monospace face.
 *
 * The inline code background is left out too: the renderer starts it at the line start in a list
 * item, extends it to the line end where the code wraps, and lets it touch the lines around it.
 */
export function adaptEnrichedMarkdownStyleForAndroid(style: MarkdownStyle): MarkdownStyle {
    return {
        ...style,
        strong: { ...style.strong, fontFamily: '', fontWeight: 'bold' },
        em: { ...style.em, fontFamily: '', fontStyle: 'italic' },
        code: { ...style.code, fontFamily: '', backgroundColor: 'transparent' },
    };
}
