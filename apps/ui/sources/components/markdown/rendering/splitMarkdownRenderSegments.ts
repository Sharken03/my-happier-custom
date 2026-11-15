import { parseMarkdownBlockSource } from '../streaming/parseMarkdownBlockSource';
import { readMarkdownOption } from '../parseMarkdownBlock';
import { preprocessStreamingMarkdown } from '../streaming/preprocessStreamingMarkdown';
import {
    splitMarkdownIntoBlockSources,
    type MarkdownBlockSource,
} from '../streaming/splitMarkdownIntoBlockSources';
import type { MarkdownSourceRange } from '../parseMarkdown';
import type { MarkdownRenderSegment } from './markdownRenderSegmentTypes';
import {
    buildMarkdownContentCacheSlot,
    readMarkdownRenderSegmentsCache,
    writeMarkdownRenderSegmentsCache,
} from './markdownRenderSegmentsCache';
import { normalizeLooseListContinuations } from './normalizeLooseListContinuations';
import { readStandaloneMarkdownRemoteImage } from './markdownRemoteImages';

type LocatedMarkdownBlockSource = MarkdownBlockSource & Readonly<{
    sourceStart: number;
    sourceLength: number;
    sourceHash: string;
    sourceRange: MarkdownSourceRange;
}>;

type PendingEnrichedGroup = Readonly<{
    sources: readonly LocatedMarkdownBlockSource[];
    markdown: string;
    sourceStart: number;
    sourceLength: number;
    sourceHash: string;
    sourceRange: MarkdownSourceRange;
}>;

type DraftMarkdownRenderSegment =
    | Omit<Extract<MarkdownRenderSegment, { type: 'enriched-markdown' }>, 'first' | 'last'>
    | Omit<Extract<MarkdownRenderSegment, { type: 'special-block' }>, 'first' | 'last'>
    | Omit<Extract<MarkdownRenderSegment, { type: 'remote-image' }>, 'first' | 'last'>
    | Omit<Extract<MarkdownRenderSegment, { type: 'container-block' }>, 'first' | 'last'>;

function hashMarkdownSource(source: string): string {
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function locateSources(markdown: string, sources: readonly MarkdownBlockSource[]): LocatedMarkdownBlockSource[] {
    let cursor = 0;
    let line = 1;
    return sources.map((source) => {
        while (cursor < source.sourceStart) if (markdown.charCodeAt(cursor++) === 10) line++;
        const startLine = line;
        const end = source.sourceStart + source.source.length;
        while (cursor < end) if (markdown.charCodeAt(cursor++) === 10) line++;
        return {
            ...source,
            sourceLength: source.source.length,
            sourceHash: hashMarkdownSource(source.source),
            sourceRange: { startLine, endLine: line },
        };
    });
}

/**
 * An agent often writes an image on its own line inside a paragraph (single line breaks). Such a
 * paragraph is split at those lines: the text lines around an image stay one paragraph each, and
 * each allowed image line becomes its own block, which the loop then paints as a remote image.
 */
function splitParagraphsAtRemoteImageLines(
    sources: readonly MarkdownBlockSource[],
    hosts: readonly string[],
): MarkdownBlockSource[] {
    const result: MarkdownBlockSource[] = [];
    for (const source of sources) {
        if (source.blockType !== 'Paragraph' || source.container || source.codeBlock || source.incompleteKind
            || !source.source.includes('\n') || !source.source.includes('![')) {
            result.push(source);
            continue;
        }
        const pieces: MarkdownBlockSource[] = [];
        let textStart = -1;
        let textEnd = 0;
        const pushText = () => {
            if (textStart < 0) return;
            const text = source.source.slice(textStart, textEnd);
            if (text.trim()) pieces.push({ ...source, source: text, sourceStart: source.sourceStart + textStart });
            textStart = -1;
        };
        let offset = 0;
        for (const line of source.source.split('\n')) {
            if (readStandaloneMarkdownRemoteImage(line, hosts)) {
                pushText();
                pieces.push({ ...source, source: line, sourceStart: source.sourceStart + offset });
            } else {
                if (textStart < 0) textStart = offset;
                textEnd = offset + line.length;
            }
            offset += line.length + 1;
        }
        pushText();
        result.push(...(pieces.length > 1 ? pieces : [source]));
    }
    return result;
}

function isSpecialSource(source: LocatedMarkdownBlockSource): boolean {
    if (source.container || source.codeBlock) return true;
    if (source.incompleteKind) return true;
    return source.blockType === 'FencedCode'
        || source.blockType === 'Table' || source.source.trimStart().startsWith('<options>')
        || source.source.split('\n').some((line) => readMarkdownOption(line) !== null);
}

function withReferenceDefinitions(markdown: string, definitions: string): string {
    return definitions ? `${definitions}\n\n${markdown}` : markdown;
}

function buildGroupMarkdown(markdown: string, sources: readonly LocatedMarkdownBlockSource[]): string {
    const firstSource = sources[0];
    const lastSource = sources[sources.length - 1];
    if (!firstSource || !lastSource) return '';

    const end = lastSource.sourceStart + lastSource.sourceLength;
    return markdown.slice(firstSource.sourceStart, end);
}

function buildGroup(markdown: string, sources: readonly LocatedMarkdownBlockSource[]): PendingEnrichedGroup | null {
    const firstSource = sources[0];
    const lastSource = sources[sources.length - 1];
    if (!firstSource || !lastSource) return null;

    const sourceStart = firstSource.sourceStart;
    const sourceLength = lastSource.sourceStart + lastSource.sourceLength - sourceStart;
    const groupMarkdown = buildGroupMarkdown(markdown, sources);
    if (!groupMarkdown) return null;

    return {
        sources,
        markdown: groupMarkdown,
        sourceStart,
        sourceLength,
        sourceHash: hashMarkdownSource(groupMarkdown),
        sourceRange: { startLine: firstSource.sourceRange.startLine, endLine: lastSource.sourceRange.endLine },
    };
}

function applyFirstLast(segments: readonly DraftMarkdownRenderSegment[]): MarkdownRenderSegment[] {
    return segments.map((segment, index) => ({
        ...segment,
        first: index === 0,
        last: index === segments.length - 1,
    } as MarkdownRenderSegment));
}

function readStaticSegmentCache(markdown: string): MarkdownRenderSegment[] | null {
    return readMarkdownRenderSegmentsCache(buildMarkdownContentCacheSlot(markdown), markdown);
}

function writeStaticSegmentCache(markdown: string, segments: MarkdownRenderSegment[]): void {
    writeMarkdownRenderSegmentsCache(buildMarkdownContentCacheSlot(markdown), markdown, segments);
}

function buildEnrichedSegment(source: LocatedMarkdownBlockSource, nextSegmentKey: () => string): DraftMarkdownRenderSegment {
    return {
        type: 'enriched-markdown',
        key: nextSegmentKey(),
        sourceStart: source.sourceStart,
        sourceLength: source.sourceLength,
        sourceHash: source.sourceHash,
        sourceRange: source.sourceRange,
        markdown: source.source,
        renderMarkdown: withReferenceDefinitions(source.source, source.referenceDefinitions),
    };
}

export function splitMarkdownRenderSegments(params: Readonly<{
    markdown: string;
    streamingMode: 'static' | 'streaming';
    streamingRepair?: 'sync' | 'prepared';
    splitEnrichedSourceRanges?: boolean;
    /** Allowed image hosts; empty or absent while the setting is off. */
    remoteImageHosts?: readonly string[];
}>): MarkdownRenderSegment[] {
    const remoteImageHosts = params.remoteImageHosts ?? [];
    // The static cache is keyed on the markdown only. A text with an image can split another way
    // once hosts are allowed, so it skips the cache; every other text splits as before.
    const cacheable = params.streamingMode === 'static'
        && params.splitEnrichedSourceRanges !== true
        && (remoteImageHosts.length === 0 || !params.markdown.includes('!['));
    if (cacheable) {
        const cached = readStaticSegmentCache(params.markdown);
        if (cached) return cached;
    }

    const repairedMarkdown = params.streamingMode === 'streaming' && params.streamingRepair !== 'prepared'
        ? preprocessStreamingMarkdown(params.markdown)
        : params.markdown;
    const renderMarkdown = normalizeLooseListContinuations(repairedMarkdown);
    const blockSources = splitMarkdownIntoBlockSources(renderMarkdown);
    const locatedSources = locateSources(
        renderMarkdown,
        remoteImageHosts.length > 0 ? splitParagraphsAtRemoteImageLines(blockSources, remoteImageHosts) : blockSources,
    );
    const segments: DraftMarkdownRenderSegment[] = [];
    let pendingEnrichedSources: LocatedMarkdownBlockSource[] = [];
    let segmentOrdinal = 0;
    const nextSegmentKey = () => {
        const key = `segment:${segmentOrdinal}`;
        segmentOrdinal++;
        return key;
    };

    const flushPendingEnrichedSources = () => {
        const group = buildGroup(renderMarkdown, pendingEnrichedSources);
        pendingEnrichedSources = [];
        if (!group) return;

        segments.push({
            type: 'enriched-markdown',
            key: nextSegmentKey(),
            sourceStart: group.sourceStart,
            sourceLength: group.sourceLength,
            sourceHash: group.sourceHash,
            sourceRange: group.sourceRange,
            markdown: group.markdown,
            renderMarkdown: withReferenceDefinitions(group.markdown, group.sources[0]?.referenceDefinitions ?? ''),
        });
    };

    for (const source of locatedSources) {
        const remoteImage = remoteImageHosts.length > 0 && !source.container && !source.codeBlock && !source.incompleteKind
            ? readStandaloneMarkdownRemoteImage(source.source, remoteImageHosts)
            : null;
        if (remoteImage) {
            flushPendingEnrichedSources();
            segments.push({
                type: 'remote-image',
                key: nextSegmentKey(),
                sourceStart: source.sourceStart,
                sourceLength: source.sourceLength,
                sourceHash: source.sourceHash,
                sourceRange: source.sourceRange,
                markdown: source.source,
                url: remoteImage.url,
                alt: remoteImage.alt,
            });
            continue;
        }
        if (!isSpecialSource(source)) {
            if (params.splitEnrichedSourceRanges === true) {
                flushPendingEnrichedSources();
                segments.push(buildEnrichedSegment(source, nextSegmentKey));
                continue;
            }
            pendingEnrichedSources.push(source);
            continue;
        }

        flushPendingEnrichedSources();
        if (source.container) {
            segments.push({
                type: 'container-block',
                key: nextSegmentKey(),
                sourceStart: source.sourceStart,
                sourceLength: source.sourceLength,
                sourceHash: source.sourceHash,
                sourceRange: source.sourceRange,
                markdown: source.source,
                container: source.container,
            });
            continue;
        }
        segments.push({
            type: 'special-block',
            key: nextSegmentKey(),
            sourceStart: source.sourceStart,
            sourceLength: source.sourceLength,
            sourceHash: source.sourceHash,
            sourceRange: source.sourceRange,
            markdown: source.source,
            blocks: parseMarkdownBlockSource(source),
        });
    }

    flushPendingEnrichedSources();
    const result = applyFirstLast(segments);
    if (cacheable) {
        writeStaticSegmentCache(params.markdown, result);
    }
    return result;
}
