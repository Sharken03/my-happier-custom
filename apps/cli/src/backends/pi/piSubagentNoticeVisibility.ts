/**
 * pi-subagents sends its notices to the parent agent as custom messages with `display: true`
 * (supervisor requests, control and steering notices, watchdog warnings, completion notices).
 * The agent still receives them; this only decides if Happier shows them as user rows.
 * Hidden by default. Set HAPPIER_PI_SHOW_SUBAGENT_NOTICES=1 to show them.
 */
const SUBAGENT_NOTICE_TYPE = /^subagent[_-]/;

export function isHiddenPiSubagentNotice(
  customType: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof customType !== 'string' || !SUBAGENT_NOTICE_TYPE.test(customType)) return false;
  return env.HAPPIER_PI_SHOW_SUBAGENT_NOTICES !== '1';
}
