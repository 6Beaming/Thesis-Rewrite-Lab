import { BLINK_MIN, BLINK_MAX, createAnimationState, createTimerRegistry, createVariantRegistry, cacheStageElements, clearStageModes, setIndicator, random, pick } from './animationState.jsx';
import { createEyeController } from './eyes.jsx';
import { createHeadController } from './head.jsx';
import { createParticleController } from './particles.jsx';
import { createStandbyController } from './standby.jsx';
import owlPathCatalog from '../../../../scripts/generated/owl-path-catalog.json';

const RIGHT_WING_LIFT_MS = 600;
const RIGHT_WING_BACK_MS = 900;
const RIGHT_WING_TREMOR_RESET_MS = 250;
const MAGIC_PARTICLE_FLIGHT_MS = 1220;
const WAND_SCALE = 1.15;
const PATH_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const WAND_EASE = {
  forward: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  reverse: 'cubic-bezier(0.8, 0, 0.8, 0.3)',
};
const RIGHT_WING_IDS = owlPathCatalog.rightWing?.ids ?? [];
const LEFT_WING_IDS = owlPathCatalog.leftWing?.ids ?? [];
const WAND_IDS = owlPathCatalog.wand?.ids ?? [];
const RIGHT_WING_AFTER_DEG = owlPathCatalog.rightWing?.afterState?.groupRotateDeg ?? -10;

function resetGroupAnimation(el) {
  if (!el) {
    return;
  }
  el.style.animation = 'none';
  el.getBoundingClientRect();
  el.style.animation = '';
}

function pickTremorAngle(randomValue, min, max, threshold = 1.5) {
  let angle = randomValue(min, max);
  while (Math.abs(angle) < threshold) {
    angle = randomValue(min, max);
  }
  return angle;
}

function rightWingTransform(extraRotateDeg = 0) {
  return `rotate(${RIGHT_WING_AFTER_DEG + extraRotateDeg}deg)`;
}

function wandTransform(rotateDeg) {
  return `rotate(${rotateDeg}deg) scale(${WAND_SCALE})`;
}

function queryPath(els, id) {
  return els.stage?.querySelector(`#${id}`);
}

function queryStageElement(els, selector, fallback) {
  return els.stage?.querySelector(selector) ?? fallback ?? null;
}

function applyPathMap(els, ids, paths, durationForId, easing) {
  ids.forEach((id) => {
    const el = queryPath(els, id);
    const d = paths?.[id];
    if (!el || !d) {
      return;
    }
    const duration = durationForId(id);
    el.style.transition = `d ${duration}ms ${easing}`;
    el.getBoundingClientRect();
    el.setAttribute('d', d);
  });
}

function snapPathMap(els, ids, paths) {
  ids.forEach((id) => {
    const el = queryPath(els, id);
    const d = paths?.[id];
    if (!el || !d) {
      return;
    }
    el.style.transition = '';
    el.setAttribute('d', d);
  });
}

function createRightWingController(ctx) {
  const { state, els, random: randomValue, clearTimer, requestFrame, setTimeoutTracked, wait } = ctx;

  function getRightWingGroup() {
    return queryStageElement(els, '#right_wing_group', els.rightWingGroup);
  }

  function applyTransform(extraRotateDeg, transition) {
    const wing = getRightWingGroup();
    if (!wing) {
      return;
    }
    wing.style.transition = transition;
    wing.getBoundingClientRect();
    wing.style.transform = rightWingTransform(extraRotateDeg);
  }

  function morphRightWingPaths(toAfterPose, phase) {
    const targetPaths = toAfterPose ? owlPathCatalog.rightWing?.after : owlPathCatalog.rightWing?.before;
    const timing = phase === 'back'
      ? { background: 900, foreground: 700 }
      : { background: 400, foreground: 600 };

    applyPathMap(
      els,
      RIGHT_WING_IDS,
      targetPaths,
      (id) => (id === 'right_wing' ? timing.background : timing.foreground),
      PATH_EASE
    );
  }

  function restoreRightWingPaths() {
    snapPathMap(els, RIGHT_WING_IDS, owlPathCatalog.rightWing?.before);
  }

  function runTremorCycle() {
    if (!state.rightWingTremorActive || !state.thinking) {
      return;
    }
    const duration = randomValue(840, 1960);
    const resetDuration = randomValue(120, 240);
    const wingAngle = pickTremorAngle(randomValue, -5, 5);
    applyTransform(wingAngle, `transform ${duration}ms ease-in-out`);
    state.rightWingTremorTimer = setTimeoutTracked(() => {
      if (!state.rightWingTremorActive || !state.thinking) {
        return;
      }
      applyTransform(0, `transform ${resetDuration}ms ease-in-out`);
      state.rightWingTremorTimer = setTimeoutTracked(runTremorCycle, resetDuration + randomValue(160, 680));
    }, duration);
  }

  function stopRightWingTremorNow() {
    state.rightWingTremorActive = false;
    els.stage?.classList.remove('right-wing-tremor');
    clearTimer(state.rightWingTremorTimer);
    state.rightWingTremorTimer = null;
  }

  async function stopRightWingTremor(resetMs = RIGHT_WING_TREMOR_RESET_MS) {
    stopRightWingTremorNow();
    if (!resetMs) {
      return;
    }
    applyTransform(0, `transform ${resetMs}ms ease-in-out`);
    await wait(resetMs);
  }

  function resetRightWing() {
    stopRightWingTremorNow();
    els.stage?.classList.remove('right-wing-lifting', 'right-wing-lifted', 'right-wing-tremor');
    const wing = getRightWingGroup();
    resetGroupAnimation(wing);
    restoreRightWingPaths();
    if (wing) {
      wing.style.transform = '';
      wing.style.transition = '';
    }
  }

  async function rightWingLift() {
    resetGroupAnimation(getRightWingGroup());
    els.stage?.classList.add('right-wing-lifting');
    morphRightWingPaths(true, 'lift');
    applyTransform(0, `transform ${RIGHT_WING_LIFT_MS}ms ${PATH_EASE}`);
    await wait(RIGHT_WING_LIFT_MS);
    if (state.thinking) {
      els.stage?.classList.remove('right-wing-lifting');
      els.stage?.classList.add('right-wing-lifted');
    }
  }

  function startRightWingTremor() {
    if (!state.thinking) {
      return;
    }
    resetGroupAnimation(getRightWingGroup());
    state.rightWingTremorActive = true;
    els.stage?.classList.add('right-wing-tremor');
    applyTransform(0, '');
    requestFrame(() => {
      if (state.rightWingTremorActive && state.thinking) {
        runTremorCycle();
      }
    });
  }

  async function rightWingBack() {
    if (state.rightWingTremorActive) {
      await stopRightWingTremor(RIGHT_WING_TREMOR_RESET_MS);
    } else {
      stopRightWingTremorNow();
    }
    els.stage?.classList.remove('right-wing-lifting', 'right-wing-lifted', 'right-wing-tremor');
    morphRightWingPaths(false, 'back');
    const wing = getRightWingGroup();
    if (wing) {
      wing.style.transition = `transform ${RIGHT_WING_BACK_MS}ms ${PATH_EASE}`;
      wing.style.transform = 'rotate(0deg)';
    }
    await wait(RIGHT_WING_BACK_MS);
    resetRightWing();
  }

  return {
    resetRightWing,
    rightWingLift,
    startRightWingTremor,
    stopRightWingTremorNow,
    rightWingBack,
  };
}

function createWandController(ctx) {
  const { state, els, random: randomValue, clearTimer, requestFrame, setTimeoutTracked, wait } = ctx;
  let magicPriorityPromise = null;

  function beginMagicPriority() {
    let releasePriority;
    const rawPromise = new Promise((resolve) => {
      releasePriority = resolve;
    });
    const trackedPromise = rawPromise.finally(() => {
      if (magicPriorityPromise === trackedPromise) {
        magicPriorityPromise = null;
      }
    });
    magicPriorityPromise = trackedPromise;
    return releasePriority;
  }

  function waitForMagicPriority() {
    return magicPriorityPromise ?? Promise.resolve();
  }

  function getMagicWand() {
    return queryStageElement(els, '#magic_wand', els.magicWand);
  }

  function getLeftWingGroup() {
    return queryStageElement(els, '#left_wing_group', els.leftWingGroup);
  }

  function leftWingPathsFor(stateName) {
    if (stateName === 'before') {
      return owlPathCatalog.leftWing?.before;
    }
    if (stateName === 'after') {
      return owlPathCatalog.leftWing?.after;
    }
    return owlPathCatalog.leftWing?.intermediate;
  }

  function wandPathsFor(stateName) {
    return stateName === 'after'
      ? owlPathCatalog.wand?.after
      : owlPathCatalog.wand?.intermediate;
  }

  function morphLeftWingPaths(stateName, backgroundMs, foregroundMs, direction = 'forward') {
    applyPathMap(
      els,
      LEFT_WING_IDS,
      leftWingPathsFor(stateName),
      (id) => (id === 'left_wing' ? backgroundMs : foregroundMs),
      WAND_EASE[direction]
    );
  }

  function morphWandPaths(stateName, durationMs, direction = 'forward') {
    applyPathMap(
      els,
      WAND_IDS,
      wandPathsFor(stateName),
      () => durationMs,
      WAND_EASE[direction]
    );
  }

  function snapLeftWingPaths(stateName) {
    snapPathMap(els, LEFT_WING_IDS, leftWingPathsFor(stateName));
  }

  function snapWandPaths(stateName) {
    snapPathMap(els, WAND_IDS, wandPathsFor(stateName));
  }

  function applyTremorTransforms(angle, transition) {
    const wand = getMagicWand();
    const wing = getLeftWingGroup();
    if (wand) {
      wand.style.transition = transition;
      wand.getBoundingClientRect();
      wand.style.transform = wandTransform(angle);
    }
    if (wing) {
      wing.style.transition = transition;
      wing.getBoundingClientRect();
      wing.style.transform = `rotate(${angle}deg)`;
    }
  }

  function clearTremorTransforms() {
    const wand = getMagicWand();
    const wing = getLeftWingGroup();
    if (wand) {
      wand.style.transition = '';
      wand.style.transform = '';
    }
    if (wing) {
      wing.style.transition = '';
      wing.style.transform = '';
    }
  }

  function runWandTremorCycle() {
    if (!state.wandTremorActive || state.wand !== 'tremor') {
      return;
    }
    const duration = randomValue(420, 1100);
    const resetDuration = randomValue(120, 240);
    const angle = pickTremorAngle(randomValue, -5, 5, 1);
    applyTremorTransforms(angle, `transform ${duration}ms ease-in-out`);
    state.wandTremorTimer = setTimeoutTracked(() => {
      if (!state.wandTremorActive || state.wand !== 'tremor') {
        return;
      }
      applyTremorTransforms(0, `transform ${resetDuration}ms ease-in-out`);
      state.wandTremorTimer = setTimeoutTracked(runWandTremorCycle, resetDuration + randomValue(120, 420));
    }, duration);
  }

  function stopWandTremorNow() {
    state.wandTremorActive = false;
    clearTimer(state.wandTremorTimer);
    state.wandTremorTimer = null;
    els.stage?.classList.remove('wand-tremor-active');
    getMagicWand()?.classList.remove('is-tremoring');
  }

  async function stopWandTremor(resetMs) {
    if (state.wand === 'tremor') {
      state.wand = 'ready';
    }
    stopWandTremorNow();
    if (resetMs) {
      applyTremorTransforms(0, `transform ${resetMs}ms ease-in-out`);
      await wait(resetMs);
      clearTremorTransforms();
    }
  }

  function maybeStartWandTremor() {
    if (Date.now() < state.wandSuppressUntil - 100 || state.wand !== 'ready') {
      return;
    }
    state.wand = 'tremor';
    state.wandTremorActive = true;
    els.stage?.classList.add('wand-tremor-active');
    getMagicWand()?.classList.add('is-tremoring');
    resetGroupAnimation(getLeftWingGroup());
    applyTremorTransforms(0, '');
    requestFrame(() => {
      if (state.wandTremorActive && state.wand === 'tremor') {
        runWandTremorCycle();
      }
    });
  }

  function refreshRetractionTimer() {
    clearTimer(state.retractionTimer);
    state.retractionTimer = setTimeoutTracked(() => {
      retractWand();
    }, 30000);
  }

  function resetWand() {
    stopWandTremorNow();
    clearTimer(state.retractionTimer);
    state.retractionTimer = null;
    state.wand = 'hidden';
    els.stage?.classList.remove('left-wing-clench', 'left-wing-wand-ready', 'wand-tremor-active');
    getMagicWand()?.classList.remove('is-visible', 'is-materializing', 'is-ready', 'is-tremoring', 'is-retracting');
    clearTremorTransforms();
    const wing = getLeftWingGroup();
    resetGroupAnimation(wing);
    snapLeftWingPaths('before');
    snapWandPaths('intermediate');
    if (wing) {
      wing.style.transition = '';
      wing.style.transform = '';
    }
  }

  async function retractWand() {
    if (state.wand === 'hidden' || state.wand === 'showing' || state.wand === 'using') {
      return;
    }
    state.wand = 'retracting';
    await stopWandTremor(100);
    if (state.wand !== 'retracting') {
      return;
    }
    getMagicWand()?.classList.add('is-retracting');
    els.stage?.classList.remove('left-wing-wand-ready');
    await wait(400);
    if (state.wand === 'retracting') {
      resetWand();
    }
  }

  async function showWand() {
    const wand = getMagicWand();
    if (!wand) {
      return;
    }
    if (state.wand === 'showing' || state.wand === 'ready' || state.wand === 'tremor') {
      refreshRetractionTimer();
      if (state.wand === 'ready' && !state.wandTremorActive) {
        maybeStartWandTremor();
      }
      return;
    }
    if (state.error || state.thinking) {
      return;
    }

    state.wand = 'showing';
    wand.classList.remove('is-retracting');
    snapWandPaths('intermediate');
    refreshRetractionTimer();

    els.stage?.classList.add('left-wing-clench');
    morphLeftWingPaths('intermediate', 150, 150);
    await wait(150);
    if (state.wand !== 'showing') {
      return;
    }

    els.stage?.classList.remove('left-wing-clench');
    els.stage?.classList.add('left-wing-wand-ready');
    morphLeftWingPaths('after', 300, 300);
    morphWandPaths('after', 300);
    getMagicWand()?.classList.add('is-visible', 'is-materializing');
    await wait(300);
    if (state.wand !== 'showing') {
      return;
    }

    getMagicWand()?.classList.remove('is-materializing');
    getMagicWand()?.classList.add('is-ready');
    state.wand = 'ready';
    maybeStartWandTremor();
  }

  async function useMagic(target, options = {}) {
    if (!target) {
      return;
    }
    const releaseMagicPriority = beginMagicPriority();
    try {
      if (state.error) {
        state.error = false;
        state.mode = 'magic';
        ctx.setIndicator('error', false);
        ctx.eyes.resetEyes(true);
        ctx.eyes.startBlink();
      }
      if (state.thinking) {
        await ctx.endThinking();
      }
      if (state.wand === 'hidden' || state.wand === 'retracting') {
        resetWand();
        await showWand();
      }
      if (state.wand === 'showing') {
        await wait(600);
      }
      if (state.wand === 'tremor') {
        await stopWandTremor(100);
      } else {
        await wait(100);
      }
      if (state.wand === 'hidden') {
        return;
      }

      state.wand = 'using';
      state.wandSuppressUntil = Date.now() + 10000;
      ctx.particles.clearProjectiles();
      const particleDuration = ctx.particles.fireMagicAt(target, options) ?? MAGIC_PARTICLE_FLIGHT_MS;
      refreshRetractionTimer();
      await wait(particleDuration);
      if (state.wand === 'using') {
        state.wand = 'ready';
      }
      setTimeoutTracked(() => {
        if (state.wand === 'ready') {
          maybeStartWandTremor();
        }
      }, 10000);
    } finally {
      releaseMagicPriority();
    }
  }

  return {
    resetWand,
    showWand,
    useMagic,
    waitForMagicPriority,
    stopWandTremorNow,
  };
}

export function createOwlAnimator(stageRoot) {
  if (!stageRoot) {
    return null;
  }

  const state = createAnimationState();
  const timers = createTimerRegistry();
  const variants = createVariantRegistry();
  const els = cacheStageElements(stageRoot);

  const ctx = {
    BLINK_MIN,
    BLINK_MAX,
    state,
    els,
    random,
    pick,
    ...timers,
    ...variants,
    setIndicator(name, visible) {
      setIndicator(els, name, visible);
    },
    clearStageModes() {
      clearStageModes(els.stage, els.headGroup);
    },
  };

  ctx.eyes = createEyeController(ctx);
  ctx.head = createHeadController(ctx);
  ctx.particles = createParticleController(ctx);
  ctx.rightWing = createRightWingController(ctx);
  ctx.wand = createWandController(ctx);
  ctx.standby = createStandbyController(ctx);

  function stopPassiveAnimations(options = {}) {
    const keepBlink = Boolean(options.keepBlink);
    const keepWand = Boolean(options.keepWand);
    const keepRightWing = Boolean(options.keepRightWing);

    state.activeVariant = null;
    state.headLocked = false;
    timers.clearAll();
    variants.clearVariantTimers();
    clearStageModes(els.stage, els.headGroup);
    ctx.eyes.clearEyeController();
    ctx.setIndicator('thinking', false);
    ctx.setIndicator('answer', false);
    ctx.setIndicator('error', false);
    ctx.particles.clearProjectiles();

    if (!keepRightWing) {
      ctx.rightWing.resetRightWing();
    }
    if (!keepWand) {
      ctx.wand.resetWand();
    }
    if (keepBlink) {
      ctx.eyes.startBlink();
    }
  }

  function startStandby(choice) {
    stopPassiveAnimations();
    ctx.standby.enterStandby(choice);
  }

  async function startThinking() {
    if (state.thinking) {
      return;
    }
    await ctx.wand.waitForMagicPriority();
    if (state.thinking || state.error) {
      return;
    }
    stopPassiveAnimations({ keepBlink: true });
    state.mode = 'thinking';
    state.thinking = true;
    state.error = false;
    ctx.setIndicator('thinking', true);
    const direction = Math.random() > 0.5 ? 'left' : 'right';
    ctx.eyes.startEyeThinking(direction);
    ctx.head.headThinkRotation(direction);
    await ctx.rightWing.rightWingLift();
    if (state.thinking) {
      ctx.rightWing.startRightWingTremor();
    }
  }

  async function endThinking() {
    if (!state.thinking) {
      return;
    }
    state.thinking = false;
    ctx.setIndicator('thinking', false);
    ctx.eyes.stopBlink();
    ctx.eyes.resetEyes(true);
    ctx.head.resetHeadThinkRotation();
    ctx.setIndicator('answer', true);
    ctx.rightWing.rightWingBack();
    await timers.wait(750);
    ctx.setIndicator('answer', false);
    ctx.eyes.startBlink();
    startStandby(state.standbyChoice || 'random');
  }

  async function triggerError() {
    const wasThinking = state.thinking;
    state.error = true;
    state.mode = 'error';

    if (wasThinking) {
      state.thinking = false;
      ctx.setIndicator('thinking', false);
    }

    stopPassiveAnimations({ keepRightWing: wasThinking });
    ctx.eyes.stopBlink();
    ctx.head.resetHeadThinkRotation();

    if (wasThinking) {
      ctx.eyes.resetEyes(true);
    }

    ctx.setIndicator('error', true);
    els.stage?.classList.add('mode-error-shake');
    ctx.eyes.eyeSurprise();

    if (wasThinking) {
      ctx.rightWing.rightWingBack();
    }

    timers.setTimeoutTracked(() => {
      els.stage?.classList.remove('mode-error-shake');
    }, 980);

    await timers.wait(5600);
    if (!state.error || state.mode !== 'error') {
      return;
    }
    ctx.setIndicator('error', false);
    state.error = false;
    startStandby(state.standbyChoice || 'random');
  }

  ctx.endThinking = endThinking;

  return {
    state,
    els,
    enterStandby(choice) {
      startStandby(choice);
    },
    startThinking,
    endThinking,
    triggerError,
    showWand() {
      return ctx.wand.showWand();
    },
    useMagic(target, options) {
      return ctx.wand.useMagic(target, options);
    },
    handlePointerMove(event) {
      ctx.eyes.handleEyeChaseMove(event);
    },
    startEyeChase() {
      ctx.eyes.startEyeChase();
    },
    stopEyeChase() {
      ctx.eyes.stopEyeChase();
    },
    dispose() {
      variants.clearVariantTimers();
      ctx.particles.clearProjectiles();
      ctx.eyes.stopBlink();
      timers.clearAll();
      clearStageModes(els.stage, els.headGroup);
      ctx.rightWing.resetRightWing();
      ctx.wand.resetWand();
    },
  };
}
