export type PiThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

export type PiModelCatalogEntry = Readonly<{
  id: string;
  name: string;
  description: string;
  modelOptions?: unknown[];
}>;

export function normalizePiThinkingEffort(raw: unknown): PiThinkingEffort | null {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  if (value === 'max') return 'xhigh';
  return null;
}

export function qualifyPiModelId(providerRaw: unknown, modelIdRaw: unknown): string | null {
  const provider = typeof providerRaw === 'string' ? providerRaw.trim() : '';
  const modelId = typeof modelIdRaw === 'string' ? modelIdRaw.trim() : '';
  if (!provider || !modelId) return null;
  const providerPrefix = `${provider}/`;
  return modelId.startsWith(providerPrefix) ? modelId : `${providerPrefix}${modelId}`;
}

export function createPiModelCatalogEntry(params: Readonly<{
  provider: unknown;
  modelId: unknown;
  name?: unknown;
  supportsThinking?: boolean;
  thinkingEffort?: unknown;
  /**
   * The model's thinkingLevelMap from Pi's models.json: null marks a level the model does not
   * support, and an `off` value lets the model run without thinking.
   */
  thinkingLevelMap?: unknown;
}>): PiModelCatalogEntry | null {
  const provider = typeof params.provider === 'string' ? params.provider.trim() : '';
  const id = qualifyPiModelId(provider, params.modelId);
  if (!provider || !id) return null;

  const name = typeof params.name === 'string' && params.name.trim().length > 0
    ? params.name.trim()
    : id.slice(id.indexOf('/') + 1);
  const levels = resolvePiThinkingEffortChoices(params.thinkingLevelMap);
  const requested = normalizePiThinkingEffort(params.thinkingEffort) ?? 'medium';
  const thinkingEffort = levels.some((level) => level.value === requested) ? requested : levels[0]?.value ?? requested;

  return {
    id,
    name,
    description: provider,
    ...(params.supportsThinking === true ? {
      modelOptions: [{
        id: 'reasoning_effort',
        name: 'Thinking',
        type: 'select',
        currentValue: thinkingEffort,
        options: levels,
      }],
    } : {}),
  };
}

const PI_THINKING_EFFORT_CHOICES: ReadonlyArray<Readonly<{ value: PiThinkingEffort; name: string }>> = [
  { value: 'off', name: 'Off' },
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
  { value: 'xhigh', name: 'Max' },
];

/**
 * The effort choices a model offers. Without a thinkingLevelMap: Low to Max, as Pi's defaults. With
 * one: the levels it does not mark null, and Off only when it gives `off` a value.
 */
function resolvePiThinkingEffortChoices(thinkingLevelMap: unknown): ReadonlyArray<Readonly<{ value: PiThinkingEffort; name: string }>> {
  const map = thinkingLevelMap && typeof thinkingLevelMap === 'object' && !Array.isArray(thinkingLevelMap)
    ? thinkingLevelMap as Record<string, unknown>
    : null;
  const choices = PI_THINKING_EFFORT_CHOICES.filter((choice) => {
    if (choice.value === 'off') return map !== null && typeof map.off === 'string';
    return map === null || map[choice.value] !== null;
  });
  return choices.length > 0 ? choices : PI_THINKING_EFFORT_CHOICES.filter((choice) => choice.value !== 'off');
}
