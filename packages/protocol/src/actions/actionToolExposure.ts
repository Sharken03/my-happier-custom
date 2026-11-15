import type { ActionId } from './actionIds.js';
import type { ActionsSettingsV1 } from './actionSettings.js';
import {
  ACTION_TOOL_EXPOSURE_SURFACES,
  resolveActionSurfaceAvailability,
} from './actionSurfaceAvailability.js';
import type { ActionSpec, ActionToolExposureMode, ActionToolExposureSurface } from './actionSpecs.js';

export { ACTION_TOOL_EXPOSURE_SURFACES };

/**
 * Read-only bootstrap/observation Actions that Session Agents must be able to
 * call directly.
 *
 * Non-read-only actions that should also be directly exposed to session agents
 * must NOT be added here; they declare `toolExposure: { session_agent: 'direct' }`
 * on their own spec instead (see `review.start`, `execution.run.send`,
 * `execution.run.action`). Two distinct fields:
 * - `surfaces.session_agent` (boolean) — availability: may the surface call the action.
 * - `toolExposure.session_agent` (`direct` | `discoverable_only`) — presentation: is the
 *   tool declared to the model.
 * This list only participates in the presentation default; availability is resolved
 * separately in `resolveActionSurfaceAvailability`.
 */
export const SESSION_AGENT_SAFE_OBSERVATION_ACTION_IDS = [
  'action.spec.search',
  'action.spec.get',
  'action.options.resolve',
  'execution.run.list',
  'execution.run.get',
  'execution.run.wait',
] as const satisfies readonly ActionId[];

export const SESSION_AGENT_DIRECT_ACTION_TOOL_ALLOW_LIST = [
  ...SESSION_AGENT_SAFE_OBSERVATION_ACTION_IDS,
] as const satisfies readonly ActionId[];

const SESSION_AGENT_DIRECT_ACTION_TOOL_ALLOW_SET = new Set<ActionId>(SESSION_AGENT_DIRECT_ACTION_TOOL_ALLOW_LIST);

export type ActionToolExposureResolutionContext = Readonly<{
  settings?: ActionsSettingsV1 | null;
  isActionEnabled?: ((id: ActionId) => boolean) | null;
}>;

function getSettingsOverride(
  spec: ActionSpec,
  surface: ActionToolExposureSurface,
  context?: ActionToolExposureResolutionContext | null,
): ActionToolExposureMode | null {
  const actionId = spec.id as ActionId;
  return context?.settings?.actions?.[actionId]?.toolExposureModes?.[surface] ?? null;
}

function getDefaultActionToolExposureMode(spec: ActionSpec, surface: ActionToolExposureSurface): ActionToolExposureMode {
  const explicit = spec.toolExposure?.[surface];
  if (explicit) return explicit;
  if (surface === 'session_agent') {
    return SESSION_AGENT_DIRECT_ACTION_TOOL_ALLOW_SET.has(spec.id as ActionId) ? 'direct' : 'discoverable_only';
  }
  return 'direct';
}

function isActionAvailableOnToolExposureSurface(
  spec: ActionSpec,
  surface: ActionToolExposureSurface,
  context?: ActionToolExposureResolutionContext | null,
): boolean {
  return resolveActionSurfaceAvailability({
    actionId: spec.id as ActionId,
    surface,
    settings: context?.settings ?? null,
    isActionEnabled: context?.isActionEnabled ?? null,
  }).available;
}

export function resolveActionToolExposureMode(
  spec: ActionSpec,
  surface: ActionToolExposureSurface,
  context?: ActionToolExposureResolutionContext | null,
): ActionToolExposureMode {
  return getSettingsOverride(spec, surface, context) ?? getDefaultActionToolExposureMode(spec, surface);
}

export function isActionDirectToolExposedOn(
  spec: ActionSpec,
  surface: ActionToolExposureSurface,
  context?: ActionToolExposureResolutionContext | null,
): boolean {
  return resolveActionSurfaceAvailability({
    actionId: spec.id as ActionId,
    surface,
    settings: context?.settings ?? null,
    isActionEnabled: context?.isActionEnabled ?? null,
    requireToolBinding: true,
  }).available
    && resolveActionToolExposureMode(spec, surface, context) === 'direct';
}

export function isActionDiscoverableOnToolSurface(
  spec: ActionSpec,
  surface: ActionToolExposureSurface,
  context?: ActionToolExposureResolutionContext | null,
): boolean {
  return isActionAvailableOnToolExposureSurface(spec, surface, context);
}
