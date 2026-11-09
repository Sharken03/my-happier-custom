import { describe, expect, it } from 'vitest';

import { createPiModelCatalogEntry } from './piModelCatalog';

describe('Pi model catalog identity', () => {
  it('retains the Pi provider when the native model id already contains a slash', () => {
    const raw = { provider: 'openrouter', modelId: 'anthropic/claude-sonnet', name: 'Claude Sonnet' };
    const entry = createPiModelCatalogEntry(raw);
    expect(entry).toMatchObject({ id: 'openrouter/anthropic/claude-sonnet', name: 'Claude Sonnet' });
    expect(createPiModelCatalogEntry({ ...raw, modelId: entry?.id })).toEqual(entry);
  });
});

describe('Pi model catalog thinking levels', () => {
  const choices = (entry: ReturnType<typeof createPiModelCatalogEntry>) =>
    ((entry?.modelOptions?.[0] as { options?: Array<{ value: string }> } | undefined)?.options ?? []).map((option) => option.value);

  it('offers the four levels when the model has no thinking level map', () => {
    expect(choices(createPiModelCatalogEntry({ provider: 'p', modelId: 'm', supportsThinking: true })))
      .toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('offers only the levels the map supports, and Off when the map names one', () => {
    const entry = createPiModelCatalogEntry({
      provider: 'p', modelId: 'm', supportsThinking: true, thinkingEffort: 'off',
      thinkingLevelMap: { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null },
    });
    expect(choices(entry)).toEqual(['off', 'high']);
    expect((entry?.modelOptions?.[0] as { currentValue?: string }).currentValue).toBe('off');
  });

  it('falls back to the first supported level when the current one is not offered', () => {
    const entry = createPiModelCatalogEntry({
      provider: 'p', modelId: 'm', supportsThinking: true, thinkingEffort: 'medium',
      thinkingLevelMap: { low: null, medium: null, xhigh: null },
    });
    expect(choices(entry)).toEqual(['high']);
    expect((entry?.modelOptions?.[0] as { currentValue?: string }).currentValue).toBe('high');
  });
});

