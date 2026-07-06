import { useCallback, useEffect, useRef, useState } from 'react';
import { measureMobileContainer } from './animations/containerLayout.js';

const LONG_PRESS_MS = 400;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function useFloatingWindow() {
  const windowRef = useRef(null);
  const dragRef = useRef({
    active: false,
    longPressTimer: null,
    dragging: false,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
  });

  const [metrics, setMetrics] = useState(() => measureMobileContainer());
  const [position, setPosition] = useState(() => {
    const initial = measureMobileContainer();
    return { left: initial.snapLeft, top: initial.maxTop };
  });
  const [isDragging, setIsDragging] = useState(false);

  const refreshMetrics = useCallback(() => {
    const next = measureMobileContainer();
    setMetrics(next);
    setPosition((prev) => ({
      left: next.snapLeft,
      top: clamp(prev.top, next.minTop, next.maxTop),
    }));
  }, []);

  useEffect(() => {
    refreshMetrics();
    window.addEventListener('resize', refreshMetrics);
    return () => window.removeEventListener('resize', refreshMetrics);
  }, [refreshMetrics]);

  const snapLeft = useCallback(() => {
    const next = measureMobileContainer();
    setMetrics(next);
    setPosition((prev) => ({
      left: next.snapLeft,
      top: clamp(prev.top, next.minTop, next.maxTop),
    }));
    setIsDragging(false);
  }, []);

  const clearLongPress = useCallback(() => {
    if (dragRef.current.longPressTimer) {
      clearTimeout(dragRef.current.longPressTimer);
      dragRef.current.longPressTimer = null;
    }
  }, []);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const node = windowRef.current;
    if (!node) {
      return;
    }

    clearLongPress();
    const rect = node.getBoundingClientRect();
    dragRef.current.pointerId = event.pointerId;
    dragRef.current.offsetX = event.clientX - rect.left;
    dragRef.current.offsetY = event.clientY - rect.top;
    dragRef.current.dragging = false;

    dragRef.current.longPressTimer = setTimeout(() => {
      dragRef.current.dragging = true;
      dragRef.current.active = true;
      setIsDragging(true);
      node.setPointerCapture(event.pointerId);
    }, LONG_PRESS_MS);
  }, [clearLongPress]);

  const onPointerMove = useCallback((event) => {
    if (!dragRef.current.dragging || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const next = measureMobileContainer();
    const left = event.clientX - dragRef.current.offsetX;
    const top = clamp(event.clientY - dragRef.current.offsetY, next.minTop, next.maxTop);
    setPosition({ left, top });
  }, []);

  const onPointerUp = useCallback((event) => {
    clearLongPress();

    const wasDragging = dragRef.current.dragging;
    dragRef.current.dragging = false;
    dragRef.current.active = false;
    dragRef.current.pointerId = null;

    if (windowRef.current?.hasPointerCapture(event.pointerId)) {
      windowRef.current.releasePointerCapture(event.pointerId);
    }

    if (wasDragging) {
      snapLeft();
    }
  }, [clearLongPress, snapLeft]);

  const onPointerCancel = useCallback((event) => {
    clearLongPress();
    dragRef.current.dragging = false;
    dragRef.current.pointerId = null;
    snapLeft();
    if (windowRef.current?.hasPointerCapture(event.pointerId)) {
      windowRef.current.releasePointerCapture(event.pointerId);
    }
  }, [clearLongPress, snapLeft]);

  return {
    windowRef,
    metrics,
    position,
    isDragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
