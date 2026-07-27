const MIN_FRAME_RECT_SIZE = 2;

function cloneFrame(frame) {
  return {
    ...frame,
    rects: (frame.rects ?? []).map((rect) => ({ ...rect })),
  };
}

function splitRequiredInset(requiredInset, previousSize, currentSize) {
  const previousCapacity = Math.max(0, previousSize - MIN_FRAME_RECT_SIZE);
  const currentCapacity = Math.max(0, currentSize - MIN_FRAME_RECT_SIZE);
  const previousInset = Math.min(requiredInset / 2, previousCapacity);
  const currentInset = Math.min(requiredInset - previousInset, currentCapacity);
  const remainingInset = requiredInset - previousInset - currentInset;
  return {
    previousInset: previousInset + Math.min(remainingInset, previousCapacity - previousInset),
    currentInset,
  };
}

/**
 * Insets only the facing edges of consecutive block frames. Text rectangles can
 * touch or overlap after their visual padding is added; keeping a real gap here
 * prevents the SVG strokes from doubling into a single heavy border.
 */
export function separateAdjacentBlockRects(frames, minimumGap = 4) {
  const separated = (frames ?? []).map(cloneFrame);
  const safeGap = Math.max(0, Number(minimumGap) || 0);

  for (let index = 1; index < separated.length; index += 1) {
    const previousRects = separated[index - 1].rects;
    const currentRects = separated[index].rects;
    const previous = previousRects.at(-1);
    const current = currentRects[0];
    if (!previous || !current) continue;

    const previousHeight = previous.bottom - previous.top;
    const currentHeight = current.bottom - current.top;
    const verticalOverlap = Math.min(previous.bottom, current.bottom)
      - Math.max(previous.top, current.top);
    const sharesLine = verticalOverlap > Math.min(previousHeight, currentHeight) / 2;

    if (sharesLine) {
      const requiredInset = safeGap - (current.left - previous.right);
      if (requiredInset <= 0) continue;
      const { previousInset, currentInset } = splitRequiredInset(
        requiredInset,
        previous.right - previous.left,
        current.right - current.left,
      );
      previous.right -= previousInset;
      current.left += currentInset;
      continue;
    }

    if (current.top < previous.top) continue;
    const requiredInset = safeGap - (current.top - previous.bottom);
    if (requiredInset <= 0) continue;
    const { previousInset, currentInset } = splitRequiredInset(
      requiredInset,
      previous.bottom - previous.top,
      current.bottom - current.top,
    );
    previous.bottom -= previousInset;
    current.top += currentInset;
  }

  return separated;
}

export function frameAtPoint(frames, x, y, tolerance = 0) {
  const pointX = Number(x);
  const pointY = Number(y);
  const safeTolerance = Math.max(0, Number(tolerance) || 0);
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;

  return (frames ?? []).find(({ rects = [] }) => rects.some((rect) => (
    pointX >= rect.left - safeTolerance
    && pointX <= rect.right + safeTolerance
    && pointY >= rect.top - safeTolerance
    && pointY <= rect.bottom + safeTolerance
  ))) ?? null;
}
