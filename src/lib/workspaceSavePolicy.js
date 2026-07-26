export const WORKSPACE_AUTOSAVE_DELAY_MS = 1200;

export function shouldScheduleWorkspaceAutosave({
  autosaveDocs,
  workspaceOpen,
  workspaceDirty,
  workspaceSaving,
  hasDocument,
  leavePromptOpen,
  formatReviewOpen,
}) {
  return Boolean(
    autosaveDocs
    && workspaceOpen
    && workspaceDirty
    && !workspaceSaving
    && hasDocument
    && !leavePromptOpen
    && !formatReviewOpen
  );
}

export function aiSavePolicy({ aiContextDirty, autosaveDocs }) {
  if (!aiContextDirty) return 'ready';
  return autosaveDocs ? 'autosave-first' : 'manual-save-required';
}

export function workspaceLeavePolicy({ workspaceDirty, autosaveDocs }) {
  if (!workspaceDirty) return 'leave';
  return autosaveDocs ? 'autosave-and-leave' : 'prompt';
}
