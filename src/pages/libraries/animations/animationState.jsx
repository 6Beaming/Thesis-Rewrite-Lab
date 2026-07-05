export const BLINK_MIN = 3000;
export const BLINK_MAX = 8000;

export function createAnimationState() {
  return {
    mode: 'standby',
    standbyChoice: 'random',
    activeVariant: null,
    thinking: false,
    error: false,
    blinkEnabled: true,
    headLocked: false,
    projectileNodes: new Set(),
    eye: {
      controller: 'neutral',
      closed: false,
      surprise: false,
      blinkScale: 1,
      blackScaleX: 1,
      blackScaleY: 1,
      whiteScaleX: 1,
      whiteScaleY: 1,
      sides: {
        right: { black: { x: 0, y: 0 }, white: { x: 0, y: 0 } },
        left: { black: { x: 0, y: 0 }, white: { x: 0, y: 0 } },
      },
    },
  };
}

export function createTimerRegistry() {
  const timers = new Set();
  const intervals = new Set();
  const rafs = new Set();

  return {
    timers,
    intervals,
    rafs,
    setTimeoutTracked(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    },
    setIntervalTracked(fn, ms) {
      const id = setInterval(fn, ms);
      intervals.add(id);
      return id;
    },
    requestFrame(fn) {
      const id = requestAnimationFrame((time) => {
        rafs.delete(id);
        fn(time);
      });
      rafs.add(id);
      return id;
    },
    clearAll() {
      timers.forEach((id) => clearTimeout(id));
      intervals.forEach((id) => clearInterval(id));
      rafs.forEach((id) => cancelAnimationFrame(id));
      timers.clear();
      intervals.clear();
      rafs.clear();
    },
  };
}

export function createVariantRegistry() {
  const variantTimers = new Set();
  const variantIntervals = new Set();
  const variantRafs = new Set();

  return {
    setVariantTimeout(fn, ms) {
      const id = setTimeout(() => {
        variantTimers.delete(id);
        fn();
      }, ms);
      variantTimers.add(id);
      return id;
    },
    setVariantInterval(fn, ms) {
      const id = setInterval(fn, ms);
      variantIntervals.add(id);
      return id;
    },
    clearVariantTimers() {
      variantTimers.forEach((id) => clearTimeout(id));
      variantIntervals.forEach((id) => clearInterval(id));
      variantRafs.forEach((id) => cancelAnimationFrame(id));
      variantTimers.clear();
      variantIntervals.clear();
      variantRafs.clear();
    },
  };
}

export function random(min, max) {
  return min + Math.random() * (max - min);
}

export function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function cacheStageElements(stage) {
  return {
    stage,
    headGroup: stage.querySelector('#head_group'),
    particleLayer: stage.querySelector('#particle-layer'),
    thinkingIndicator: stage.closest('.owl-container')?.querySelector('#thinking-indicator'),
    answerIndicator: stage.closest('.owl-container')?.querySelector('#answer-indicator'),
    errorIndicator: stage.closest('.owl-container')?.querySelector('#error-indicator'),
    eyes: {
      right: {
        orbit: stage.querySelector('#right_eye_orbit'),
        black: stage.querySelector('#right_eye_black'),
        white: stage.querySelector('#right_eye_white'),
      },
      left: {
        orbit: stage.querySelector('#left_eye_orbit'),
        black: stage.querySelector('#left_eye_black'),
        white: stage.querySelector('#left_eye_white'),
      },
    },
  };
}

export function clearStageModes(stage, headGroup) {
  if (!stage) {
    return;
  }
  stage.classList.remove(
    'mode-head-shake-left',
    'mode-head-shake-right',
    'mode-stabilized',
    'marking-time',
    'eye-closed',
    'eye-surprise-active',
  );
  if (headGroup) {
    headGroup.style.transform = '';
    headGroup.style.transition = '';
  }
}

export function setIndicator(els, name, visible) {
  const el = els[`${name}Indicator`];
  if (el) {
    el.classList.toggle('is-visible', visible);
  }
}
