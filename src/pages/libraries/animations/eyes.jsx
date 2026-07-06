export function createEyeController(ctx) {
  const { state, els, setTimeoutTracked } = ctx;

  function setEyeTransitions(value) {
    Object.values(els.eyes).forEach((side) => {
      if (side?.black) side.black.style.transition = value;
      if (side?.white) side.white.style.transition = value;
    });
  }

  function applyEyes() {
    const eye = state.eye;
    ['right', 'left'].forEach((name) => {
      const side = eye.sides[name];
      const eyeEls = els.eyes[name];
      if (!eyeEls?.black || !eyeEls?.white) {
        return;
      }
      const centerShift = eye.surprise ? (name === 'right' ? 4 : -4) : 0;
      const blackScaleY = eye.blackScaleY * eye.blinkScale;
      const whiteScaleY = eye.whiteScaleY * eye.blinkScale;
      eyeEls.black.style.transform = [
        `translate(${side.black.x + centerShift}px, ${side.black.y}px)`,
        `scale(${eye.blackScaleX}, ${blackScaleY})`,
      ].join(' ');
      eyeEls.white.style.transform = [
        `translate(${side.black.x + side.white.x + centerShift}px, ${side.black.y + side.white.y}px)`,
        `scale(${eye.whiteScaleX}, ${whiteScaleY})`,
      ].join(' ');
    });
  }

  function scheduleNextBlink() {
    if (!state.blinkEnabled) {
      return;
    }
    setTimeoutTracked(() => {
      blinkOnce();
      scheduleNextBlink();
    }, ctx.random(ctx.BLINK_MIN, ctx.BLINK_MAX));
  }

  function blinkOnce() {
    if (!state.blinkEnabled || state.eye.closed) {
      return;
    }
    state.eye.blinkScale = 0.04;
    applyEyes();
    setTimeoutTracked(() => {
      state.eye.blinkScale = 1;
      applyEyes();
    }, 50);
  }

  function randomPoint(radius) {
    const angle = ctx.random(0, Math.PI * 2);
    const distance = Math.sqrt(Math.random()) * radius;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clampVector(x, y, radius) {
    const length = Math.hypot(x, y);
    if (length <= radius || length === 0) {
      return { x, y };
    }
    return { x: (x / length) * radius, y: (y / length) * radius };
  }

  function canChasePointer() {
    return (
      state.mode === 'standby'
      && state.activeVariant !== 'sleep-notes'
      && !state.thinking
      && !state.error
      && !state.eye.closed
    );
  }

  function nextWanderTarget(type, thinkingCase) {
    if (type === 'thinking') {
      const xSign = thinkingCase === 'left' ? -1 : 1;
      return {
        black: { x: ctx.random(1, 4) * xSign, y: ctx.random(-4, -1) },
        white: { x: ctx.random(2, 8) * xSign, y: ctx.random(-8, -2) },
      };
    }
    return {
      black: randomPoint(4),
      white: randomPoint(9),
    };
  }

  function clearEyeController() {
    state.eye.controller = 'neutral';
    els.stage?.classList.remove('eye-chase-active');
  }

  function resetEyes(instant = false) {
    clearEyeController();
    const eye = state.eye;
    eye.closed = false;
    eye.surprise = false;
    eye.blinkScale = 1;
    eye.blackScaleX = 1;
    eye.blackScaleY = 1;
    eye.whiteScaleX = 1;
    eye.whiteScaleY = 1;
    Object.values(eye.sides).forEach((side) => {
      side.black.x = 0;
      side.black.y = 0;
      side.white.x = 0;
      side.white.y = 0;
    });
    els.stage?.classList.remove('eye-closed', 'eye-surprise-active');
    setEyeTransitions(instant ? 'none' : 'transform 160ms ease');
    Object.values(els.eyes).forEach((side) => {
      if (side?.orbit) {
        side.orbit.style.transition = instant ? 'none' : 'transform 160ms ease';
        side.orbit.style.transform = 'scale(1, 1)';
      }
    });
    applyEyes();
    if (instant) {
      setTimeoutTracked(() => {
        setEyeTransitions('transform 120ms ease');
        Object.values(els.eyes).forEach((side) => {
          if (side?.orbit) {
            side.orbit.style.transition = 'transform 120ms ease';
          }
        });
      }, 0);
    }
  }

  function eyeClose() {
    clearEyeController();
    state.eye.closed = true;
    state.eye.blinkScale = 0.05;
    els.stage?.classList.add('eye-closed');
    setEyeTransitions('none');
    applyEyes();
  }

  function startBlink() {
    state.blinkEnabled = true;
    scheduleNextBlink();
  }

  function stopBlink() {
    state.blinkEnabled = false;
    state.eye.blinkScale = 1;
    applyEyes();
  }

  async function eyeSurprise() {
    clearEyeController();
    state.eye.controller = 'surprise';
    state.eye.surprise = true;
    state.eye.closed = false;
    state.eye.blinkScale = 1;
    state.eye.blackScaleX = 0.85;
    state.eye.blackScaleY = 1.35;
    state.eye.whiteScaleX = 0.85;
    state.eye.whiteScaleY = 1.4;
    els.stage?.classList.add('eye-surprise-active');
    ['right', 'left'].forEach((name) => {
      state.eye.sides[name].black.x = 0;
      state.eye.sides[name].black.y = 5;
      state.eye.sides[name].white.x = 0;
      state.eye.sides[name].white.y = 2;
    });
    Object.values(els.eyes).forEach((side) => {
      if (side?.black) side.black.style.transition = 'transform 300ms ease-out';
      if (side?.white) side.white.style.transition = 'transform 300ms ease-out';
      if (side?.orbit) {
        side.orbit.style.transition = 'transform 300ms ease-out';
        side.orbit.style.transform = 'scale(0.9, 1.1)';
      }
    });
    applyEyes();
    await ctx.wait(300);
    if (state.eye.controller === 'surprise') {
      startBlink();
    }
    await ctx.wait(5000);
    if (state.eye.controller !== 'surprise') {
      return;
    }
    stopBlink();
    state.eye.surprise = false;
    state.eye.blackScaleX = 1;
    state.eye.blackScaleY = 1;
    state.eye.whiteScaleX = 1;
    state.eye.whiteScaleY = 1;
    state.eye.blinkScale = 1;
    els.stage?.classList.remove('eye-surprise-active');
    Object.values(els.eyes).forEach((side) => {
      if (side?.black) side.black.style.transition = 'transform 300ms ease-in';
      if (side?.white) side.white.style.transition = 'transform 300ms ease-in';
      if (side?.orbit) {
        side.orbit.style.transition = 'transform 300ms ease-in';
        side.orbit.style.transform = 'scale(1, 1)';
      }
    });
    applyEyes();
    await ctx.wait(300);
    resetEyes(true);
  }

  function startEyeWander(type, thinkingCase) {
    clearEyeController();
    resetEyes(false);
    state.eye.controller = type;

    let target = nextWanderTarget(type, thinkingCase);
    let lastTargetTime = performance.now();

    function tick(time) {
      if (state.eye.controller !== type) {
        return;
      }
      if (time - lastTargetTime > ctx.random(450, 1500)) {
        target = nextWanderTarget(type, thinkingCase);
        lastTargetTime = time;
      }
      ['right', 'left'].forEach((sideName) => {
        const side = state.eye.sides[sideName];
        side.black.x += (target.black.x - side.black.x) * 0.065;
        side.black.y += (target.black.y - side.black.y) * 0.065;
        side.white.x += (target.white.x - side.white.x) * 0.09;
        side.white.y += (target.white.y - side.white.y) * 0.09;
      });
      applyEyes();
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function stopEyeChase() {
    if (state.eye.controller === 'chase') {
      state.eye.controller = 'neutral';
    }
    state.chaseVector = { x: 0, y: 0 };
    els.stage?.classList.remove('eye-chase-active');
  }

  function startEyeChase() {
    if (!canChasePointer()) {
      return;
    }
    if (state.eye.controller === 'chase') {
      return;
    }

    clearEyeController();
    resetEyes(false);
    state.eye.controller = 'chase';
    state.chaseVector = { x: 0, y: 0 };
    els.stage?.classList.add('eye-chase-active');
    setEyeTransitions('transform 80ms ease-out');

    function tick() {
      if (state.eye.controller !== 'chase') {
        return;
      }
      if (!canChasePointer()) {
        stopEyeChase();
        return;
      }

      const vector = state.chaseVector || { x: 0, y: 0 };
      const white = clampVector(vector.x * 0.9, vector.y * 0.9, 9);
      const residual = {
        x: vector.x * 0.9 - white.x,
        y: vector.y * 0.9 - white.y,
      };
      const black = clampVector(residual.x * 0.9, residual.y * 0.9, 4);

      ['right', 'left'].forEach((sideName) => {
        const side = state.eye.sides[sideName];
        side.white.x += (white.x - side.white.x) * 0.28;
        side.white.y += (white.y - side.white.y) * 0.28;
        side.black.x += (black.x - side.black.x) * 0.2;
        side.black.y += (black.y - side.black.y) * 0.2;
      });
      applyEyes();
      ctx.requestFrame(tick);
    }

    ctx.requestFrame(tick);
  }

  function handleEyeChaseMove(event) {
    if (!canChasePointer()) {
      stopEyeChase();
      return;
    }
    if (!els.stage) {
      return;
    }
    if (state.eye.controller !== 'chase') {
      startEyeChase();
    }

    const rect = els.stage.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height * 0.45;
    const vector = {
      x: clamp(((event.clientX - centerX) / Math.max(rect.width / 2, 1)) * 18, -18, 18),
      y: clamp(((event.clientY - centerY) / Math.max(rect.height / 2, 1)) * 18, -18, 18),
    };
    state.chaseVector = vector;
  }

  return {
    applyEyes,
    startBlink,
    stopBlink,
    clearEyeController,
    resetEyes,
    eyeClose,
    startEyeObserve() {
      startEyeWander('observe');
    },
    startEyeThinking(direction) {
      startEyeWander('thinking', direction);
    },
    eyeSurprise,
    startEyeChase,
    stopEyeChase,
    handleEyeChaseMove,
  };
}
