import { describe, expect, it } from 'vitest';
import { parser, GFM } from '@lezer/markdown';
import type { Tree } from '@lezer/common';

import {
    parseMarkdownBlockTree,
    readMarkdownBlockSources,
    splitMarkdownIntoBlockSources,
} from './splitMarkdownIntoBlockSources';

const fullParser = parser.configure(GFM);

function dumpTree(tree: Tree): string {
    const parts: string[] = [];
    tree.iterate({ enter(node) { parts.push(`${node.name}:${node.from}-${node.to}`); } });
    return parts.join(' ');
}

/** Every Tree and TreeBuffer object in a tree; lezer shares these objects when it reuses a block. */
function collectSubtrees(tree: Tree): Set<object> {
    const found = new Set<object>();
    const walk = (node: object) => {
        found.add(node);
        for (const child of (node as { children?: readonly object[] }).children ?? []) walk(child);
    };
    walk(tree);
    return found;
}

const TEXTS: Record<string, string> = {
    mixed: [
        'Here is the plan for **the change**, with `code` and a [link](https://example.com).',
        '',
        'Heading that becomes setext',
        '===========================',
        '',
        '- first item',
        '- second item with *emphasis*',
        '',
        '- third item makes the list loose',
        '  continuation line',
        '  1. nested ordered',
        '  2. nested again',
        '',
        '> A quote with [ref text][ref]',
        '> and a second line',
        '>',
        '> [quoted]: https://quoted.example.com',
        '',
        '```ts',
        'const value = 1;',
        '',
        'function run() { return value; }',
        '```',
        '',
        '| Name | Value |',
        '| ---- | ----- |',
        '| a    | 1     |',
        '| b    | 2     |',
        '',
        'Text after the table, then a definition that comes late.',
        '',
        '[ref]: https://late.example.com "Late"',
        '',
        '    indented code block',
        '    second line',
        '',
        'Last paragraph with ~~strike~~ and a task list:',
        '',
        '- [ ] open task',
        '- [x] done task',
    ].join('\n'),
    fences: [
        'Intro text.',
        '',
        '~~~',
        'unclosed tilde fence',
        '~~~',
        '',
        '```',
        'a fence that opens',
        '````',
        'still inside',
        '```',
        '',
        '## ATX heading ##',
        '',
        '<details>',
        '<summary>HTML block</summary>',
        '</details>',
        '',
        'Paragraph',
        '---',
        '',
        '***',
        '',
        '1) ordered with paren',
        '2) second',
    ].join('\n'),
};

describe('splitMarkdownIntoBlockSources incremental parse', () => {
    for (const [name, text] of Object.entries(TEXTS)) {
        it(`matches a full parse on every growing prefix (${name})`, () => {
            let step = 1;
            for (let end = 0; end <= text.length; end += step) {
                const prefix = text.slice(0, end);
                const fullTree = fullParser.parse(prefix);
                const tree = parseMarkdownBlockTree(prefix);
                expect(dumpTree(tree), `tree at ${end}`).toBe(dumpTree(fullTree));
                expect(splitMarkdownIntoBlockSources(prefix), `sources at ${end}`)
                    .toEqual(readMarkdownBlockSources(prefix, fullTree));
                step = (step % 7) + 1;
            }
        });
    }

    it('matches a full parse when a streaming repair suffix changes between updates', () => {
        const base = TEXTS.mixed!;
        const cut = base.indexOf('function run');
        // The prepared markdown closes an open fence; the next update replaces that repair.
        const updates = [
            `${base.slice(0, cut)}\n\`\`\``,
            `${base.slice(0, cut + 10)}\n\`\`\``,
            base.slice(0, cut + 40),
            base,
        ];
        for (const update of updates) {
            expect(dumpTree(parseMarkdownBlockTree(update))).toBe(dumpTree(fullParser.parse(update)));
        }
    });

    it('reuses earlier block subtrees when the markdown grows', () => {
        const text = TEXTS.mixed!;
        const before = parseMarkdownBlockTree(text.slice(0, text.length - 20));
        const after = parseMarkdownBlockTree(text);
        const beforeNodes = collectSubtrees(before);
        const afterNodes = [...collectSubtrees(after)];
        const shared = afterNodes.filter((node) => beforeNodes.has(node)).length;
        expect(shared / afterNodes.length).toBeGreaterThan(0.5);
    });

    it('collects reference definitions from quotes and list items, but not from code', () => {
        const markdown = [
            '[top]: https://top.example.com',
            '',
            '> [quoted]: https://quoted.example.com',
            '',
            '- item',
            '',
            '  [listed]: https://listed.example.com',
            '',
            '```',
            '[fenced]: https://fenced.example.com',
            '```',
        ].join('\n');
        const [first] = splitMarkdownIntoBlockSources(markdown);
        expect(first?.referenceDefinitions).toBe([
            '[top]: https://top.example.com',
            '[quoted]: https://quoted.example.com',
            '[listed]: https://listed.example.com',
        ].join('\n'));
    });
});
