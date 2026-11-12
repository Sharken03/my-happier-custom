import { Dimensions, PixelRatio } from 'react-native';

const TRANSCRIPT_ROW_WIDTH_BUCKET_PX = 64;

export function resolveTranscriptRowWidthBucket(width: unknown): string {
    const normalizedWidth = typeof width === 'number' && Number.isFinite(width)
        ? Math.max(1, Math.trunc(width))
        : 1;
    const bucket = Math.max(
        TRANSCRIPT_ROW_WIDTH_BUCKET_PX,
        Math.ceil(normalizedWidth / TRANSCRIPT_ROW_WIDTH_BUCKET_PX) * TRANSCRIPT_ROW_WIDTH_BUCKET_PX,
    );
    return `width:${bucket}`;
}

export function resolveInitialTranscriptRowWidthBucket(): string {
    return resolveTranscriptRowWidthBucket(Dimensions.get('window')?.width);
}

export function resolveFontScaleKey(): string {
    const fontScale = typeof PixelRatio.getFontScale === 'function'
        ? PixelRatio.getFontScale()
        : Dimensions.get('window')?.fontScale;
    const normalized = typeof fontScale === 'number' && Number.isFinite(fontScale)
        ? Math.max(0.5, fontScale)
        : 1;
    return `font:${Math.round(normalized * 100)}`;
}

/**
 * The presentation part of a row height key: everything outside a row's own content that changes
 * its painted height. A height measured in one chat font is not the height of that row in the
 * other font, and a thinking row measured while hidden (1 px) is not its height as a row or card.
 * The transcript markdown scales with the in-app text size (`useEnrichedMarkdownStyle`), and the
 * code block wrap default decides whether long code lines wrap or scroll sideways.
 */
export function resolveTranscriptRowPresentationKey(params: Readonly<{
    chatFont: unknown;
    thinkingDisplayMode: unknown;
    thinkingInlineChrome: unknown;
    uiFontScale: unknown;
    wrapCodeBlocks: unknown;
}>): string {
    const chatFont = params.chatFont === 'dm-sans' ? 'dm-sans' : 'default';
    const thinkingDisplayMode = params.thinkingDisplayMode === 'hidden' || params.thinkingDisplayMode === 'tool'
        ? params.thinkingDisplayMode
        : 'inline';
    const thinkingInlineChrome = params.thinkingInlineChrome === 'card' ? 'card' : 'plain';
    const uiFontScale = typeof params.uiFontScale === 'number' && Number.isFinite(params.uiFontScale)
        ? params.uiFontScale
        : 1;
    const codeWrap = params.wrapCodeBlocks === true ? 'wrap' : 'scroll';
    return `${resolveFontScaleKey()}|ui-font:${Math.round(uiFontScale * 100)}|chat-font:${chatFont}`
        + `|thinking:${thinkingDisplayMode}:${thinkingInlineChrome}|code:${codeWrap}`;
}
