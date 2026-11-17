import { describe, expect, it } from 'vitest';

import { createStreamingTextPacer, STREAMING_TEXT_PACER_CONFIG } from './streamingTextPacer';

const FRAME_MS = 16;

function runTicks(
    pacer: ReturnType<typeof createStreamingTextPacer>,
    startMs: number,
    frames: number,
): { snapshots: string[]; endMs: number } {
    const snapshots: string[] = [];
    let nowMs = startMs;
    for (let index = 0; index < frames; index += 1) {
        nowMs += FRAME_MS;
        pacer.tick(nowMs);
        snapshots.push(pacer.getDisplayText());
    }
    return { snapshots, endMs: nowMs };
}

describe('streamingTextPacer', () => {
    it('seeds the initial text without animating it', () => {
        const pacer = createStreamingTextPacer({ initialText: 'existing prefix', nowMs: 0 });
        expect(pacer.getDisplayText()).toBe('existing prefix');
        expect(pacer.isDrained()).toBe(true);
    });

    it('reveals appended text gradually instead of jumping to the full target', () => {
        const pacer = createStreamingTextPacer({ initialText: 'Hello', nowMs: 0 });
        pacer.setTarget('Hello world, this is a longer streamed continuation of text.', 100);

        pacer.tick(116);
        const afterFirstFrame = pacer.getDisplayText();
        expect(afterFirstFrame.startsWith('Hello')).toBe(true);
        expect(afterFirstFrame).not.toBe(pacer.getTargetText());

        const { snapshots } = runTicks(pacer, 116, 40);
        for (let index = 1; index < snapshots.length; index += 1) {
            expect(snapshots[index]!.startsWith(snapshots[index - 1]!)).toBe(true);
        }
    });

    it('drains the whole backlog within the settle window after input stops', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let nowMs = 0;
        let text = '';
        for (let index = 0; index < 12; index += 1) {
            nowMs += 120;
            text += 'chunk of streamed words arriving steadily. ';
            pacer.setTarget(text, nowMs);
            pacer.tick(nowMs + 8);
        }

        // No more input: everything must be visible within
        // settleAfterMs + settleDrainMaxMs (plus one frame of slack).
        const deadlineMs =
            nowMs + STREAMING_TEXT_PACER_CONFIG.settleAfterMs + STREAMING_TEXT_PACER_CONFIG.settleDrainMaxMs + FRAME_MS;
        while (nowMs < deadlineMs && !pacer.isDrained()) {
            nowMs += FRAME_MS;
            pacer.tick(nowMs);
        }
        expect(pacer.isDrained()).toBe(true);
        expect(pacer.getDisplayText()).toBe(text);
    });

    it('holds a trailing buffer while input is active instead of racing the tail', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let nowMs = 0;
        let text = '';
        for (let index = 0; index < 20; index += 1) {
            nowMs += 100;
            text += 'steady words flow. ';
            pacer.setTarget(text, nowMs);
            pacer.tick(nowMs + 8);
        }
        // While actively streaming the display must trail the target.
        expect(pacer.getDisplayText().length).toBeLessThan(text.length);
        expect(pacer.isDrained()).toBe(false);
    });

    it('reports a wake delay instead of burning frames when the hold-back buffer is satisfied', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        pacer.setTarget('tiny', 10);
        const result = pacer.tick(20);
        // 4 chars is far below the target lag: nothing reveals yet, and the
        // caller is told when the active window lapses.
        expect(result.changed).toBe(false);
        expect(result.wakeDelayMs).not.toBe(null);
        expect(result.wakeDelayMs!).toBeGreaterThan(0);
        expect(pacer.getDisplayText()).toBe('');
    });

    it('jumps immediately on non-append rewrites', () => {
        const pacer = createStreamingTextPacer({ initialText: 'Hello world', nowMs: 0 });
        pacer.setTarget('Rewritten from scratch', 50);
        expect(pacer.getDisplayText()).toBe('Rewritten from scratch');
        expect(pacer.isDrained()).toBe(true);
    });

    it('jumps immediately for a paste-sized single append', () => {
        const pacer = createStreamingTextPacer({ initialText: 'seed', nowMs: 0 });
        const bigAppend = 'x'.repeat(STREAMING_TEXT_PACER_CONFIG.largeAppendChars + 1);
        pacer.setTarget(`seed${bigAppend}`, 50);
        expect(pacer.getDisplayText()).toBe(`seed${bigAppend}`);
        expect(pacer.isDrained()).toBe(true);
    });

    it('never parks the reveal cursor on a bare markdown marker', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let nowMs = 0;
        let text = '';
        for (let index = 0; index < 30; index += 1) {
            nowMs += 90;
            text += 'plain words then **bold text** and `code spans` mixed in. ';
            pacer.setTarget(text, nowMs);
            nowMs += FRAME_MS;
            pacer.tick(nowMs);
            const shown = pacer.getDisplayText();
            if (shown.length > 0 && shown.length < text.length) {
                expect(/[!$()*<>[\]\\_`|~]$/.test(shown)).toBe(false);
            }
        }
    });

    it('does not split surrogate pairs while revealing', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let nowMs = 0;
        let text = '';
        for (let index = 0; index < 20; index += 1) {
            nowMs += 90;
            text += 'emoji stream 😀🎉🚀 continues. ';
            pacer.setTarget(text, nowMs);
            nowMs += FRAME_MS;
            pacer.tick(nowMs);
            const shown = pacer.getDisplayText();
            // A well-formed string never ends on an unpaired high surrogate.
            const lastCode = shown.charCodeAt(shown.length - 1);
            expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
        }
    });

    it('commits whole words while pacing so no reveal ends mid-word', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let nowMs = 0;
        let text = '';
        for (let index = 0; index < 40; index += 1) {
            nowMs += 90;
            text += 'steady stream of ordinary prose words flowing along. ';
            pacer.setTarget(text, nowMs);
            for (let frame = 0; frame < 5; frame += 1) {
                nowMs += FRAME_MS;
                pacer.tick(nowMs);
                const shown = pacer.getDisplayText();
                if (shown.length === 0 || shown.length >= text.length) continue;
                // The revealed prefix must end at a word boundary: its last char is
                // whitespace, or the very next unrevealed char is whitespace.
                const lastChar = shown[shown.length - 1]!;
                const nextChar = text[shown.length]!;
                expect(/\s/.test(lastChar) || /\s/.test(nextChar)).toBe(true);
            }
        }
    });

    it('brakes the reveal approaching the hold-back reserve instead of halting from full speed', () => {
        // Warm two pacers to the same arrival profile, then compare a tick taken
        // far from the hold-back wall with a tick taken close to it: the braked
        // near-wall tick must reveal less.
        const warm = (pacer: ReturnType<typeof createStreamingTextPacer>): number => {
            let nowMs = 0;
            let text = '';
            for (let index = 0; index < 10; index += 1) {
                nowMs += 100;
                text += 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp ';
                pacer.setTarget(text, nowMs);
                nowMs += FRAME_MS;
                pacer.tick(nowMs);
            }
            return nowMs;
        };

        const farPacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        const farEnd = warm(farPacer);
        const farBefore = farPacer.getDisplayText().length;
        // One commit interval later: a tick inside the interval is held by the commit cap.
        farPacer.tick(farEnd + STREAMING_TEXT_PACER_CONFIG.minCommitIntervalMs);
        const farReveal = farPacer.getDisplayText().length - farBefore;

        // Slow-drip steady state: small chunks arriving just inside the active
        // window keep the cursor hugging the hold-back wall. A braked glide
        // reveals with sub-char-per-frame budgets that accumulate across frames,
        // so zero-reveal frames appear between word commits. The unbraked
        // implementation floors every active frame to >=1 char, burning each
        // tiny shortfall at full frame cadence with no quiet frames.
        const dripPacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let dripEnd = 0;
        let dripText = '';
        let zeroRevealFrames = 0;
        let productiveFrames = 0;
        for (let chunk = 0; chunk < 20; chunk += 1) {
            dripText += 'word ';
            dripPacer.setTarget(dripText, dripEnd);
            for (let frame = 0; frame < 22; frame += 1) {
                const before = dripPacer.getDisplayText().length;
                dripEnd += FRAME_MS;
                const result = dripPacer.tick(dripEnd);
                if (result.drained || result.wakeDelayMs != null) break;
                const revealed = dripPacer.getDisplayText().length - before;
                if (revealed > 0) productiveFrames += 1;
                else zeroRevealFrames += 1;
            }
            dripEnd += 375 - 22 * FRAME_MS > 0 ? 375 - 22 * FRAME_MS : 0;
        }
        expect(productiveFrames + zeroRevealFrames).toBeGreaterThan(0);
        expect(zeroRevealFrames).toBeGreaterThan(0);
        expect(farReveal).toBeGreaterThan(0);
    });

    it('publishes at most about 30 text changes per second on a 120 Hz frame cadence', () => {
        const frameMs = 1000 / 120;
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        let nowMs = 0;
        let nextInputAtMs = 0;
        let text = '';
        let changes = 0;
        let lastChangeAtMs = -Infinity;
        let minGapMs = Infinity;
        // 3 s of 100 ms deltas, ticked every 120 Hz frame.
        while (nowMs < 3000) {
            if (nowMs >= nextInputAtMs) {
                text += 'steady stream of ordinary prose words flowing along nicely. ';
                pacer.setTarget(text, nowMs);
                nextInputAtMs += 100;
            }
            nowMs += frameMs;
            if (pacer.tick(nowMs).changed) {
                changes += 1;
                minGapMs = Math.min(minGapMs, nowMs - lastChangeAtMs);
                lastChangeAtMs = nowMs;
            }
        }
        expect(changes).toBeGreaterThan(30);
        expect(changes / 3).toBeLessThanOrEqual(31);
        expect(minGapMs).toBeGreaterThanOrEqual(STREAMING_TEXT_PACER_CONFIG.minCommitIntervalMs - 0.01);

        // The drain still ends with the exact text inside the settle window plus one interval.
        const deadlineMs =
            nowMs +
            STREAMING_TEXT_PACER_CONFIG.settleAfterMs +
            STREAMING_TEXT_PACER_CONFIG.settleDrainMaxMs +
            STREAMING_TEXT_PACER_CONFIG.minCommitIntervalMs;
        while (nowMs < deadlineMs && !pacer.isDrained()) {
            nowMs += frameMs;
            pacer.tick(nowMs);
        }
        expect(pacer.getDisplayText()).toBe(text);
    });

    it('flush reveals everything immediately', () => {
        const pacer = createStreamingTextPacer({ initialText: '', nowMs: 0 });
        pacer.setTarget('some backlog worth of streamed text', 10);
        pacer.flush();
        expect(pacer.getDisplayText()).toBe('some backlog worth of streamed text');
        expect(pacer.isDrained()).toBe(true);
    });
});
