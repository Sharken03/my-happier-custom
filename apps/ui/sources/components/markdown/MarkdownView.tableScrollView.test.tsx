import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { findNearestHostParent, flattenTestStyle } from '@/dev/testkit/harness/popoverHarness';
import { installMarkdownCommonModuleMocks } from './markdownTestHelpers';


declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const modalShowSpy = vi.hoisted(() => vi.fn((_config: unknown) => 'table-viewer'));
const layoutEstimates = vi.hoisted(() => ({ count: 0 }));

installMarkdownCommonModuleMocks({
    storage: () => vi.importActual('@/sync/domains/state/storage'),
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { show: modalShowSpy as never } }).module;
    },
});

// Counts width computations; the real estimator still runs underneath.
vi.mock('./table/estimateMarkdownTableLayout', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./table/estimateMarkdownTableLayout')>();
    return {
        ...actual,
        estimateMarkdownTableLayout: (input: Parameters<typeof actual.estimateMarkdownTableLayout>[0]) => {
            layoutEstimates.count += 1;
            return actual.estimateMarkdownTableLayout(input);
        },
    };
});

const setStringAsyncSpy = vi.fn<(text: string) => Promise<boolean>>(async (_text) => true);

// expo-clipboard is a native module boundary; the spy records what reaches the system clipboard.
vi.mock('expo-clipboard', () => ({
    setStringAsync: (text: string) => setStringAsyncSpy(text),
}));

function mockPlatform(os: 'android' | 'ios' | 'web') {
    vi.doMock('react-native', async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: os,
            },
        });
    });
}

describe('MarkdownView (tables)', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('renders tables inside the platform ScrollView on Android so horizontal drags share native nested scrolling with the transcript list', async () => {
        mockPlatform('android');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| A | B | C |',
            '|---|---|---|',
            '| 1 | 2 | 3 |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} />);

        expect(screen.findAllByType('GestureHandlerScrollView' as any)).toHaveLength(0);
        const scrollViews = screen.findAllByType('ScrollView' as any);
        expect(scrollViews).toHaveLength(1);
        expect(scrollViews[0]!.props.horizontal).toBe(true);
        expect(scrollViews[0]!.props.nestedScrollEnabled).toBe(true);
    }, 60_000);

    it('uses a visible horizontal scrollbar on web and does not clip the scroll shell', async () => {
        mockPlatform('web');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Name | Reliability | Notes |',
            '|---|---|---|',
            '| Claude | High | Long cell content that exceeds the viewport width |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} />);

        const scrollViews = screen.findAllByType('ScrollView' as any);
        expect(scrollViews).toHaveLength(1);
        expect(scrollViews[0]!.props.horizontal).toBe(true);
        expect(scrollViews[0]!.props.showsHorizontalScrollIndicator).toBe(true);

        // The frame sits above the fade viewport that wraps the scroller.
        const scrollShell = findNearestHostParent(findNearestHostParent(scrollViews[0]));
        expect(scrollShell).toBeTruthy();
        const shellStyle = flattenTestStyle(scrollShell?.props?.style);
        expect(shellStyle.alignSelf).toBe('flex-start');
        expect(shellStyle.maxWidth).toBe('100%');
    }, 60_000);

    it('keeps table text selectable on every platform, including inside the Android horizontal scroller', async () => {
        const markdown = [
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |',
        ].join('\n');

        for (const os of ['ios', 'android', 'web'] as const) {
            vi.resetModules();
            mockPlatform(os);
            const { MarkdownView } = await import('./MarkdownView');

            const screen = await renderScreen(<MarkdownView markdown={markdown} />);

            const findTextNode = (text: string) =>
                screen.findAllByType('Text' as any).find((n) => n.props?.children === text)!;

            expect(findTextNode('A').props.selectable, os).toBe(true);
            expect(findTextNode('1').props.selectable, os).toBe(true);
        }
    }, 60_000);

    it('lets formatted table cells be selected on web instead of writing user-select: none on their spans', async () => {
        mockPlatform('web');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Rum | Tid |',
            '|---|---|',
            '| **Stue** | `26,5 %` |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} selectable profile="transcript" />);

        const findTextNode = (text: string) =>
            screen.findAllByType('Text' as any).find((n) => n.props?.children === text)!;

        // The cell root stays selectable; the formatted spans inherit it (no explicit `selectable`
        // prop) instead of opting out, which react-native-web would render as `user-select: none`.
        expect(findTextNode('Stue').props.selectable).toBeUndefined();
        expect(findTextNode('26,5 %').props.selectable).toBeUndefined();
    }, 60_000);

    it('keeps formatted table cell spans non-selectable on native, where a selectable nested Text breaks the parent', async () => {
        mockPlatform('android');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Rum | Tid |',
            '|---|---|',
            '| **Stue** | plain |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} selectable profile="transcript" />);

        const findTextNode = (text: string) =>
            screen.findAllByType('Text' as any).find((n) => n.props?.children === text)!;

        expect(findTextNode('Stue').props.selectable).toBe(false);
    }, 60_000);

    it('does not make table cells selectable when the message is copy-only', async () => {
        mockPlatform('web');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Rum | Tid |',
            '|---|---|',
            '| **Stue** | plain |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} selectable={false} />);

        const findTextNode = (text: string) =>
            screen.findAllByType('Text' as any).find((n) => n.props?.children === text)!;

        // Nothing opts into selection; the formatted span inherits the copy-only root's value.
        expect(screen.findAllByType('Text' as any).some((n) => n.props?.selectable === true)).toBe(false);
        expect(findTextNode('plain').props.selectable).toBe(false);
        // The formatted span inherits the copy-only root instead of forcing a value.
        expect(findTextNode('Stue').props.selectable).toBeUndefined();
    }, 60_000);

    it('copies the table as markdown from its copy button, preserving alignment, escaped pipes and the rendered column count', async () => {
        mockPlatform('android');
        setStringAsyncSpy.mockClear();
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Left | Center | Right | Plain |',
            '| :--- | :---: | ---: | --- |',
            '| **a** | b \\| c | d |  |',
            '| short |',
            '| 1 | 2 | 3 | 4 | ignored |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} />);

        await pressTestInstanceAsync(screen.findByTestId('markdown-table-copy'), 'table copy');

        expect(setStringAsyncSpy).toHaveBeenCalledWith([
            '| Left | Center | Right | Plain |',
            '| :--- | :---: | ---: | --- |',
            '| **a** | b \\| c | d |  |',
            '| short |  |  |  |',
            '| 1 | 2 | 3 | 4 |',
        ].join('\n'));
    }, 60_000);

    it('renders bold and code inside a table cell instead of showing the markers', async () => {
        mockPlatform('android');
        const { MarkdownView } = await import('./MarkdownView');

        const screen = await renderScreen(
            <MarkdownView markdown={['| Rum | Tid |', '|---|---|', '| **Stue** | `26,5 %` (plain) |'].join('\n')} selectable profile="transcript" />,
        );

        const text = screen.getTextContent();
        expect(text).toContain('Stue');
        expect(text).toContain('26,5 %');
        expect(text).not.toContain('**');
        expect(text).not.toContain('`');
    }, 60_000);

    it('renders math table cells through the enriched renderer without losing horizontal scrolling', async () => {
        mockPlatform('android');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Formula | Existing | Plain |',
            '|---|---|---|',
            '| \\(x_i\\) | $y_i$ | value |',
        ].join('\n');

        const screen = await renderScreen(
            <MarkdownView markdown={markdown} selectable profile="transcript" agentTexMath />,
        );

        expect(screen.findAllByType('ScrollView' as any)).toHaveLength(1);
        expect(screen.findAllByType('EnrichedMarkdownText').map((node) => node.props.selectable)).toEqual([true, true]);
        expect(screen.findAllByType('EnrichedMarkdownText').map((node) => node.props.markdown)).toEqual([
            '\\(x_i\\)',
            '$y_i$',
        ]);
        expect(screen.findAllByType('EnrichedMarkdownText').map((node) => node.props.md4cFlags)).toEqual([
            { latexMath: true, texMathBackslashDelimiters: true },
            { latexMath: true, texMathBackslashDelimiters: true },
        ]);
        expect(screen.findAllByType('Text' as any).some((node) => node.props.children === 'value')).toBe(true);
    }, 60_000);

    it('applies GitHub table column alignment to header and body cells', async () => {
        mockPlatform('web');
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Left | Center | Right |',
            '| :--- | :---: | ---: |',
            '| Alpha | Bravo | Charlie |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} />);

        const findTextNode = (text: string) =>
            screen.findAllByType('Text' as any).find((n) => n.props?.children === text)!;

        expect(flattenTestStyle(findTextNode('Alpha').props.style).textAlign).toBe('left');
        expect(flattenTestStyle(findTextNode('Bravo').props.style).textAlign).toBe('center');
        expect(flattenTestStyle(findTextNode('Charlie').props.style).textAlign).toBe('right');

        const rightCell = findNearestHostParent(findTextNode('Charlie'), 'View');
        expect(flattenTestStyle(rightCell?.props?.style).alignItems).toBe('flex-end');
    }, 60_000);
    it('lays tables out row by row: cells of a column share one width rule, prose columns may wrap to a floor, and the table scrolls only below the summed floors', async () => {
        mockPlatform('web');
        const { MarkdownView } = await import('./MarkdownView');

        const prose = 'A long explanation that cannot fit on one line of a phone screen and has to wrap inside its cell';
        const markdown = [
            '| Id | Notes |',
            '|---|---|',
            `| 1 | ${prose} |`,
            '| 22 | short |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} />);
        const cellStyle = (text: string) => {
            const textNode = screen.findAllByType('Text' as any).find((n) => n.props?.children === text)!;
            return flattenTestStyle(findNearestHostParent(textNode, 'View')?.props?.style);
        };

        const idHeader = cellStyle('Id');
        const idCell = cellStyle('22');
        const notesHeader = cellStyle('Notes');
        const notesCell = cellStyle(prose);
        expect(idCell.flexBasis).toBe(idHeader.flexBasis);
        expect(idCell.minWidth).toBe(idHeader.minWidth);
        expect(notesCell.flexBasis).toBe(notesHeader.flexBasis);
        expect(notesCell.minWidth).toBe(notesHeader.minWidth);
        // Short column never shrinks; prose column shrinks down to its floor.
        expect(idCell.flexShrink).toBe(0);
        expect(idCell.minWidth).toBe(idCell.flexBasis);
        expect(notesCell.flexShrink as number).toBeGreaterThan(0);
        expect(notesCell.minWidth as number).toBeLessThan(notesCell.flexBasis as number);

        const scrollView = screen.findAllByType('ScrollView' as any)[0]!;
        const contentStyle = flattenTestStyle(scrollView.props.contentContainerStyle);
        expect(contentStyle.width).toBe('100%');
        expect(contentStyle.minWidth).toBe((idCell.minWidth as number) + (notesCell.minWidth as number));

        const frameStyle = flattenTestStyle(findNearestHostParent(findNearestHostParent(scrollView))?.props?.style);
        expect(frameStyle.maxWidth).toBe('100%');
        expect(frameStyle.width as number).toBeGreaterThanOrEqual((idCell.flexBasis as number) + (notesCell.flexBasis as number));
    }, 60_000);

    it('copies the table as CSV, quoting cells that contain commas, quotes or line breaks', async () => {
        mockPlatform('android');
        setStringAsyncSpy.mockClear();
        const { MarkdownView } = await import('./MarkdownView');

        const markdown = [
            '| Name | Note | Plain |',
            '| :--- | :---: | --- |',
            '| a, b | say "hi" | x \\| y |',
            '| short |',
        ].join('\n');

        const screen = await renderScreen(<MarkdownView markdown={markdown} />);
        expect(setStringAsyncSpy).not.toHaveBeenCalled();

        await pressTestInstanceAsync(screen.findByTestId('markdown-table-copy-csv'), 'table copy csv');

        expect(setStringAsyncSpy).toHaveBeenCalledTimes(1);
        expect(setStringAsyncSpy).toHaveBeenCalledWith([
            'Name,Note,Plain',
            '"a, b","say ""hi""",x | y',
            'short,,',
        ].join('\n'));
    }, 60_000);

    it('mounts no viewer while closed and opens the full table in the app modal on demand', async () => {
        mockPlatform('ios');
        modalShowSpy.mockClear();
        const { MarkdownView } = await import('./MarkdownView');
        const { MarkdownTableViewerModal } = await import('./table/MarkdownTableViewerModal');

        const markdown = ['| A | B |', '| :--- | ---: |', '| 1 | 2 |'].join('\n');
        const screen = await renderScreen(<MarkdownView markdown={markdown} selectable />);

        expect(screen.findAllByType(MarkdownTableViewerModal as any)).toHaveLength(0);
        expect(modalShowSpy).not.toHaveBeenCalled();

        await pressTestInstanceAsync(screen.findByTestId('markdown-table-open'), 'open table');

        expect(modalShowSpy).toHaveBeenCalledTimes(1);
        const config = modalShowSpy.mock.calls[0]![0] as { component: unknown; props: Record<string, unknown> };
        expect(config.component).toBe(MarkdownTableViewerModal);
        expect(config.props).toMatchObject({
            headers: ['A', 'B'],
            rows: [['1', '2']],
            alignments: ['left', 'right'],
            selectable: true,
        });
    }, 60_000);

    it('computes column widths once per table content: equal re-renders, later streamed text and earlier tables cost nothing', async () => {
        mockPlatform('web');
        const { MarkdownView } = await import('./MarkdownView');

        const firstTable = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
        const render = (markdown: string) => <MarkdownView markdown={markdown} streamingMode="streaming" />;

        layoutEstimates.count = 0;
        const screen = await renderScreen(render(`${firstTable}\n\nAfter`));
        expect(layoutEstimates.count).toBe(1);
        const tableScrollProps = screen.findByTestId('markdown-table-scroll')!.props;

        await act(async () => {
            await screen.update(render(`${firstTable}\n\nAfter`));
        });
        expect(layoutEstimates.count).toBe(1);

        await act(async () => {
            await screen.update(render(`${firstTable}\n\nAfter the table, more streamed prose`));
        });
        expect(layoutEstimates.count).toBe(1);
        // The finished table did not re-render.
        expect(screen.findByTestId('markdown-table-scroll')!.props).toBe(tableScrollProps);

        const streamingTable = ['| X | Y |', '|---|---|', '| 3 |'].join('\n');
        await act(async () => {
            await screen.update(render(`${firstTable}\n\nAfter the table, more streamed prose\n\n${streamingTable}`));
        });
        expect(layoutEstimates.count).toBe(2);

        await act(async () => {
            await screen.update(render(`${firstTable}\n\nAfter the table, more streamed prose\n\n${streamingTable} 4 |`));
        });
        expect(layoutEstimates.count).toBe(3);
    }, 60_000);
});
