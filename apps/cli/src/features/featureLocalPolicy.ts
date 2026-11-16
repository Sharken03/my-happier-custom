import { parseBooleanEnv, type FeatureId } from '@happier-dev/protocol';

type FeatureLocalPolicyResolver = (env: NodeJS.ProcessEnv) => boolean;

const LOCAL_POLICY_BY_FEATURE: Readonly<Partial<Record<FeatureId, FeatureLocalPolicyResolver>>> = {
  automations: (env) => parseBooleanEnv(env.HAPPIER_FEATURE_AUTOMATIONS__ENABLED, true),
  bugReports: (env) => parseBooleanEnv(env.HAPPIER_FEATURE_BUG_REPORTS__ENABLED, true),
  'execution.runs': (env) => parseBooleanEnv(env.HAPPIER_FEATURE_EXECUTION_RUNS__ENABLED, true),
  voice: (env) => parseBooleanEnv(env.HAPPIER_FEATURE_VOICE__ENABLED, true),
  connectedServices: (env) => parseBooleanEnv(env.HAPPIER_FEATURE_CONNECTED_SERVICES__ENABLED, true),
  'connectedServices.quotas': (env) => parseBooleanEnv(env.HAPPIER_FEATURE_CONNECTED_SERVICES_QUOTAS__ENABLED, true),
  channelBridges: (env) => parseBooleanEnv(env.HAPPIER_FEATURE_CHANNEL_BRIDGES__ENABLED, true),
  'channelBridges.telegram': (env) => parseBooleanEnv(env.HAPPIER_FEATURE_CHANNEL_BRIDGES_TELEGRAM__ENABLED, true),
  // Claude Unified TUI runtime-control rides the unified-mode opt-in (unified is itself off by
  // default), so it defaults ON; the env flag is a KILL-SWITCH (=0) if a Claude update breaks the
  // screen verification. The controller fails closed on any unverified control regardless, and the
  // kill-switch restores the legacy restart-notice path.
  'providers.claude.unifiedTerminal.tuiRuntimeControl': (env) =>
    parseBooleanEnv(env.HAPPIER_FEATURE_CLAUDE_UNIFIED_TUI_RUNTIME_CONTROL__ENABLED, true),
  // Source-control writes reach a remote (stage is local, but commit/push/review are outward), so the
  // CLI path defaults OFF and has an explicit opt-in. The UI keeps its own settings toggle; this is the
  // machine-side switch for anything the daemon performs on the user's behalf.
  'scm.writeOperations': (env) => parseBooleanEnv(env.HAPPIER_FEATURE_SCM_WRITE_OPERATIONS__ENABLED, false),
  // The whole agent-review support surface (review runs, publishing findings to a pull request, handing
  // findings to a fix session) sits behind one switch, default OFF. It is a self-contained addition that
  // must stay removable: see REVIEW-SUPPORT.md at the repository root for the file inventory and the
  // removal recipe. Turn it on with HAPPIER_FEATURE_REVIEW_SUPPORT__ENABLED=1.
  'reviews.support': (env) => parseBooleanEnv(env.HAPPIER_FEATURE_REVIEW_SUPPORT__ENABLED, false),
};

export function resolveCliLocalFeaturePolicyEnabled(featureId: FeatureId, env: NodeJS.ProcessEnv): boolean {
  const resolver = LOCAL_POLICY_BY_FEATURE[featureId];
  if (!resolver) return true;
  return resolver(env);
}
