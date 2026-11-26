import { MarkdownSpan } from './parseMarkdown';
import { Link } from 'expo-router';
import * as React from 'react';
import { Platform } from 'react-native';
import { Text } from '../ui/text/Text';
import { openMarkdownLinkUrl } from './enriched/enrichedMarkdownLinkHandling';
import { StreamingTextReveal } from './streaming/StreamingTextReveal';
import { isStreamingIncompleteLinkHref } from './streaming/streamingMarkdownRepairConfig';
import type { StreamingTextRevealPreset } from './streaming/streamingTextRevealConfig';

export type MarkdownSpansViewProps = {
    spans: MarkdownSpan[];
    baseStyle?: any;
    linkStyle?: any;
    onLinkPress?: (url: string) => boolean | void;
    resolveSpanStyle?: (styleName: MarkdownSpan['styles'][number]) => any;
    inlineTextSelectable?: boolean;
    streamingReveal?: boolean;
    streamingRevealPreset?: StreamingTextRevealPreset;
};

/**
 * Inline spans normally opt out of selection on native: a selectable nested Text breaks the
 * parent Text's own selection. On web the flag writes `user-select: none` (react-native-web), so a
 * formatted fragment such as bold, code or a link would be unselectable even inside a selectable
 * text root. Web therefore inherits the root's selectability, native keeps the explicit flag.
 */
export function resolveInlineSpanSelection(inlineTextSelectable: boolean): Readonly<{
    selectable?: boolean;
    inheritWebTextSelection?: boolean;
}> {
    if (Platform.OS !== 'web') return { selectable: inlineTextSelectable };
    return inlineTextSelectable ? { selectable: true } : { inheritWebTextSelection: true };
}

export const MarkdownSpansView = React.memo((props: MarkdownSpansViewProps) => {
    const resolveSpanStyle = props.resolveSpanStyle ?? (() => undefined);
    const inlineTextSelectable = props.inlineTextSelectable ?? true;
    const spanSelection = resolveInlineSpanSelection(inlineTextSelectable);
    // The transcript handler claims file links only and returns true for those. Anything else
    // (http, https, mailto) has to open externally here, or a pressed link would stay inert —
    // as it did in table cells, which render through the spans view instead of the enriched one.
    const handleLinkPress = React.useCallback((url: string) => {
        if (props.onLinkPress?.(url) === true) return;
        void openMarkdownLinkUrl(url);
    }, [props.onLinkPress]);

    return (
        <>
            {props.spans.map((span, index) => {
                if (span.url) {
                    const linkStyle = [props.linkStyle, span.styles.map(resolveSpanStyle)];
                    // Special blocks render from the same repaired source as prose, so a link
                    // whose URL is still streaming reaches here as the repair placeholder.
                    // Unlike the enriched path there is no link-target normalization between
                    // the span and the caller, so the placeholder is kept out of both the
                    // press callback and Expo Router until the real destination arrives.
                    if (isStreamingIncompleteLinkHref(span.url)) {
                        return (
                            <Text
                                key={index}
                                {...spanSelection}
                                style={linkStyle}
                            >
                                {span.text}
                            </Text>
                        );
                    }
                    if (props.onLinkPress) {
                        return (
                            <Text
                                key={index}
                                accessibilityRole="link"
                                onPress={() => handleLinkPress(span.url!)}
                                {...spanSelection}
                                style={linkStyle}
                            >
                                {span.text}
                            </Text>
                        );
                    }
                    const isWeb = Platform.OS === 'web';
                    return (
                        <Link
                            key={index}
                            href={span.url as any}
                            target="_blank"
                            rel="noopener noreferrer"
                            // On web, avoid `asChild` so Expo Router can forward `href`/`target`/`rel` to an anchor-like
                            // element (RN Web `hrefAttrs`). On native, use `asChild` so selection works reliably.
                            asChild={!isWeb}
                            style={isWeb ? linkStyle : undefined}
                        >
                            {isWeb ? (
                                span.text
                            ) : (
                                <Text
                                    {...spanSelection}
                                    style={linkStyle}
                                >
                                    {span.text}
                                </Text>
                            )}
                        </Link>
                    );
                }

                const spanStyle = [props.baseStyle, span.styles.map(resolveSpanStyle)];
                if (props.streamingReveal === true && !span.styles.includes('code')) {
                    return (
                        <StreamingTextReveal
                            key={index}
                            {...spanSelection}
                            style={spanStyle}
                            text={span.text}
                            animated
                            preset={props.streamingRevealPreset}
                        />
                    );
                }

                return (
                    <Text
                        key={index}
                        {...spanSelection}
                        style={spanStyle}
                    >
                        {span.text}
                    </Text>
                );
            })}
        </>
    );
});
