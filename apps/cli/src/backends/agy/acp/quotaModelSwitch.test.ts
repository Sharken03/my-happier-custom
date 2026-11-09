import { describe, expect, it } from 'vitest';

import { createAgyQuotaGuard, decideAgyQuotaModelSwitch, parseAgyQuota } from './quotaModelSwitch';

const MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
];
// `agy -p /quota` of agy 1.5.3: tab-separated rows.
const QUOTA = 'Gemini Models\tWeekly Limit Remaining\t0%\t2026-11-14T07:03:41Z\nClaude and GPT models\tWeekly Limit Remaining\t40%\t2026-11-11T11:51:49Z\n';

describe('agy quota model switch', () => {
  it('reads both groups of the quota output', () => {
    expect(parseAgyQuota(QUOTA)).toEqual({ gemini: 0, others: 40, geminiReset: '2026-11-14T07:03:41Z', othersReset: '2026-11-11T11:51:49Z' });
    expect(parseAgyQuota('nothing')).toBeNull();
  });

  it("switches to the other group's model when the chosen group is used up and the other is not", () => {
    const decision = decideAgyQuotaModelSwitch({
      modelState: { currentModelId: 'gemini-3.8-flash', availableModels: MODELS },
      quota: parseAgyQuota(QUOTA),
      now: new Date(2026, 10, 9, 18, 0).getTime(),
    });
    expect(decision?.modelId).toBe('claude-sonnet-4-6');
    expect(decision?.notice).toMatch(/^Antigravity quota for the Gemini models is used up until .+\. Switched to Claude Sonnet 4\.6 \(Thinking\)\.$/);
  });

  it('keeps the model when its group has quota, when both are used up, or without a reading', () => {
    const state = { currentModelId: 'claude-sonnet-4-6', availableModels: MODELS };
    const now = Date.now();
    expect(decideAgyQuotaModelSwitch({ modelState: state, quota: parseAgyQuota(QUOTA), now })).toBeNull();
    expect(decideAgyQuotaModelSwitch({
      modelState: { currentModelId: 'gemini-3.8-flash', availableModels: MODELS },
      quota: parseAgyQuota(QUOTA.replace('40%', '0%')),
      now,
    })).toBeNull();
    expect(decideAgyQuotaModelSwitch({ modelState: state, quota: null, now })).toBeNull();
  });

  it('never waits for agy: it decides from the last reading and refreshes in the background', async () => {
    let calls = 0;
    let release: (value: string) => void = () => {};
    const read = () => {
      calls++;
      return new Promise<ReturnType<typeof parseAgyQuota>>((resolve) => {
        release = (output) => resolve(parseAgyQuota(output));
      });
    };
    const guard = createAgyQuotaGuard({ read, now: () => new Date(2026, 10, 9, 18, 0).getTime() });
    const switched: string[] = [];
    const context = {
      modelState: { currentModelId: 'gemini-3.8-flash', availableModels: MODELS },
      setModel: async (modelId: string) => { switched.push(modelId); },
      notify: () => {},
    };

    // The first reading starts when the chat is created; a message before it is ready goes as it is.
    expect(calls).toBe(1);
    await guard(context);
    expect(switched).toEqual([]);
    expect(calls).toBe(1);
    release(QUOTA);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The next message uses that reading and starts the next refresh.
    await guard(context);
    expect(switched).toEqual(['claude-sonnet-4-6']);
    expect(calls).toBe(2);
  });
});

