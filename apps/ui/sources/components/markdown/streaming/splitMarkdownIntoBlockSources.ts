import { TreeFragment, type Tree } from '@lezer/common';
import { parser, GFM } from '@lezer/markdown';
import { readIncompleteMarkdownBlockKind, type IncompleteMarkdownBlockKind } from './isIncompleteMarkdownBlockSource';
import type { MarkdownBlock } from '../parseMarkdown';
import { containsMarkdownCode, readMarkdownCodeBlock, readMarkdownContainerBlock, type MarkdownContainerBlock } from './readMarkdownContainerBlock';

const markdownBlockParser = parser.configure(GFM);

export type MarkdownBlockSource = Readonly<{
    index: number;
    source: string;
    sourceStart: number;
    blockType: string;
    referenceDefinitions: string;
    incompleteKind: IncompleteMarkdownBlockKind | null;
    container?: MarkdownContainerBlock;
    codeBlock?: MarkdownBlock;
}>;

/** Nodes that can hold a LinkReference. Other blocks and all inline nodes are not entered. */
const LINK_REFERENCE_CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

/** Recent parses, newest last. A streaming reply changes at its end, so its last parse has most of the next one. */
const MAX_REMEMBERED_PARSES = 4;
const rememberedParses: { markdown: string; tree: Tree }[] = [];

const PREFIX_COMPARE_CHUNK = 256;

function readCommonPrefixLength(a: string, b: string): number {
    // A stream delta usually appends, so test that first. Otherwise compare whole chunks natively
    // and walk single characters only in the first chunk that differs; Hermes runs a
    // per-character loop slowly.
    if (b.startsWith(a)) return a.length;
    const max = Math.min(a.length, b.length);
    let index = 0;
    while (
        index + PREFIX_COMPARE_CHUNK <= max
        && a.slice(index, index + PREFIX_COMPARE_CHUNK) === b.slice(index, index + PREFIX_COMPARE_CHUNK)
    ) index += PREFIX_COMPARE_CHUNK;
    while (index < max && a.charCodeAt(index) === b.charCodeAt(index)) index++;
    return index;
}

/**
 * Parses the markdown with the block grammar. When a remembered parse shares a prefix, lezer
 * reuses its blocks before the change and parses only the rest (the tree is the same as a full parse).
 */
export function parseMarkdownBlockTree(markdown: string): Tree {
    let best = -1;
    let bestPrefix = 0;
    for (let index = 0; index < rememberedParses.length; index++) {
        const prefix = readCommonPrefixLength(rememberedParses[index]!.markdown, markdown);
        if (prefix > 0 && prefix >= bestPrefix) {
            best = index;
            bestPrefix = prefix;
        }
    }
    let tree: Tree;
    if (best >= 0) {
        const remembered = rememberedParses.splice(best, 1)[0]!;
        if (remembered.markdown === markdown) {
            tree = remembered.tree;
        } else {
            const fragments = TreeFragment.applyChanges(TreeFragment.addTree(remembered.tree), [{
                fromA: bestPrefix, toA: remembered.markdown.length, fromB: bestPrefix, toB: markdown.length,
            }]);
            tree = markdownBlockParser.parse(markdown, fragments);
        }
    } else {
        tree = markdownBlockParser.parse(markdown);
    }
    rememberedParses.push({ markdown, tree });
    if (rememberedParses.length > MAX_REMEMBERED_PARSES) rememberedParses.shift();
    return tree;
}

/** One grammar owns boundaries for both grouped rendering and source-range measurement. */
export function splitMarkdownIntoBlockSources(markdown: string): MarkdownBlockSource[] {
    return readMarkdownBlockSources(markdown, parseMarkdownBlockTree(markdown));
}

/** Reads the top-level blocks of a tree that `markdownBlockParser` made from this markdown. */
export function readMarkdownBlockSources(markdown: string, tree: Tree): MarkdownBlockSource[] {
    const definitions: string[] = [];
    tree.iterate({ enter(node) {
        if (node.name !== 'LinkReference') return LINK_REFERENCE_CONTAINERS.has(node.name);
        // Container markers are grammar tokens, not part of a global definition.
        let cursor = node.from;
        let definition = '';
        for (const marker of node.node.getChildren('QuoteMark')) {
            definition += markdown.slice(cursor, marker.from);
            cursor = marker.to;
        }
        definitions.push(definition + markdown.slice(cursor, node.to));
        return false;
    } });
    const referenceDefinitions = definitions.join('\n');
    const sources: MarkdownBlockSource[] = [];
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.name === 'LinkReference') continue;
        const sourceStart = markdown.lastIndexOf('\n', node.from - 1) + 1;
        const source = markdown.slice(sourceStart, node.to);
        sources.push({
            index: sources.length,
            source,
            sourceStart,
            blockType: node.name,
            referenceDefinitions,
            incompleteKind: readIncompleteMarkdownBlockKind(source),
            ...((node.name === 'BulletList' || node.name === 'OrderedList' || node.name === 'Blockquote') && containsMarkdownCode(node)
                ? { container: readMarkdownContainerBlock(markdown, node, referenceDefinitions) } : null),
            ...(node.name === 'CodeBlock' ? { codeBlock: readMarkdownCodeBlock(markdown, node) } : null),
        });
    }
    return sources;
}
