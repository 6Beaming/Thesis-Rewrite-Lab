export const EDITOR_PRESERVE_SCROLL_META = 'editorPreserveScroll';

export function scheduleAnimationFrameOnce(frameRef, requestFrame, callback) {
  if (!frameRef || frameRef.current !== null) return false;
  frameRef.current = requestFrame(() => {
    frameRef.current = null;
    callback();
  });
  return true;
}

export function cancelScheduledAnimationFrame(frameRef, cancelFrame) {
  if (!frameRef || frameRef.current === null) return false;
  cancelFrame(frameRef.current);
  frameRef.current = null;
  return true;
}

export function shouldRestoreEditorScroll(
  before,
  after,
  {
    preserveExact = false,
    viewportHeight = 0,
    viewportWidth = 0,
  } = {},
) {
  if (!before || !after) return false;
  const verticalDelta = Math.abs(Number(after.top) - Number(before.top));
  const horizontalDelta = Math.abs(Number(after.left) - Number(before.left));
  if (preserveExact) return verticalDelta > 0.5 || horizontalDelta > 0.5;

  const verticalThreshold = Math.max(120, Number(viewportHeight) * 0.45);
  const horizontalThreshold = Math.max(120, Number(viewportWidth) * 0.45);
  const resetNearStart = Number(before.top) > 80 && Number(after.top) < 8;
  return resetNearStart
    || verticalDelta > verticalThreshold
    || horizontalDelta > horizontalThreshold;
}
