export {
  ChangeConfidenceSchema,
  ChangeEvidenceSourceSchema,
  ChangeSetConfidenceSummarySchema,
  FileChangeEvidenceSchema,
  FileChangeKindSchema,
  SessionChangeSetFileSchema,
  SessionChangeSetSchema,
  SessionWorkingTreeMatchedFileSchema,
  SessionWorkingTreeProjectionSchema,
  TurnChangeSetSchema,
} from './schemas.js';
export type {
  ChangeConfidence,
  ChangeEvidenceSource,
  ChangeSetConfidenceSummary,
  FileChangeEvidence,
  FileChangeKind,
  SessionChangeSet,
  SessionChangeSetFile,
  SessionWorkingTreeMatchedFile,
  SessionWorkingTreeProjection,
  TurnChangeSet,
} from './types.js';
export { mergeTurnChangeSets } from './mergeTurnChangeSets.js';
export { reconcileWithScmSnapshot } from './reconcileWithScmSnapshot.js';
export { excludeRolledBackTurns } from './rollbacks.js';
export { TEXT_CHANGE_SNIPPET_SEPARATOR, combineTextChanges, hasUnifiedDiffLineChanges, type TextChange } from './textChanges.js';
