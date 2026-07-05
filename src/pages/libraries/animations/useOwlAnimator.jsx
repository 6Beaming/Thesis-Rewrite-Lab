import { useEffect } from 'react';
import { createOwlAnimator } from './createOwlAnimator.jsx';

export function useOwlAnimator(stageRef, choice = 'random') {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }

    const animator = createOwlAnimator(stage);
    if (!animator) {
      return undefined;
    }

    animator.enterStandby(choice);

    return () => {
      animator.dispose();
    };
  }, [stageRef, choice]);
}
