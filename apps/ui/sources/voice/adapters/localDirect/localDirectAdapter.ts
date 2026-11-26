import {
  abortLocalVoiceTurn,
  getLocalVoiceState,
  shouldHoldLocalVoiceCallWhileIdle,
  subscribeLocalVoiceState,
  stopLocalVoiceSession,
  toggleLocalVoiceTurn,
} from '@/voice/local/localVoiceEngine';
import type { VoiceAdapterController, VoiceSessionMode, VoiceSessionSnapshot, VoiceSessionStatus } from '@/voice/session/types';

function mapLocalStatus(status: any): { status: VoiceSessionStatus; mode: VoiceSessionMode } {
  switch (status) {
    case 'recording':
      return { status: 'connected', mode: 'listening' };
    case 'transcribing':
      return { status: 'connected', mode: 'transcribing' };
    case 'sending':
      return { status: 'connected', mode: 'thinking' };
    case 'speaking':
      return { status: 'connected', mode: 'speaking' };
    case 'error':
      return { status: 'error', mode: 'idle' };
    case 'idle':
    default:
      return { status: 'disconnected', mode: 'idle' };
  }
}

export function createLocalDirectVoiceAdapter(): VoiceAdapterController {
  const id = 'local_direct';

  const getSnapshot = (): VoiceSessionSnapshot => {
    const local = getLocalVoiceState();
    const mapped = (() => {
      // Local voice keeps the sessionId set while the "call" is active, even when idle. Hands-free
      // keeps listening between turns, so that is a real call; a dictation-mode call is not. The
      // engine owns that decision, which keeps this adapter free of the settings graph.
      if (local.status === 'idle' && local.sessionId) {
        return shouldHoldLocalVoiceCallWhileIdle()
          ? { status: 'connected' as const, mode: 'idle' as const }
          : mapLocalStatus(local.status);
      }
      return mapLocalStatus(local.status);
    })();
    return {
      adapterId: id,
      sessionId: local.sessionId,
      status: mapped.status,
      mode: mapped.mode,
      canStop: mapped.status !== 'disconnected',
      ...(local.error ? { errorCode: local.error, errorMessage: local.errorMessage ?? local.error } : {}),
    };
  };

  const toggle = async (opts: Readonly<{ sessionId: string }>) => {
    const snap = getSnapshot();
    if (snap.sessionId && snap.sessionId !== opts.sessionId && snap.status !== 'disconnected') {
      await stopLocalVoiceSession();
    }
    await toggleLocalVoiceTurn(opts.sessionId);
  };

  const start = async (opts: Readonly<{ sessionId: string; initialContext?: string }>) => {
    const snap = getSnapshot();
    if (snap.status !== 'disconnected') return;
    await toggle({ sessionId: opts.sessionId });
  };

  const stop = async (_opts: Readonly<{ sessionId: string }>) => {
    await stopLocalVoiceSession();
  };

  const interrupt = async (opts: Readonly<{ sessionId: string }>) => {
    await abortLocalVoiceTurn(opts.sessionId);
  };

  return {
    id,
    start,
    stop,
    toggle,
    interrupt,
    sendContextUpdate: () => {},
    getSnapshot,
    subscribe: (listener) => subscribeLocalVoiceState(listener),
  };
}
