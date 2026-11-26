import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptResponse } from '@agentclientprotocol/sdk';

import type { AgentMessage } from '@/agent/core';

import { AcpBackend, type AcpPromptSubmissionEvidence } from '../AcpBackend';
import { createAcpTestTransportHandler } from '../testkit/subprocessHarness';

type PromptCall = {
  resolve: (response: PromptResponse) => void;
  reject: (error: unknown) => void;
};

const END_TURN: PromptResponse = { stopReason: 'end_turn' };

/** A peer whose prompt RPCs stay open until the test settles them, as with an ACP agent in a long turn. */
function createHarness(options: { steerByPromptHandoff: boolean } = { steerByPromptHandoff: true }) {
  const backend = new AcpBackend({
    agentName: 'test',
    cwd: process.cwd(),
    command: process.execPath,
    args: [],
    transportHandler: createAcpTestTransportHandler({ agentName: 'test', idleTimeoutMs: 1 }),
    steerByPromptHandoff: options.steerByPromptHandoff,
  });
  const calls: PromptCall[] = [];
  const cancel = vi.fn(async () => ({}));
  const internals = backend as unknown as {
    connection: unknown;
    acpSessionId: string | null;
    observeAcpTransportMessageWritten(message: unknown): void;
  };
  internals.acpSessionId = 'test-session';
  internals.connection = {
    peer: {
      prompt: () => new Promise<PromptResponse>((resolve, reject) => {
        calls.push({ resolve, reject });
        internals.observeAcpTransportMessageWritten({
          jsonrpc: '2.0',
          id: calls.length,
          method: 'session/prompt',
          params: { sessionId: 'test-session', prompt: [] },
        });
      }),
      cancel,
    },
    close: () => {},
    closed: Promise.resolve(),
  };
  const emitted: AgentMessage[] = [];
  backend.onMessage((message) => emitted.push(message));
  return { backend, calls, cancel, emitted };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Tracks a promise without turning a pending state into a hung test. */
function track(promise: Promise<unknown>): { state: 'pending' | 'resolved' | 'rejected'; value?: unknown } {
  const tracked: { state: 'pending' | 'resolved' | 'rejected'; value?: unknown } = { state: 'pending' };
  promise.then(
    (value) => { tracked.state = 'resolved'; tracked.value = value; },
    (error) => { tracked.state = 'rejected'; tracked.value = error; },
  );
  return tracked;
}

function confirmation(evidence: AcpPromptSubmissionEvidence): Promise<unknown> {
  if (evidence.kind !== 'effect_may_have_occurred') throw new Error(`unexpected evidence: ${evidence.kind}`);
  return evidence.finalResponseEvidence;
}

describe('AcpBackend steer by prompt handoff', () => {
  const backends: AcpBackend[] = [];
  const start = async (options?: { steerByPromptHandoff: boolean }) => {
    const harness = createHarness(options);
    backends.push(harness.backend);
    await harness.backend.sendPromptWithEvidence('test-session', 'first');
    const turn = track(harness.backend.waitForResponseComplete());
    return { ...harness, turn };
  };

  afterEach(async () => {
    vi.useRealTimers();
    for (const backend of backends.splice(0)) await backend.dispose();
  });

  it('keeps the turn open when the steered prompt ends, and closes it with the prompt that took over', async () => {
    const { backend, calls, turn, emitted } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');

    calls[0].resolve(END_TURN);
    await settle();
    expect(turn.state).toBe('pending');
    expect(emitted).not.toContainEqual(expect.objectContaining({ type: 'status', status: 'idle' }));

    calls[1].resolve(END_TURN);
    await settle();
    expect(turn).toEqual({ state: 'resolved', value: { kind: 'completed', stopReason: 'end_turn' } });
    expect(emitted.filter((message) => message.type === 'status' && message.status === 'idle')).toHaveLength(1);
  });

  it('closes the turn on the first response when handoff is off', async () => {
    const { backend, calls, turn } = await start({ steerByPromptHandoff: false });
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');

    calls[0].resolve(END_TURN);
    await settle();
    expect(turn.state).toBe('resolved');
    calls[1].resolve(END_TURN);
  });

  it('hands the turn on through two steers', async () => {
    const { backend, calls, turn } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction 1');
    calls[0].resolve(END_TURN);
    await settle();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction 2');
    calls[1].resolve(END_TURN);
    await settle();
    expect(turn.state).toBe('pending');

    calls[2].resolve(END_TURN);
    await settle();
    expect(turn.state).toBe('resolved');
  });

  it('confirms a steer when the steered prompt ends, before the turn ends', async () => {
    const { backend, calls, turn } = await start();
    const steer = track(confirmation(await backend.sendSteerPromptWithEvidence('test-session', 'correction')));
    await settle();
    expect(steer.state).toBe('pending');

    calls[0].resolve(END_TURN);
    await settle();
    expect(steer).toEqual({ state: 'resolved', value: { kind: 'accepted_without_exact_final_response' } });
    expect(turn.state).toBe('pending');
    calls[1].resolve(END_TURN);
  });

  it('gives the turn back to the steered prompt when the agent rejects the steer', async () => {
    const { backend, calls, turn, emitted } = await start();
    const steer = track(confirmation(await backend.sendSteerPromptWithEvidence('test-session', 'correction')));

    calls[1].reject(new Error('busy'));
    await settle();
    expect(steer.state).toBe('rejected');
    expect(turn.state).toBe('pending');
    expect(emitted).not.toContainEqual(expect.objectContaining({ type: 'status', status: 'error' }));

    calls[0].resolve(END_TURN);
    await settle();
    expect(turn.state).toBe('resolved');
  });

  it('fails the turn visibly when the steer fails after the steered prompt ended', async () => {
    const { backend, calls, turn, emitted } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');
    calls[0].resolve(END_TURN);
    await settle();

    calls[1].reject(new Error('lost'));
    await settle();
    expect(turn).toMatchObject({ state: 'rejected', value: expect.objectContaining({ message: 'lost' }) });
    expect(emitted).toContainEqual(expect.objectContaining({ type: 'status', status: 'error', detail: 'lost' }));
  });

  it('ignores an error from the steered prompt while the steer is open', async () => {
    const { backend, calls, turn, emitted } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');

    calls[0].reject(new Error('superseded'));
    await settle();
    expect(turn.state).toBe('pending');
    expect(emitted).not.toContainEqual(expect.objectContaining({ type: 'status', status: 'error' }));

    calls[1].resolve(END_TURN);
    await settle();
    expect(turn.state).toBe('resolved');
  });

  it('reports the usage of both prompts', async () => {
    const { backend, calls, emitted } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');
    const usage = (totalTokens: number) => ({
      stopReason: 'end_turn', usage: { totalTokens, inputTokens: totalTokens, outputTokens: 0 },
    }) as PromptResponse;

    calls[0].resolve(usage(10));
    await settle();
    calls[1].resolve(usage(25));
    await settle();
    const totals = emitted.flatMap((message) => message.type === 'token-count'
      ? [(message as unknown as { tokens: { total: number } }).tokens.total]
      : []);
    expect(totals).toEqual([10, 25]);
  });

  it('waits for the prompt that took over when the user stops the turn', async () => {
    const { backend, calls, cancel, turn } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');
    calls[0].resolve(END_TURN);
    await settle();

    const stop = track(backend.cancel('test-session'));
    await settle();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stop.state).toBe('pending');
    expect(turn.state).toBe('rejected');
    await expect(backend.sendPromptWithEvidence('test-session', 'next')).rejects.toMatchObject({
      phase: 'rejected_before_effect',
    });

    calls[1].resolve({ stopReason: 'cancelled' });
    await settle();
    expect(stop.state).toBe('resolved');
    void backend.sendPromptWithEvidence('test-session', 'next').catch(() => {});
    await settle();
    expect(calls).toHaveLength(3);
    calls[2].resolve(END_TURN);
  });

  it('waits for both prompts when the user stops the turn before the handoff', async () => {
    const { backend, calls } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');

    const stop = track(backend.cancel('test-session'));
    calls[1].resolve({ stopReason: 'cancelled' });
    await settle();
    expect(stop.state).toBe('pending');
    calls[0].resolve({ stopReason: 'cancelled' });
    await settle();
    expect(stop.state).toBe('resolved');
  });

  it('rejects a steer before any effect when the turn is closed or is being stopped', async () => {
    const { backend, calls } = await start();
    calls[0].resolve(END_TURN);
    await settle();
    await expect(backend.sendSteerPromptWithEvidence('test-session', 'late')).rejects.toMatchObject({
      phase: 'rejected_before_effect',
    });
    expect(calls).toHaveLength(1);

    await backend.sendPromptWithEvidence('test-session', 'second');
    const stop = backend.cancel('test-session');
    await expect(backend.sendSteerPromptWithEvidence('test-session', 'late')).rejects.toMatchObject({
      phase: 'rejected_before_effect',
    });
    expect(calls).toHaveLength(2);
    calls[1].resolve({ stopReason: 'cancelled' });
    await stop;
  });

  it('opens the steer window only while a prompt of the turn is open', async () => {
    const harness = createHarness();
    backends.push(harness.backend);
    expect(harness.backend.isInFlightSteerOpen()).toBe(false);

    const sent = harness.backend.sendPromptWithEvidence('test-session', 'first');
    expect(harness.backend.isInFlightSteerOpen()).toBe(false);
    await sent;
    expect(harness.backend.isInFlightSteerOpen()).toBe(true);
    await harness.backend.sendSteerPromptWithEvidence('test-session', 'correction');
    harness.calls[0].resolve(END_TURN);
    await settle();
    expect(harness.backend.isInFlightSteerOpen()).toBe(true);
    harness.calls[1].resolve(END_TURN);
    await settle();
    expect(harness.backend.isInFlightSteerOpen()).toBe(false);

    expect(createHarness({ steerByPromptHandoff: false }).backend.isInFlightSteerOpen()).toBe(true);
  });

  it('starts the next turn with a clean owner after a handoff', async () => {
    const { backend, calls } = await start();
    await backend.sendSteerPromptWithEvidence('test-session', 'correction');
    calls[0].resolve(END_TURN);
    calls[1].resolve(END_TURN);
    await settle();

    await backend.sendPromptWithEvidence('test-session', 'second');
    const next = track(backend.waitForResponseComplete());
    await settle();
    expect(next.state).toBe('pending');
    calls[2].resolve(END_TURN);
    await settle();
    expect(next.state).toBe('resolved');
  });
});
