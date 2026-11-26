# Hibernated Sessions Toggle

## Setting
- **Key**: `showHibernatedInActiveList` (boolean, default: `false`)
- **Location**: `apps/ui/sources/sync/domains/settings/registry/account/accountDisplaySettingDefinitions.ts`
- **Sync**: Account-scoped, synced via relay

## Logic Flow
```
Settings → useSetting() → useVisibleSessionListViewData.ts
  → SessionListDataState.showHibernatedInActiveList
  → buildSessionListViewDataWithServerScope.ts
  → buildSessionListViewData.ts
    → isSessionActive(session, showHibernatedInActiveList)
      → returns true if (session.active || (!session.archivedAt && showHibernatedInActiveList))
```

## Key Files
| File | Role |
|------|------|
| `accountDisplaySettingDefinitions.ts` | Setting definition |
| `useVisibleSessionListViewData.ts` | Reads setting, passes to state |
| `buildSessionListViewDataWithServerScope.ts` | Propagates to core function |
| `sessionListViewData.ts` | Core logic: `isSessionActive()`, `resolveSectionForSession()` |
| `sessionListRenderableCommit.ts` | Reads from persisted state settings |
| `session.tsx` (settings UI) | Toggle UI |

## Behavior
| Setting | Stopped Session (active=false, archivedAt=null) |
|---------|--------------------------------------------------|
| Off (default) | Shows in "Inactive" section |
| On | Shows in "Active" section |

RAM still freed by `happier-idle-stop` (2h idle). Purely visual.
