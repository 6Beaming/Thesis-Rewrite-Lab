import { BLINK_MIN, BLINK_MAX, createAnimationState, createTimerRegistry, createVariantRegistry, cacheStageElements, clearStageModes, random, pick } from './animationState.jsx';
import { createEyeController } from './eyes.jsx';
import { createHeadController } from './head.jsx';
import { createParticleController } from './particles.jsx';
import { createStandbyController } from './standby.jsx';

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
    clearStageModes() {
      clearStageModes(els.stage, els.headGroup);
    },
  };

  ctx.eyes = createEyeController(ctx);
  ctx.head = createHeadController(ctx);
  ctx.particles = createParticleController(ctx);
  ctx.standby = createStandbyController(ctx);

  return {
    state,
    els,
    enterStandby(choice) {
      ctx.standby.enterStandby(choice);
    },
    dispose() {
      variants.clearVariantTimers();
      ctx.particles.clearProjectiles();
      ctx.eyes.stopBlink();
      timers.clearAll();
      clearStageModes(els.stage, els.headGroup);
    },
  };
}
