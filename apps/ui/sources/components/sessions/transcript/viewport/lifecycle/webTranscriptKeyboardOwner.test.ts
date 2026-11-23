// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerWebTranscriptKeyboardOwner } from './webTranscriptKeyboardOwner';

describe('webTranscriptKeyboardOwner', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        ['PageUp', false, 'toward-start'],
        ['ArrowUp', false, 'toward-start'],
        ['Home', false, 'toward-start'],
        [' ', true, 'toward-start'],
        ['PageDown', false, 'toward-end'],
        ['ArrowDown', false, 'toward-end'],
        ['End', false, 'toward-end'],
        [' ', false, 'toward-end'],
        ['Spacebar', false, 'toward-end'],
    ] as const)('classifies %s (shift=%s) as %s before browser movement', (
        key,
        shiftKey,
        expectedDirection,
    ) => {
        const scroller = document.createElement('div');
        document.body.append(scroller);
        const onViewportKeyboardInput = vi.fn();
        const unregister = registerWebTranscriptKeyboardOwner({
            document,
            onViewportKeyboardInput,
            resolveScroller: () => scroller,
        });

        scroller.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key,
            shiftKey,
        }));

        expect(onViewportKeyboardInput).toHaveBeenCalledWith(expectedDirection);
        unregister();
    });

    it('resolves each transcript scroller once per tap, not once per ancestor of the target', () => {
        // resolveScroller reads layout (computed styles). A hidden preloaded chat stays registered,
        // so every tap anywhere in the app pays this cost.
        const scroller = document.createElement('div');
        document.body.append(scroller);
        let target: HTMLElement = document.body;
        for (let depth = 0; depth < 8; depth += 1) {
            const child = document.createElement('div');
            target.append(child);
            target = child;
        }
        const resolveScroller = vi.fn(() => scroller);
        const unregister = registerWebTranscriptKeyboardOwner({
            document,
            onViewportKeyboardInput: vi.fn(),
            resolveScroller,
        });

        target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

        expect(resolveScroller).toHaveBeenCalledTimes(1);
        unregister();
    });
});
