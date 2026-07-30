export const WORKSPACE_AUTOSAVE_DELAY_MS = 1200;

export function shouldScheduleWorkspaceAutosave({
  autosaveDocs,
  workspaceOpen,
  workspaceDirty,
  workspaceSaving,
  hasDocument,
  leavePromptOpen,
}) {
  return Boolean(
    autosaveDocs
    && workspaceOpen
    && workspaceDirty
    && !workspaceSaving
    && hasDocument
    && !leavePromptOpen
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

export function workspaceSaveVersionMetadata({ automatic = false } = {}) {
  return {
    createVersion: true,
    versionLabel: automatic ? 'Autosave' : 'Manual save',
  };
}

export async function prepareWorkspaceCitationCheck({
  workspaceDirty,
  saveWorkspaceDocument,
}) {
  if (!workspaceDirty) return true;
  if (typeof saveWorkspaceDocument !== 'function') return false;
  return Boolean(await saveWorkspaceDocument({ automatic: true }));
}
