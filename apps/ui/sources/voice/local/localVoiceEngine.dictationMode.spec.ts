import { describe, expect, it } from 'vitest';

import {
    emitSpeechRecEvent,
    getStorage,
    registerLocalVoiceEngineHarnessHooks,
    submitMessage,
    speechRecStop,
} from './localVoiceEngine.testHarness';

const waitForCallCount = async (spy: { mock: { calls: unknown[][] } }, expectedCount: number, timeoutMs = 2000, pollMs = 5) => {
    const deadline = Date.now() + timeoutMs;
    while (spy.mock.calls.length < expectedCount) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${expectedCount} calls; saw ${spy.mock.calls.length}`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

/**
 * A tap that arrives while a voice turn is starting, transcribing or waiting for its reply used to
 * return silently, which left the composer's stop control dead. Dictation mode reads that tap as
 * "cancel this turn"; every other mode keeps upstream behaviour and leaves cancellation to the
 * voice surface.
 */
async function configureDictationMode(dictationMode: boolean | undefined): Promise<void> {
    const storage = await getStorage();
    const voice = storage.getState().settings.voice;
    const localDirect = voice.adapters.local_direct;
    storage.__setState({
        settings: {
            ...storage.getState().settings,
            voice: {
                ...voice,
                providerId: 'local_direct',
                adapters: {
                    ...voice.adapters,
                    local_direct: {
                        ...localDirect,
                        ...(dictationMode === undefined ? {} : { dictationMode }),
                        stt: { ...localDirect.stt, useDeviceStt: true, baseUrl: null },
                        tts: { ...localDirect.tts, autoSpeakReplies: false },
                    },
                },
            },
        },
    });
}

describe('local voice engine dictation mode', () => {
    registerLocalVoiceEngineHarnessHooks();

    it('cancels an in-flight turn when the mic is tapped while dictation mode is on', async () => {
        await configureDictationMode(true);
        const { toggleLocalVoiceTurn, getLocalVoiceState } = await import('./localVoiceEngine');

        await toggleLocalVoiceTurn('s1');
        expect(getLocalVoiceState().status).toBe('recording');

        // Keep the dispatched turn in flight: a resolved send would end the turn before the tap.
        const sending = deferred<void>();
        submitMessage.mockImplementation(() => sending.promise);

        emitSpeechRecEvent('result', {
            isFinal: true,
            results: [{ transcript: 'dictated but cancelled', confidence: 0.9, segments: [] }],
        });

        // This tap stops the recognizer and dispatches the turn.
        const dispatching = toggleLocalVoiceTurn('s1');
        await waitForCallCount(speechRecStop, 1);
        emitSpeechRecEvent('end', {});
        await waitForCallCount(submitMessage, 1);
        expect(getLocalVoiceState().status).not.toBe('recording');

        // The next tap arrives while that turn is still running and must cancel it.
        await toggleLocalVoiceTurn('s1');

        expect(getLocalVoiceState().status).toBe('idle');
        expect(submitMessage).toHaveBeenCalledTimes(1);

        sending.resolve();
        await dispatching;
    });

    it('leaves the tap to the voice surface when dictation mode is off', async () => {
        await configureDictationMode(false);
        const { toggleLocalVoiceTurn, getLocalVoiceState } = await import('./localVoiceEngine');

        await toggleLocalVoiceTurn('s1');
        expect(getLocalVoiceState().status).toBe('recording');

        const sending = deferred<void>();
        submitMessage.mockImplementation(() => sending.promise);

        emitSpeechRecEvent('result', {
            isFinal: true,
            results: [{ transcript: 'dictated while mode is off', confidence: 0.9, segments: [] }],
        });

        const dispatching = toggleLocalVoiceTurn('s1');
        await waitForCallCount(speechRecStop, 1);
        emitSpeechRecEvent('end', {});
        await waitForCallCount(submitMessage, 1);

        const statusDuringTurn = getLocalVoiceState().status;
        expect(statusDuringTurn).not.toBe('recording');

        // Upstream behaviour: the tap is swallowed while a turn runs — no cancellation, no new input.
        await toggleLocalVoiceTurn('s1');

        expect(getLocalVoiceState().status).toBe(statusDuringTurn);
        expect(speechRecStop.mock.calls.length).toBe(1);
        expect(submitMessage).toHaveBeenCalledTimes(1);

        sending.resolve();
        await dispatching;
    });
});
