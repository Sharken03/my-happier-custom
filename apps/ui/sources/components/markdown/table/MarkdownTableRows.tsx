import * as React from 'react';
import { PixelRatio, Platform, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useLocalSetting } from '@/sync/store/hooks';
import { resolveChatFontFaces, resolveChatFontSpanStyle, type ChatFontFaces } from '@/constants/chatFont';
import { useSetting } from '@/sync/domains/state/storage';

import { EnrichedMarkdownTextAdapter } from '../enriched/EnrichedMarkdownTextAdapter';
import { MarkdownSpansView } from '../MarkdownSpansView';
import { parseMarkdownSpans } from '../parseMarkdownSpans';
import type { MarkdownSpan } from '../parseMarkdown';
import type { MarkdownTableAlignment } from '../parseMarkdown';
import type { MarkdownRenderingProfile } from '../rendering/MarkdownRenderingProfile';
import type { StreamingTextRevealPreset } from '../streaming/streamingTextRevealConfig';
import { estimateMarkdownTableLayout, type MarkdownTableLayout } from './estimateMarkdownTableLayout';

const CELL_FONT_SIZE = 16;
const CELL_PADDING_HORIZONTAL = 16;
const CELL_BORDER_WIDTH = 1;

export type MarkdownTableContent = Readonly<{
    headers: string[];
    rows: string[][];
    alignments: MarkdownTableAlignment[];
}>;

export type MarkdownTableCellRendering = Readonly<{
    selectable: boolean;
    onLinkPress?: (url: string) => boolean | void;
    textStyle?: StyleProp<TextStyle>;
    profile: MarkdownRenderingProfile;
    streamingReveal: boolean;
    streamingRevealPreset?: StreamingTextRevealPreset;
    agentTexMath: boolean;
}>;

function readSystemFontScale(): number {
    if (Platform.OS === 'web' || typeof PixelRatio.getFontScale !== 'function') return 1;
    const scale = PixelRatio.getFontScale();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Column widths for one table's content. Recomputes only when the content or the font scale the
 * text primitives apply changes; rotation and resizing are absorbed by flex layout.
 */
export function useMarkdownTableLayout(headers: readonly string[], rows: readonly (readonly string[])[]): MarkdownTableLayout {
    const uiFontScale = useLocalSetting('uiFontScale');
    const fontScale = uiFontScale * readSystemFontScale();
    return React.useMemo(() => estimateMarkdownTableLayout({
        headers,
        rows,
        fontSize: CELL_FONT_SIZE,
        fontScale,
        cellHorizontalChrome: CELL_PADDING_HORIZONTAL * 2 + CELL_BORDER_WIDTH,
    }), [fontScale, headers, rows]);
}

function useColumnStyles(layout: MarkdownTableLayout): readonly ViewStyle[] {
    return React.useMemo(() => layout.columns.map((column) => ({
        flexBasis: column.natural,
        // Only grows when the frame is wider than the table (its footer needs more room).
        flexGrow: 1,
        flexShrink: column.shrink,
        minWidth: column.floor,
    })), [layout]);
}

type MarkdownTableRowsProps = MarkdownTableContent & MarkdownTableCellRendering & Readonly<{
    layout: MarkdownTableLayout;
}>;

export const MarkdownTableHeaderRow = React.memo(function MarkdownTableHeaderRow(props: MarkdownTableRowsProps & Readonly<{
    style?: StyleProp<ViewStyle>;
}>) {
    const columnStyles = useColumnStyles(props.layout);
    const chatFontFaces = resolveChatFontFaces(useSetting('transcriptChatFont'), props.profile);
    return (
        <View style={[styles.row, styles.headerRow, props.rows.length === 0 && styles.rowLast, props.style]}>
            {props.headers.map((header, columnIndex) => (
                <MarkdownTableCell
                    key={columnIndex}
                    markdown={header}
                    header
                    last={columnIndex === props.headers.length - 1}
                    columnStyle={columnStyles[columnIndex]}
                    alignment={props.alignments[columnIndex] ?? 'default'}
                    rendering={props}
                    chatFontFaces={chatFontFaces}
                />
            ))}
        </View>
    );
});

export const MarkdownTableBodyRows = React.memo(function MarkdownTableBodyRows(props: MarkdownTableRowsProps) {
    const columnStyles = useColumnStyles(props.layout);
    const chatFontFaces = resolveChatFontFaces(useSetting('transcriptChatFont'), props.profile);
    return (
        <>
            {props.rows.map((row, rowIndex) => (
                <View key={rowIndex} style={[styles.row, rowIndex === props.rows.length - 1 && styles.rowLast]}>
                    {props.headers.map((_, columnIndex) => (
                        <MarkdownTableCell
                            key={columnIndex}
                            markdown={row[columnIndex] ?? ''}
                            header={false}
                            last={columnIndex === props.headers.length - 1}
                            columnStyle={columnStyles[columnIndex]}
                            alignment={props.alignments[columnIndex] ?? 'default'}
                            rendering={props}
                            chatFontFaces={chatFontFaces}
                        />
                    ))}
                </View>
            ))}
        </>
    );
});

function MarkdownTableCell(props: Readonly<{
    markdown: string;
    header: boolean;
    last: boolean;
    columnStyle: ViewStyle | undefined;
    alignment: MarkdownTableAlignment;
    rendering: MarkdownTableCellRendering;
    chatFontFaces: ChatFontFaces | null;
}>) {
    const { rendering, chatFontFaces } = props;
    return (
        <View
            style={[
                styles.cell,
                props.columnStyle,
                cellAlignmentStyle(props.alignment),
                props.header && styles.headerCell,
                props.last && styles.cellLast,
            ]}
        >
            <MarkdownTableCellContent
                markdown={props.markdown}
                selectable={rendering.selectable}
                onLinkPress={rendering.onLinkPress}
                textStyle={[props.header ? styles.headerText : styles.cellText, textAlignmentStyle(props.alignment), wrapAnywhereStyle, rendering.textStyle, props.header ? chatFontFaces?.semiBold : chatFontFaces?.regular]}
                chatFontFaces={chatFontFaces}
                profile={rendering.profile}
                streamingReveal={rendering.streamingReveal}
                streamingRevealPreset={rendering.streamingRevealPreset}
                agentTexMath={rendering.agentTexMath}
            />
        </View>
    );
}

function MarkdownTableCellContent(props: Readonly<{
    markdown: string;
    selectable: boolean;
    onLinkPress?: (url: string) => boolean | void;
    textStyle?: StyleProp<TextStyle>;
    chatFontFaces: ChatFontFaces | null;
    profile: MarkdownRenderingProfile;
    streamingReveal: boolean;
    streamingRevealPreset?: StreamingTextRevealPreset;
    agentTexMath: boolean;
}>) {
    if (!containsPotentialEnrichedMath(props.markdown, props.agentTexMath)) {
        if (TABLE_CELL_INLINE_MARKDOWN.test(props.markdown)) {
            return <MarkdownTableCellSpans markdown={props.markdown} selectable={props.selectable} onLinkPress={props.onLinkPress} textStyle={props.textStyle} chatFontFaces={props.chatFontFaces} />;
        }
        return <Text selectable={props.selectable} style={props.textStyle}>{props.markdown}</Text>;
    }

    return (
        <EnrichedMarkdownTextAdapter
            markdown={props.markdown}
            profile={props.profile}
            selectable={props.selectable}
            onLinkPress={props.onLinkPress}
            textStyle={props.textStyle}
            streamingAnimated={props.streamingReveal}
            streamingRevealPreset={props.streamingRevealPreset}
            testID="markdown-table-cell-enriched"
            suppressLeadingTopMargin
            fillContainer={false}
            agentTexMath={props.agentTexMath}
        />
    );
}

/** The characters that start bold, italic, code or a link. A cell without them stays one plain text node. */
const TABLE_CELL_INLINE_MARKDOWN = /[*_`[]/;

function resolveTableCellSpanStyle(styleName: MarkdownSpan['styles'][number]) {
    return styles[styleName];
}

/** A table cell with inline markdown: without this the cell showed its markers, such as `**Stue**`. */
function MarkdownTableCellSpans(props: Readonly<{
    markdown: string;
    selectable: boolean;
    onLinkPress?: (url: string) => boolean | void;
    textStyle?: StyleProp<TextStyle>;
    chatFontFaces: ChatFontFaces | null;
}>) {
    const spans = React.useMemo(() => parseMarkdownSpans(props.markdown, false), [props.markdown]);
    const faces = props.chatFontFaces;
    const resolveSpanStyle = React.useCallback(
        (styleName: MarkdownSpan['styles'][number]) => (faces
            ? [resolveTableCellSpanStyle(styleName), resolveChatFontSpanStyle(faces, styleName)]
            : resolveTableCellSpanStyle(styleName)),
        [faces],
    );
    const linkStyle = React.useMemo(() => (faces ? [styles.link, faces.regular] : styles.link), [faces]);
    return (
        <Text selectable={props.selectable} style={props.textStyle}>
            <MarkdownSpansView
                spans={spans}
                baseStyle={props.textStyle}
                linkStyle={linkStyle}
                onLinkPress={props.onLinkPress}
                resolveSpanStyle={resolveSpanStyle}
                inlineTextSelectable={false}
            />
        </Text>
    );
}

function containsPotentialEnrichedMath(markdown: string, agentTexMath: boolean): boolean {
    return markdown.includes('$')
        || (agentTexMath && (markdown.includes('\\(') || markdown.includes('\\[')));
}

// Web: let long unbreakable tokens (URLs, paths) break inside the cell instead of overflowing it.
// Native text layout already breaks a word that does not fit its line.
const wrapAnywhereStyle = Platform.OS === 'web'
    ? ({ overflowWrap: 'anywhere' } as unknown as TextStyle)
    : null;

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        borderBottomWidth: CELL_BORDER_WIDTH,
        borderBottomColor: theme.colors.border.default,
    },
    rowLast: {
        borderBottomWidth: 0,
    },
    headerRow: {
        backgroundColor: theme.colors.surface.inset,
    },
    cell: {
        paddingHorizontal: CELL_PADDING_HORIZONTAL,
        paddingVertical: 10,
        borderRightWidth: CELL_BORDER_WIDTH,
        borderRightColor: theme.colors.border.default,
    },
    cellLast: {
        borderRightWidth: 0,
    },
    headerCell: {
        backgroundColor: theme.colors.surface.inset,
    },
    cellAlignLeft: {
        alignItems: 'flex-start',
    },
    cellAlignCenter: {
        alignItems: 'center',
    },
    cellAlignRight: {
        alignItems: 'flex-end',
    },
    textAlignLeft: {
        textAlign: 'left',
    },
    textAlignCenter: {
        textAlign: 'center',
    },
    textAlignRight: {
        textAlign: 'right',
    },
    headerText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: CELL_FONT_SIZE,
        lineHeight: 24,
    },
    cellText: {
        ...Typography.default(),
        color: theme.colors.text.primary,
        fontSize: CELL_FONT_SIZE,
        lineHeight: 24,
    },
    // Inline markdown inside a cell; the same looks as the transcript's text blocks.
    italic: {
        ...Typography.default('italic'),
    },
    bold: {
        ...Typography.default('semiBold'),
    },
    semibold: {
        ...Typography.default('semiBold'),
    },
    code: {
        ...Typography.mono(),
        fontSize: 14,
        lineHeight: 20,
        backgroundColor: theme.colors.surface.selected,
    },
    link: {
        ...Typography.default(),
        color: theme.colors.text.link,
        fontWeight: '400',
    },
}));

function cellAlignmentStyle(alignment: MarkdownTableAlignment) {
    if (alignment === 'center') return styles.cellAlignCenter;
    if (alignment === 'right') return styles.cellAlignRight;
    return styles.cellAlignLeft;
}

function textAlignmentStyle(alignment: MarkdownTableAlignment) {
    if (alignment === 'center') return styles.textAlignCenter;
    if (alignment === 'right') return styles.textAlignRight;
    return styles.textAlignLeft;
}
