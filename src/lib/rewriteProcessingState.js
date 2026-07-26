export function rewriteCardShowsProcessing(card, currentBlock) {
  const tonePending = card?.state === 'queued' || card?.state === 'running';
  const skippedOrigin = currentBlock?.attrs?.resumeStatus === 'skipped'
    || currentBlock?.resume_status === 'skipped';
  const manuallyEdited = currentBlock?.attrs?.changeSource === 'manual'
    || currentBlock?.change_source === 'manual';
  const automaticMiss = (
    !card?.response
    && !skippedOrigin
    && !manuallyEdited
    && card?.state !== 'failed'
  );
  return tonePending || automaticMiss;
}

export function shouldAnimateWorkspaceOwl({
  requestLoading,
  workspaceMode,
  mobileOwlOpen,
  mobilePanelMode,
  rewriteAllCompleted,
  rewriteNlpEligible,
  rewriteCards,
  currentRewriteBlock,
}) {
  if (requestLoading) return true;
  const rewritePanelVisible = workspaceMode === 'rewriting'
    || (mobileOwlOpen && mobilePanelMode === 'rewriting');
  return Boolean(
    rewritePanelVisible
    && !rewriteAllCompleted
    && rewriteNlpEligible
    && (rewriteCards ?? []).some((card) => rewriteCardShowsProcessing(card, currentRewriteBlock)),
  );
}
