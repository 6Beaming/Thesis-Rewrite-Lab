export function createStandbyController(ctx) {
  const { state, pick, setIntervalTracked } = ctx;

  function runStandbyVariant(variant) {
    ctx.clearVariantTimers();
    ctx.clearStageModes();
    ctx.eyes.clearEyeController();
    ctx.eyes.resetEyes(false);
    state.activeVariant = variant;

    if (variant === 'head-shake') {
      ctx.head.enableHeadShake();
      ctx.eyes.startEyeObserve();
      return;
    }

    if (variant === 'observe-mark') {
      ctx.eyes.startEyeObserve();
      ctx.head.startMarkingTime();
      return;
    }

    if (variant === 'sleep-notes') {
      ctx.eyes.eyeClose();
      ctx.head.enableHeadStabilized();
      ctx.particles.startNoteSmoke();
      return;
    }

    if (variant === 'head-rotate') {
      ctx.eyes.startEyeObserve();
      ctx.head.startHeadRotatingLoop();
    }
  }

  function runStandbyChoice(choice) {
    const variants = ['head-shake', 'observe-mark', 'sleep-notes', 'head-rotate'];
    if (choice === 'random') {
      runStandbyVariant(pick(variants));
      setIntervalTracked(() => runStandbyVariant(pick(variants)), 6500);
      return;
    }
    runStandbyVariant(choice);
  }

  function enterStandby(choice = 'random') {
    state.mode = 'standby';
    state.thinking = false;
    state.error = false;
    state.standbyChoice = choice;
    ctx.particles.clearProjectiles();
    ctx.eyes.resetEyes(true);
    ctx.eyes.startBlink();
    runStandbyChoice(choice);
  }

  return {
    enterStandby,
    runStandbyVariant,
  };
}
