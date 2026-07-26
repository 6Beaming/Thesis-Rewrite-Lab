import { useEffect, useRef } from 'react';
import { createOwlAnimator } from './createOwlAnimator.jsx';

function normalizeOptions(options) {
  if (typeof options === 'string') {
    return { standby: options };
  }
  return options ?? {};
}

function resolveTarget(target) {
  return target?.current ?? target;
}

export function useOwlAnimator(stageRef, options = 'random') {
  const animatorRef = useRef(null);
  const previousStandbyRef = useRef(null);
  const previousLoadingRef = useRef(false);
  const previousErrorRef = useRef(false);
  const previousErrorKeyRef = useRef(null);
  const config = normalizeOptions(options);
  const standby = config.standby ?? 'random';
  const loading = Boolean(config.loading);
  const error = Boolean(config.error);
  const errorKey = config.errorKey ?? 0;
  const magicTargets = config.magicTargets ?? [];
  const magicClick = config.magicClick ?? true;
  const trackPointer = config.trackPointer ?? true;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }

    const animator = createOwlAnimator(stage);
    if (!animator) {
      return undefined;
    }

    animatorRef.current = animator;
    animator.enterStandby(standby);
    previousStandbyRef.current = standby;
    config.onReady?.(animator);
    if (loadingRef.current) {
      animator.startThinking();
    }

    return () => {
      animatorRef.current = null;
      animator.dispose();
    };
  }, [stageRef]);

  useEffect(() => {
    if (previousStandbyRef.current === standby) {
      return;
    }
    previousStandbyRef.current = standby;
    animatorRef.current?.enterStandby(standby);
  }, [standby]);

  useEffect(() => {
    const animator = animatorRef.current;
    if (!animator) {
      previousLoadingRef.current = loading;
      return;
    }

    if (loading) {
      animator.startThinking();
    } else if (previousLoadingRef.current && !error) {
      animator.endThinking();
    }
    previousLoadingRef.current = loading;
  }, [loading, error]);

  useEffect(() => {
    const animator = animatorRef.current;
    if (!animator) {
      previousErrorRef.current = error;
      previousErrorKeyRef.current = errorKey;
      return;
    }

    if (error && (!previousErrorRef.current || previousErrorKeyRef.current !== errorKey)) {
      animator.triggerError();
    }
    previousErrorRef.current = error;
    previousErrorKeyRef.current = errorKey;
  }, [error, errorKey]);

  useEffect(() => {
    const animator = animatorRef.current;
    if (!animator || !magicTargets.length) {
      return undefined;
    }

    const cleanups = magicTargets.map(resolveTarget).filter(Boolean).map((target) => {
      const handleEnter = () => animator.showWand();
      target.addEventListener('mouseenter', handleEnter);
      let handleClick = null;
      if (magicClick) {
        handleClick = () => animator.useMagic(target);
        target.addEventListener('click', handleClick);
      }
      return () => {
        target.removeEventListener('mouseenter', handleEnter);
        if (handleClick) {
          target.removeEventListener('click', handleClick);
        }
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [magicTargets, magicClick]);

  useEffect(() => {
    if (!trackPointer) {
      animatorRef.current?.stopEyeChase();
      return undefined;
    }

    const handlePointerMove = (event) => {
      animatorRef.current?.handlePointerMove(event);
    };

    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      animatorRef.current?.stopEyeChase();
    };
  }, [trackPointer]);

  return animatorRef;
}
