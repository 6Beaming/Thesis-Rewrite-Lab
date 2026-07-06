export function createStandbyController(ctx) {
  const { state, pick, setIntervalTracked } = ctx;

  function restoreWandPose(options = {}) {
    if (!options.keepWand || state.wand === 'hidden') {
      return;
    }
    ctx.wand.keepWandPoseActive({
      preserveIntervals: true,
      preserveVariantTimers: true,
      resumeTremor: true,
    });
  }

  function runStandbyVariant(variant, options = {}) {
    ctx.clearVariantTimers();
    ctx.clearStageModes();
    ctx.eyes.clearEyeController();
    ctx.eyes.resetEyes(false);
    state.activeVariant = variant;

    if (variant === 'head-shake') {
      ctx.head.enableHeadShake();
      ctx.eyes.startEyeObserve();
      restoreWandPose(options);
      return;
    }

    if (variant === 'observe-mark') {
      ctx.eyes.startEyeObserve();
      ctx.head.startMarkingTime();
      restoreWandPose(options);
      return;
    }

    if (variant === 'sleep-notes') {
      ctx.eyes.eyeClose();
      ctx.head.enableHeadStabilized();
      ctx.particles.startNoteSmoke();
      restoreWandPose(options);
      return;
    }

    if (variant === 'head-rotate') {
      ctx.eyes.startEyeObserve();
      ctx.head.startHeadRotatingLoop();
      restoreWandPose(options);
    }
  }

  function runStandbyChoice(choice, options = {}) {
    const variants = ['head-shake', 'observe-mark', 'sleep-notes', 'head-rotate'];
    if (choice === 'random') {
      runStandbyVariant(pick(variants), options);
      setIntervalTracked(() => runStandbyVariant(pick(variants), options), 6500);
      return;
    }
    runStandbyVariant(choice, options);
  }

  function enterStandby(choice = 'random', options = {}) {
    state.mode = 'standby';
    state.thinking = false;
    state.error = false;
    state.standbyChoice = choice;
    ctx.particles.clearProjectiles();
    ctx.eyes.resetEyes(true);
    ctx.eyes.startBlink();
    runStandbyChoice(choice, options);
  }

  return {
    enterStandby,
    runStandbyVariant,
  };
}
